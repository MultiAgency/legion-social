//! Read-side queries. Every list is validated lazily (see the module docs of `state`).

use super::*;
use crate::model::links::{classify, LinkKind};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

pub const MAX_ANCESTORS: usize = 20;
/// Upper bound on entries inspected per request (keeps worst-case latency bounded).
const MAX_SCAN: usize = 100_000;
const MAX_NOTIF_ACTORS: usize = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeedEntry {
    Post { seq: Seq, pid: Pid },
    Repost { seq: Seq, pid: Pid, by: Aid },
}

impl FeedEntry {
    pub fn seq(&self) -> Seq {
        match *self {
            FeedEntry::Post { seq, .. } | FeedEntry::Repost { seq, .. } => seq,
        }
    }

    pub fn pid(&self) -> Pid {
        match *self {
            FeedEntry::Post { pid, .. } | FeedEntry::Repost { pid, .. } => pid,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProfileTab {
    Posts,
    Replies,
    Media,
}

#[derive(Debug)]
pub struct NotifGroup {
    pub kind: NotifKind,
    pub actors: Vec<Aid>,
    pub actor_count: u32,
    pub post: Option<Pid>,
    pub ms: u64,
    /// Seq of the oldest notification in the group (the cursor for the next page).
    pub cursor: Seq,
}

/// The entries of a seq-sorted slice with `seq < before`, newest first.
fn newest_first<T>(items: &[(Seq, T)], before: Option<Seq>) -> impl Iterator<Item = &(Seq, T)> {
    let end = before.map_or(items.len(), |b| items.partition_point(|e| e.0 < b));
    items[..end].iter().rev()
}

impl State {
    /// A live post whose author isn't hidden.
    pub fn is_visible(&self, pid: Pid) -> bool {
        let post = self.post(pid);
        post.is_live() && !self.is_hidden(post.key.author)
    }

    fn body(&self, pid: Pid) -> Option<&PostBody> {
        self.post(pid).body.as_ref()
    }

    fn is_top_level(&self, pid: Pid) -> bool {
        self.body(pid).is_some_and(|b| b.reply_to.is_none())
    }

    fn created_seq(&self, pid: Pid) -> Seq {
        self.post(pid).created.map_or(0, |c| c.0)
    }

    /// Validates a timeline entry of `owner` for the given tab.
    fn timeline_entry(&self, owner: Aid, seq: Seq, entry: Entry, tab: ProfileTab) -> Option<FeedEntry> {
        match entry {
            Entry::Post(pid) => {
                if !self.is_visible(pid) {
                    return None;
                }
                let body = self.body(pid)?;
                let keep = match tab {
                    ProfileTab::Posts => body.reply_to.is_none(),
                    ProfileTab::Replies => body.reply_to.is_some(),
                    ProfileTab::Media => !body.media.is_empty(),
                };
                keep.then_some(FeedEntry::Post { seq, pid })
            }
            Entry::Repost(pid) => (tab == ProfileTab::Posts
                && self.reposts.get(&(owner, pid)) == Some(&seq)
                && self.is_visible(pid))
            .then_some(FeedEntry::Repost { seq, pid, by: owner }),
        }
    }

    pub fn feed_global(&self, before: Option<Seq>, limit: usize) -> Vec<FeedEntry> {
        newest_first(&self.created, before)
            .take(MAX_SCAN)
            .filter(|(_, pid)| self.is_visible(*pid) && self.is_top_level(*pid) && self.on_social(*pid))
            .map(|&(seq, pid)| FeedEntry::Post { seq, pid })
            .take(limit)
            .collect()
    }

    /// Posts and reposts of the viewer and everyone they follow (k-way merge of timelines).
    pub fn feed_following(&self, viewer: Aid, before: Option<Seq>, limit: usize) -> Vec<FeedEntry> {
        let sources: Vec<(Aid, &[(Seq, Entry)])> = std::iter::once(viewer)
            .chain(self.account(viewer).following.keys().copied())
            .filter(|&aid| !self.is_hidden(aid))
            .map(|aid| {
                let tl = &self.account(aid).timeline;
                let end = before.map_or(tl.len(), |b| tl.partition_point(|e| e.0 < b));
                (aid, &tl[..end])
            })
            .filter(|(_, tl)| !tl.is_empty())
            .collect();
        let mut positions: Vec<usize> = sources.iter().map(|(_, tl)| tl.len()).collect();
        let mut heap: BinaryHeap<(Seq, usize)> = sources
            .iter()
            .enumerate()
            .map(|(i, (_, tl))| (tl[tl.len() - 1].0, i))
            .collect();
        let mut items = vec![];
        let mut seen = FxHashSet::default();
        let mut scanned = 0;
        while let Some((_, i)) = heap.pop() {
            positions[i] -= 1;
            let (owner, tl) = sources[i];
            let (seq, entry) = tl[positions[i]];
            if positions[i] > 0 {
                heap.push((tl[positions[i] - 1].0, i));
            }
            scanned += 1;
            if scanned > MAX_SCAN {
                break;
            }
            if let Some(item) = self.timeline_entry(owner, seq, entry, ProfileTab::Posts) {
                if seen.insert(item.pid()) {
                    items.push(item);
                    if items.len() >= limit {
                        break;
                    }
                }
            }
        }
        items
    }

    pub fn account_feed(&self, aid: Aid, tab: ProfileTab, before: Option<Seq>, limit: usize) -> Vec<FeedEntry> {
        if self.is_outside_legion(aid) {
            return vec![];
        }
        newest_first(&self.account(aid).timeline, before)
            .take(MAX_SCAN)
            .filter_map(|&(seq, entry)| self.timeline_entry(aid, seq, entry, tab))
            .take(limit)
            .collect()
    }

    /// Posts liked by `aid`, newest like first (`seq` is the like's seq).
    pub fn account_likes(&self, aid: Aid, before: Option<Seq>, limit: usize) -> Vec<FeedEntry> {
        if self.is_outside_legion(aid) {
            return vec![];
        }
        newest_first(&self.account(aid).liked, before)
            .take(MAX_SCAN)
            .filter(|&&(seq, pid)| self.likes.get(&(aid, pid)) == Some(&seq) && self.is_visible(pid))
            .map(|&(seq, pid)| FeedEntry::Post { seq, pid })
            .take(limit)
            .collect()
    }

    pub fn hashtag_feed(&self, tag: &str, before: Option<Seq>, limit: usize) -> Vec<FeedEntry> {
        let Some(list) = self.hashtags.get(tag) else {
            return vec![];
        };
        newest_first(list, before)
            .take(MAX_SCAN)
            .filter(|&&(_, pid)| {
                self.is_visible(pid)
                    && self.on_social(pid)
                    && self.body(pid).is_some_and(|b| b.hashtags.iter().any(|t| &**t == tag))
            })
            .map(|&(seq, pid)| FeedEntry::Post { seq, pid })
            .take(limit)
            .collect()
    }

    /// Case-insensitive substring search over recent posts. `query` must be lowercase.
    pub fn search_posts(&self, query: &str, before: Option<Seq>, limit: usize) -> Vec<FeedEntry> {
        newest_first(&self.created, before)
            .take(MAX_SCAN)
            .filter(|&&(_, pid)| {
                self.is_visible(pid) && self.body(pid).is_some_and(|b| b.text.to_lowercase().contains(query))
            })
            .map(|&(seq, pid)| FeedEntry::Post { seq, pid })
            .take(limit)
            .collect()
    }

    /// Replies to `pid`: the author's own replies first, then everyone else's, oldest first.
    /// Paginated by offset. Returns the page and whether more remain.
    pub fn post_replies(&self, pid: Pid, offset: usize, limit: usize) -> (Vec<FeedEntry>, bool) {
        let parent_author = self.post(pid).key.author;
        let mut seen = FxHashSet::default();
        let mut replies: Vec<(bool, Seq, Pid)> = self
            .post(pid)
            .children
            .iter()
            .copied()
            .filter(|&c| {
                self.is_visible(c) && self.body(c).is_some_and(|b| b.reply_to == Some(pid)) && seen.insert(c)
            })
            .map(|c| (self.post(c).key.author != parent_author, self.created_seq(c), c))
            .collect();
        replies.sort_unstable();
        let more = replies.len() > offset + limit;
        let page = replies
            .into_iter()
            .skip(offset)
            .take(limit)
            .map(|(_, seq, pid)| FeedEntry::Post { seq, pid })
            .collect();
        (page, more)
    }

    pub fn post_quotes(&self, pid: Pid, before: Option<Seq>, limit: usize) -> Vec<FeedEntry> {
        let mut seen = FxHashSet::default();
        let mut quotes: Vec<(Seq, Pid)> = self
            .post(pid)
            .quoted_by
            .iter()
            .copied()
            .filter(|&q| self.is_visible(q) && self.body(q).is_some_and(|b| b.quote == Some(pid)) && seen.insert(q))
            .map(|q| (self.created_seq(q), q))
            .filter(|&(seq, _)| before.is_none_or(|b| seq < b))
            .collect();
        quotes.sort_unstable_by_key(|&(seq, _)| Reverse(seq));
        quotes
            .into_iter()
            .take(limit)
            .map(|(seq, pid)| FeedEntry::Post { seq, pid })
            .collect()
    }

    pub fn post_likers(&self, pid: Pid, before: Option<Seq>, limit: usize) -> Vec<(Seq, Aid)> {
        newest_first(&self.post(pid).likers, before)
            .filter(|&&(seq, aid)| self.likes.get(&(aid, pid)) == Some(&seq) && !self.is_hidden(aid))
            .take(limit)
            .copied()
            .collect()
    }

    pub fn post_reposters(&self, pid: Pid, before: Option<Seq>, limit: usize) -> Vec<(Seq, Aid)> {
        newest_first(&self.post(pid).reposters, before)
            .filter(|&&(seq, aid)| self.reposts.get(&(aid, pid)) == Some(&seq) && !self.is_hidden(aid))
            .take(limit)
            .copied()
            .collect()
    }

    pub fn followers(&self, aid: Aid, before: Option<Seq>, limit: usize) -> Vec<(Seq, Aid)> {
        if self.is_outside_legion(aid) {
            return vec![];
        }
        let account = self.account(aid);
        newest_first(&account.followers_log, before)
            .filter(|&&(seq, f)| account.followers.get(&f) == Some(&seq) && !self.is_hidden(f))
            .take(limit)
            .copied()
            .collect()
    }

    pub fn following(&self, aid: Aid, before: Option<Seq>, limit: usize) -> Vec<(Seq, Aid)> {
        if self.is_outside_legion(aid) {
            return vec![];
        }
        let account = self.account(aid);
        newest_first(&account.following_log, before)
            .filter(|&&(seq, f)| account.following.get(&f) == Some(&seq) && !self.is_hidden(f))
            .take(limit)
            .copied()
            .collect()
    }

    /// Ancestors of `pid` from the root down to the direct parent, and whether the chain stops
    /// at a missing (unknown or deleted) post.
    pub fn thread_ancestors(&self, pid: Pid) -> (Vec<Pid>, bool) {
        let mut ancestors = vec![];
        let mut missing = false;
        let mut current = self.body(pid).and_then(|b| b.reply_to);
        while let Some(p) = current {
            if ancestors.len() >= MAX_ANCESTORS || ancestors.contains(&p) || p == pid {
                break;
            }
            if !self.is_visible(p) {
                missing = true;
                break;
            }
            ancestors.push(p);
            current = self.body(p).and_then(|b| b.reply_to);
        }
        ancestors.reverse();
        (ancestors, missing)
    }

    /// Accounts matching `query` (lowercase): exact id, id prefix, name-word prefix, id substring;
    /// ties broken by follower count.
    pub fn search_accounts(&self, query: &str, limit: usize) -> Vec<Aid> {
        let query = query.trim_start_matches('@');
        if query.is_empty() {
            return vec![];
        }
        let mut hits: Vec<(u8, Reverse<usize>, Aid)> = self
            .accounts
            .iter()
            .enumerate()
            .filter(|(aid, a)| a.joined_ms.is_some() && !self.is_hidden(*aid as Aid))
            .filter_map(|(aid, a)| {
                let score = if &*a.name == query {
                    0
                } else if a.name.starts_with(query) {
                    1
                } else if a.profile.name.as_ref().is_some_and(|n| {
                    n.to_lowercase().split_whitespace().any(|w| w.starts_with(query))
                }) {
                    2
                } else if a.name.contains(query) {
                    3
                } else {
                    return None;
                };
                Some((score, Reverse(self.follower_count(aid as Aid)), aid as Aid))
            })
            .collect();
        hits.sort_unstable();
        hits.into_iter().take(limit).map(|h| h.2).collect()
    }

    /// Active accounts with a profile, most followed first.
    pub fn top_accounts(&self, limit: usize) -> Vec<Aid> {
        let mut all: Vec<(Reverse<usize>, Aid)> = self
            .accounts
            .iter()
            .enumerate()
            .filter(|(aid, a)| a.profile.exists() && !self.is_hidden(*aid as Aid))
            .map(|(aid, _)| (Reverse(self.follower_count(aid as Aid)), aid as Aid))
            .collect();
        all.sort_unstable();
        all.into_iter().take(limit).map(|(_, aid)| aid).collect()
    }

    /// Top hashtags by number of posts created within `window_ms` before `now_ms`.
    pub fn trending(&self, now_ms: u64, window_ms: u64, limit: usize) -> Vec<(String, u32)> {
        let since = now_ms.saturating_sub(window_ms);
        let mut counts: FxHashMap<&str, u32> = FxHashMap::default();
        for &(_, pid) in self.created.iter().rev().take(MAX_SCAN) {
            let post = self.post(pid);
            if post.created.is_some_and(|c| c.1 < since) {
                break;
            }
            if !self.is_visible(pid) || !self.on_social(pid) {
                continue;
            }
            for tag in post.body.iter().flat_map(|b| b.hashtags.iter()) {
                *counts.entry(tag).or_default() += 1;
            }
        }
        let mut top: Vec<(String, u32)> = counts.into_iter().map(|(t, c)| (t.to_string(), c)).collect();
        top.sort_unstable_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        top.truncate(limit);
        top
    }

    fn notif_is_valid(&self, recipient: Aid, n: &Notif) -> bool {
        if self.is_hidden(n.actor) {
            return false;
        }
        // Edges only need to be active now: a re-like after an unlike is deduplicated at insert
        // time and keeps the original notification.
        match n.kind {
            NotifKind::Like => n
                .post
                .is_some_and(|p| self.likes.contains_key(&(n.actor, p)) && self.post(p).is_live()),
            NotifKind::Repost => n
                .post
                .is_some_and(|p| self.reposts.contains_key(&(n.actor, p)) && self.post(p).is_live()),
            NotifKind::Follow => self.account(recipient).followers.contains_key(&n.actor),
            NotifKind::Reply | NotifKind::Quote | NotifKind::Mention => {
                n.post.is_some_and(|p| self.post(p).is_live())
            }
        }
    }

    /// Notifications, newest first. Consecutive likes/reposts of the same post and consecutive
    /// follows are grouped.
    pub fn notifications(&self, aid: Aid, before: Option<Seq>, limit: usize) -> Vec<NotifGroup> {
        let notifs = &self.account(aid).notifs;
        let end = before.map_or(notifs.len(), |b| notifs.partition_point(|n| n.seq < b));
        let mut groups: Vec<NotifGroup> = vec![];
        for n in notifs[..end].iter().rev() {
            if !self.notif_is_valid(aid, n) {
                continue;
            }
            let groupable = matches!(n.kind, NotifKind::Like | NotifKind::Repost | NotifKind::Follow);
            if let Some(last) = groups.last_mut() {
                if groupable && last.kind == n.kind && last.post == n.post {
                    if !last.actors.contains(&n.actor) {
                        if last.actors.len() < MAX_NOTIF_ACTORS {
                            last.actors.push(n.actor);
                        }
                        last.actor_count += 1;
                    }
                    last.cursor = n.seq;
                    continue;
                }
            }
            if groups.len() >= limit {
                break;
            }
            groups.push(NotifGroup {
                kind: n.kind,
                actors: vec![n.actor],
                actor_count: 1,
                post: n.post,
                ms: n.ms,
                cursor: n.seq,
            });
        }
        groups
    }

    pub fn notification_count(&self, aid: Aid, since_ms: u64) -> usize {
        self.account(aid)
            .notifs
            .iter()
            .rev()
            .take_while(|n| n.ms > since_ms)
            .filter(|n| self.notif_is_valid(aid, n))
            .take(100)
            .count()
    }
}

// ---- For You ----

/// Trending posts are drawn from this window before the latest block.
pub const FOR_YOU_WINDOW_MS: u64 = 48 * 3600 * 1000;
/// At most this many posts per author in the trending pool (diversity).
const POOL_PER_AUTHOR: usize = 2;

/// Why a post is in the For You feed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    /// From the viewer or someone they follow.
    Following,
    /// From the trending pool.
    Trending,
    /// Recent posts, once following and trending run out.
    New,
}

impl Reason {
    pub fn as_str(self) -> &'static str {
        match self {
            Reason::Following => "following",
            Reason::Trending => "trending",
            Reason::New => "new",
        }
    }
}

/// Position in one For You source.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Pos {
    #[default]
    Start,
    Before(Seq),
    Done,
}

impl Pos {
    fn encode(self) -> String {
        match self {
            Pos::Start => "s".into(),
            Pos::Before(seq) => seq.to_string(),
            Pos::Done => "x".into(),
        }
    }

    fn decode(s: &str) -> Option<Self> {
        match s {
            "s" => Some(Pos::Start),
            "x" => Some(Pos::Done),
            _ => s.parse().ok().map(Pos::Before),
        }
    }

    fn before(self) -> Option<Seq> {
        match self {
            Pos::Before(seq) => Some(seq),
            _ => None,
        }
    }
}

/// Cursor over the three For You sources: following (`f`), trending pool offset (`p`) and
/// recent posts (`g`). Encoded as `f{pos}.p{offset}.g{pos}`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ForYouCursor {
    pub following: Pos,
    pub pool: usize,
    pub recent: Pos,
}

impl ForYouCursor {
    pub fn encode(&self) -> String {
        format!("f{}.p{}.g{}", self.following.encode(), self.pool, self.recent.encode())
    }

    pub fn decode(s: &str) -> Option<Self> {
        let mut parts = s.split('.');
        let following = Pos::decode(parts.next()?.strip_prefix('f')?)?;
        let pool = parts.next()?.strip_prefix('p')?.parse().ok()?;
        let recent = Pos::decode(parts.next()?.strip_prefix('g')?)?;
        parts.next().is_none().then_some(Self { following, pool, recent })
    }
}

impl State {
    /// Engagement with time decay (Hacker News style), nudged by the author's audience.
    pub fn trending_score(&self, pid: Pid, now_ms: u64) -> f64 {
        let post = self.post(pid);
        let created_ms = post.created.map_or(now_ms, |c| c.1);
        let (likes, reposts, replies, quotes) = self.post_counts(pid);
        let engagement = likes as f64 + 2.0 * reposts as f64 + 2.0 * replies as f64 + 3.0 * quotes as f64 + 1.0;
        let followers = self.follower_count(post.key.author) as f64;
        let age_hours = now_ms.saturating_sub(created_ms) as f64 / 3_600_000.0;
        engagement * (1.0 + 0.1 * (1.0 + followers).ln()) / (age_hours + 2.0).powf(1.5)
    }

    /// The trending pool: visible top-level posts from the last `window_ms`, best first, at most
    /// two per author.
    pub fn ranked_posts(&self, now_ms: u64, window_ms: u64, limit: usize) -> Vec<Pid> {
        let since = now_ms.saturating_sub(window_ms);
        let mut scored: Vec<(f64, Pid)> = vec![];
        for &(_, pid) in self.created.iter().rev().take(MAX_SCAN) {
            if self.post(pid).created.is_some_and(|c| c.1 < since) {
                break;
            }
            if self.is_visible(pid) && self.is_top_level(pid) && self.on_social(pid) {
                scored.push((self.trending_score(pid, now_ms), pid));
            }
        }
        scored.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
        let mut per_author: FxHashMap<Aid, usize> = FxHashMap::default();
        scored
            .into_iter()
            .filter(|&(_, pid)| {
                let count = per_author.entry(self.post(pid).key.author).or_default();
                *count += 1;
                *count <= POOL_PER_AUTHOR
            })
            .take(limit)
            .map(|(_, pid)| pid)
            .collect()
    }

    /// For You: the following feed with a trending post in every third slot. Trending posts
    /// skip authors the viewer already follows (they arrive through the following feed). When
    /// both run out, recent posts from everyone else keep the feed going. Without a viewer it's
    /// trending, then recent.
    pub fn feed_for_you(
        &self,
        viewer: Option<Aid>,
        cursor: ForYouCursor,
        limit: usize,
        pool: &[Pid],
    ) -> (Vec<(FeedEntry, Reason)>, Option<ForYouCursor>) {
        let followed: FxHashSet<Aid> = viewer
            .map(|v| std::iter::once(v).chain(self.account(v).following.keys().copied()).collect())
            .unwrap_or_default();
        let pool_set: FxHashSet<Pid> = pool.iter().copied().collect();
        let mut next = cursor;
        if viewer.is_none() {
            next.following = Pos::Done;
        }
        let mut following: std::collections::VecDeque<FeedEntry> = Default::default();
        let mut seen: FxHashSet<Pid> = FxHashSet::default();
        let mut items = vec![];
        let mut slot = 0;

        while items.len() < limit {
            let trending_slot = slot % 3 == 2;
            slot += 1;
            let mut picked = None;
            for take_trending in [trending_slot, !trending_slot] {
                picked = if take_trending {
                    self.next_trending(pool, &followed, &seen, &mut next)
                } else {
                    self.next_following(viewer, limit, &mut following, &seen, &mut next)
                };
                if picked.is_some() {
                    break;
                }
            }
            if picked.is_none() {
                picked = self.next_recent(&followed, &pool_set, &seen, &mut next);
            }
            let Some((entry, reason)) = picked else { break };
            seen.insert(entry.pid());
            items.push((entry, reason));
        }
        let more = items.len() >= limit;
        (items, more.then_some(next))
    }

    fn next_following(
        &self,
        viewer: Option<Aid>,
        batch: usize,
        buffer: &mut std::collections::VecDeque<FeedEntry>,
        seen: &FxHashSet<Pid>,
        cursor: &mut ForYouCursor,
    ) -> Option<(FeedEntry, Reason)> {
        let viewer = viewer?;
        loop {
            if cursor.following == Pos::Done {
                return None;
            }
            if buffer.is_empty() {
                buffer.extend(self.feed_following(viewer, cursor.following.before(), batch));
                if buffer.is_empty() {
                    cursor.following = Pos::Done;
                    return None;
                }
            }
            let entry = buffer.pop_front()?;
            cursor.following = Pos::Before(entry.seq());
            if !seen.contains(&entry.pid()) && self.on_social(entry.pid()) {
                return Some((entry, Reason::Following));
            }
        }
    }

    fn next_trending(
        &self,
        pool: &[Pid],
        followed: &FxHashSet<Aid>,
        seen: &FxHashSet<Pid>,
        cursor: &mut ForYouCursor,
    ) -> Option<(FeedEntry, Reason)> {
        while let Some(&pid) = pool.get(cursor.pool) {
            cursor.pool += 1;
            if self.is_visible(pid) && !followed.contains(&self.post(pid).key.author) && !seen.contains(&pid) {
                return Some((FeedEntry::Post { seq: self.created_seq(pid), pid }, Reason::Trending));
            }
        }
        None
    }

    fn next_recent(
        &self,
        followed: &FxHashSet<Aid>,
        pool: &FxHashSet<Pid>,
        seen: &FxHashSet<Pid>,
        cursor: &mut ForYouCursor,
    ) -> Option<(FeedEntry, Reason)> {
        if cursor.recent == Pos::Done {
            return None;
        }
        let candidates = newest_first(&self.created, cursor.recent.before()).take(MAX_SCAN);
        for &(seq, pid) in candidates {
            cursor.recent = Pos::Before(seq);
            if self.is_visible(pid)
                && self.is_top_level(pid)
                && self.on_social(pid)
                && !pool.contains(&pid)
                && !followed.contains(&self.post(pid).key.author)
                && !seen.contains(&pid)
            {
                return Some((FeedEntry::Post { seq, pid }, Reason::New));
            }
        }
        cursor.recent = Pos::Done;
        None
    }
}

// ---- Links ----

/// What a post's link attachment points to (see `State::post_link`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkTarget {
    /// Another visible post on this site, shown as a quote.
    Post(Pid),
    /// A URL to preview: YouTube, near.fm or any web page.
    Url(LinkKind),
}

impl State {
    /// The link a post is decorated with, and the URL as written in its text:
    /// - nothing if the post has its own (on-chain) quote;
    /// - else the last link to another visible post on this site, even when the post has media;
    /// - else, unless the post has media, the last URL that isn't on this site.
    pub fn post_link(&self, pid: Pid, site_hosts: &[String]) -> Option<(&str, LinkTarget)> {
        let body = self.body(pid)?;
        if body.quote.is_some() {
            return None;
        }
        let links: Vec<(&str, LinkKind)> = text::url_spans(&body.text)
            .into_iter()
            .rev()
            .filter_map(|(start, end)| {
                let url = &body.text[start..end];
                classify(url, site_hosts).map(|kind| (url, kind))
            })
            .collect();
        for (url, kind) in &links {
            if let LinkKind::SitePost { account, id } = kind {
                if let Some(linked) = self.pid(account, *id).filter(|&l| l != pid && self.is_visible(l)) {
                    return Some((url, LinkTarget::Post(linked)));
                }
            }
        }
        if !body.media.is_empty() {
            return None;
        }
        links
            .into_iter()
            .find(|(_, kind)| !matches!(kind, LinkKind::Site | LinkKind::SitePost { .. }))
            .map(|(url, kind)| (url, LinkTarget::Url(kind)))
    }
}
