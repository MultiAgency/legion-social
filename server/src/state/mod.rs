//! In-memory social state derived from the ordered stream of KV rows.
//!
//! Design notes:
//! - Accounts and posts are interned into dense vectors (`Aid`, `Pid`); anything referenced
//!   before it exists (a like of an unseen post, a reply to an unseen parent) becomes a stub.
//! - `Seq = block_height << 20 | row_index` is the only ordering primitive (and the cursor).
//! - Index lists (timelines, likers, followers, children…) are append-only; each entry is
//!   validated when read (does the edge still carry the same seq? is the post still live?), so
//!   unlike/relike, delete/recreate and re-parenting edits need no index surgery.

pub mod query;

use crate::ingest::fastdata::{ActionStatus, DropReason, FastfsHeader, LogBlock};
use crate::model::keys::{parse_key, Key, ProfileField};
use crate::model::text;
use crate::model::values::{self, PostValue};
use rustc_hash::{FxHashMap, FxHashSet};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, VecDeque};

pub type Aid = u32;
pub type Pid = u32;
pub type Seq = u64;

pub const SEQ_ROW_BITS: u32 = 20;
pub const MAX_ROWS_PER_BLOCK: u32 = 1 << SEQ_ROW_BITS;

pub fn make_seq(block_height: u64, row: u32) -> Seq {
    (block_height << SEQ_ROW_BITS) | row as u64
}

pub fn seq_block_height(seq: Seq) -> u64 {
    seq >> SEQ_ROW_BITS
}

// Indexer policy (STANDARD.md §6). Applied by block time, so replays are deterministic.
pub const DAY_MS: u64 = 86_400_000;
pub const MAX_DAILY_POSTS: u32 = 300;
pub const MAX_DAILY_LIKES: u32 = 1000;
pub const MAX_DAILY_REPOSTS: u32 = 300;
pub const MAX_DAILY_BYTES: u64 = 5 * 1024 * 1024;
pub const MAX_FOLLOWING: usize = 5000;
pub const MAX_STORED_LINKS: usize = 64;
pub const MAX_SERVED_LINKS: usize = 32;
pub const MAX_MENTION_NOTIFICATIONS: usize = 10;
const MAX_NOTIFICATIONS: usize = 1200;
const NOTIFICATION_DEDUP_WINDOW: usize = 50;
const MAX_TX_REPORTS: usize = 200_000;
const MAX_TX_REPORT_KEYS: usize = 2_000_000;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct PostKey {
    pub author: Aid,
    pub id: u64,
}

#[derive(Debug)]
pub struct Media {
    pub src: Box<str>,
    pub mime: Box<str>,
    pub w: Option<u32>,
    pub h: Option<u32>,
    pub alt: Option<Box<str>>,
}

#[derive(Debug)]
pub struct PostBody {
    pub text: Box<str>,
    pub media: Box<[Media]>,
    pub reply_to: Option<Pid>,
    pub root: Option<Pid>,
    pub quote: Option<Pid>,
    pub mentions: Box<[Aid]>,
    pub hashtags: Box<[Box<str>]>,
}

#[derive(Debug)]
pub struct Post {
    pub key: PostKey,
    /// Seq and block time (ms) of the first valid write. `None` for stubs.
    pub created: Option<(Seq, u64)>,
    pub edited_ms: Option<u64>,
    /// `None`: a stub, deleted, or invalid.
    pub body: Option<PostBody>,
    pub likes: u32,
    pub reposts: u32,
    pub replies: u32,
    pub quotes: u32,
    /// Candidate replies (validated on read).
    pub children: Vec<Pid>,
    /// Candidate quoting posts (validated on read).
    pub quoted_by: Vec<Pid>,
    pub likers: Vec<(Seq, Aid)>,
    pub reposters: Vec<(Seq, Aid)>,
}

impl Post {
    fn stub(key: PostKey) -> Self {
        Self {
            key,
            created: None,
            edited_ms: None,
            body: None,
            likes: 0,
            reposts: 0,
            replies: 0,
            quotes: 0,
            children: vec![],
            quoted_by: vec![],
            likers: vec![],
            reposters: vec![],
        }
    }

    pub fn is_live(&self) -> bool {
        self.body.is_some()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Entry {
    Post(Pid),
    Repost(Pid),
}

#[derive(Debug, Default)]
pub struct Profile {
    pub name: Option<Box<str>>,
    pub about: Option<Box<str>>,
    pub avatar: Option<Box<str>>,
    pub banner: Option<Box<str>>,
    pub location: Option<Box<str>>,
    pub links: BTreeMap<Box<str>, Box<str>>,
}

impl Profile {
    pub fn exists(&self) -> bool {
        self.name.is_some()
            || self.about.is_some()
            || self.avatar.is_some()
            || self.banner.is_some()
            || self.location.is_some()
            || !self.links.is_empty()
    }

    fn field_mut(&mut self, field: ProfileField) -> &mut Option<Box<str>> {
        match field {
            ProfileField::Name => &mut self.name,
            ProfileField::About => &mut self.about,
            ProfileField::Avatar => &mut self.avatar,
            ProfileField::Banner => &mut self.banner,
            ProfileField::Location => &mut self.location,
        }
    }
}

#[derive(Debug, Default)]
pub struct Quota {
    day: u64,
    posts: u32,
    likes: u32,
    reposts: u32,
    bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotifKind {
    Like,
    Repost,
    Reply,
    Quote,
    Mention,
    Follow,
}

#[derive(Debug, Clone, Copy)]
pub struct Notif {
    pub seq: Seq,
    pub ms: u64,
    pub kind: NotifKind,
    pub actor: Aid,
    /// like/repost: the recipient's post; reply/quote/mention: the new post; follow: None.
    pub post: Option<Pid>,
}

#[derive(Debug)]
pub struct Account {
    pub name: Box<str>,
    /// Block time of the first accepted write.
    pub joined_ms: Option<u64>,
    pub profile: Profile,
    pub timeline: Vec<(Seq, Entry)>,
    pub following: FxHashMap<Aid, Seq>,
    pub following_log: Vec<(Seq, Aid)>,
    pub followers: FxHashMap<Aid, Seq>,
    pub followers_log: Vec<(Seq, Aid)>,
    pub liked: Vec<(Seq, Pid)>,
    pub notifs: Vec<Notif>,
    pub live_posts: u32,
    quota: Quota,
}

impl Account {
    fn new(name: &str) -> Self {
        Self {
            name: name.into(),
            joined_ms: None,
            profile: Profile::default(),
            timeline: vec![],
            following: FxHashMap::default(),
            following_log: vec![],
            followers: FxHashMap::default(),
            followers_log: vec![],
            liked: vec![],
            notifs: vec![],
            live_posts: 0,
            quota: Quota::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyStatus {
    Ok,
    Ignored,
    Invalid,
    KeyTooLong,
    ValueTooLarge,
    RateLimited,
}

#[derive(Debug, Serialize)]
pub struct KeyReport {
    pub key: Box<str>,
    pub status: KeyStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<Box<str>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    /// `__fastdata_kv`
    Kv,
    /// `__fastdata_fastfs` (file upload)
    Fastfs,
}

#[derive(Debug, Serialize)]
pub struct ActionReport {
    pub kind: ActionKind,
    pub status: ActionStatus,
    pub keys: Vec<KeyReport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<FastfsHeader>,
}

#[derive(Debug)]
pub struct TxReport {
    pub block_height: u64,
    pub block_ms: u64,
    pub predecessor: Box<str>,
    pub actions: Vec<ActionReport>,
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
pub struct Counts {
    pub accounts: u64,
    pub posts: u64,
    pub likes: u64,
    pub follows: u64,
}

/// What a block changed; broadcast to live subscribers.
#[derive(Debug, Default, Serialize)]
pub struct BlockEffects {
    pub block_height: u64,
    pub block_ts: u64,
    pub tx_hashes: Vec<String>,
    pub posts: Vec<String>,
    pub accounts: Vec<String>,
}

#[derive(Default)]
pub struct State {
    pub accounts: Vec<Account>,
    pub aid_by_name: FxHashMap<Box<str>, Aid>,
    pub posts: Vec<Post>,
    pub pid_by_key: FxHashMap<PostKey, Pid>,
    pub likes: FxHashMap<(Aid, Pid), Seq>,
    pub reposts: FxHashMap<(Aid, Pid), Seq>,
    /// Every post (including replies) in creation order.
    pub created: Vec<(Seq, Pid)>,
    /// Candidate posts per hashtag, sorted by creation seq.
    pub hashtags: FxHashMap<Box<str>, Vec<(Seq, Pid)>>,
    pub txs: FxHashMap<Box<str>, TxReport>,
    tx_order: VecDeque<(Box<str>, usize)>,
    tx_keys_total: usize,
    /// Accounts hidden by the operator (read-time filter).
    pub hidden: FxHashSet<Aid>,
    /// NEAR Legion membership (read-time filter); `None` with Legion off.
    pub legion: Option<crate::legion::Members>,
    /// (block height, block ms) of every block with rows, to date any seq.
    pub block_times: Vec<(u64, u64)>,
    pub last_block_height: u64,
    pub last_block_ms: u64,
    pub counts: Counts,
}

fn edge_value(value: &Value) -> (bool, KeyStatus, Option<String>) {
    match value {
        Value::Object(_) => (true, KeyStatus::Ok, None),
        Value::Null => (false, KeyStatus::Ok, None),
        _ => (
            false,
            KeyStatus::Invalid,
            Some("edge value must be an object or null".into()),
        ),
    }
}

type RowResult = (KeyStatus, Option<String>);

const OK: RowResult = (KeyStatus::Ok, None);
const RATE_LIMITED: RowResult = (KeyStatus::RateLimited, None);

impl State {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn aid(&self, name: &str) -> Option<Aid> {
        self.aid_by_name.get(name).copied()
    }

    pub fn account(&self, aid: Aid) -> &Account {
        &self.accounts[aid as usize]
    }

    pub fn post(&self, pid: Pid) -> &Post {
        &self.posts[pid as usize]
    }

    pub fn pid(&self, author: &str, id: u64) -> Option<Pid> {
        let author = self.aid(author)?;
        self.pid_by_key.get(&PostKey { author, id }).copied()
    }

    pub fn post_key_string(&self, pid: Pid) -> String {
        let key = self.post(pid).key;
        format!("{}/{}", self.account(key.author).name, key.id)
    }

    fn intern(&mut self, name: &str) -> Aid {
        if let Some(&aid) = self.aid_by_name.get(name) {
            return aid;
        }
        let aid = self.accounts.len() as Aid;
        self.accounts.push(Account::new(name));
        self.aid_by_name.insert(name.into(), aid);
        aid
    }

    fn get_or_stub(&mut self, key: PostKey) -> Pid {
        if let Some(&pid) = self.pid_by_key.get(&key) {
            return pid;
        }
        let pid = self.posts.len() as Pid;
        self.posts.push(Post::stub(key));
        self.pid_by_key.insert(key, pid);
        pid
    }

    fn post_ref(&mut self, r: &(String, u64)) -> Pid {
        let author = self.intern(&r.0);
        self.get_or_stub(PostKey { author, id: r.1 })
    }

    fn acc(&mut self, aid: Aid) -> &mut Account {
        &mut self.accounts[aid as usize]
    }

    fn pst(&mut self, pid: Pid) -> &mut Post {
        &mut self.posts[pid as usize]
    }

    pub fn apply_block(&mut self, block: &LogBlock) -> BlockEffects {
        let ms = block.timestamp_ms();
        let mut fx = BlockEffects {
            block_height: block.b,
            block_ts: ms,
            ..Default::default()
        };
        let mut row: u32 = 0;
        for action in &block.a {
            let mut report = ActionReport {
                kind: ActionKind::Kv,
                status: action.s,
                keys: vec![],
                file: None,
            };
            for (key, value) in &action.r {
                let (status, reason) = if row < MAX_ROWS_PER_BLOCK {
                    let seq = make_seq(block.b, row);
                    row += 1;
                    self.apply_row(seq, ms, &action.p, key, value, &mut fx)
                } else {
                    (KeyStatus::RateLimited, Some("block row limit".into()))
                };
                report.keys.push(KeyReport {
                    key: key.as_str().into(),
                    status,
                    reason: reason.map(Into::into),
                });
            }
            for (key, reason) in &action.d {
                report.keys.push(KeyReport {
                    key: key.as_str().into(),
                    status: match reason {
                        DropReason::KeyTooLong => KeyStatus::KeyTooLong,
                        DropReason::ValueTooLarge => KeyStatus::ValueTooLarge,
                    },
                    reason: None,
                });
            }
            if let Some(tx) = &action.tx {
                self.record_tx(tx, block.b, ms, &action.p, report);
                if !fx.tx_hashes.contains(tx) {
                    fx.tx_hashes.push(tx.clone());
                }
            }
        }
        if self.block_times.last().is_none_or(|&(b, _)| b < block.b) {
            self.block_times.push((block.b, ms));
        }
        self.last_block_height = block.b;
        self.last_block_ms = ms;
        fx
    }

    /// Block time (ms) of the block a seq belongs to.
    pub fn seq_ms(&self, seq: Seq) -> u64 {
        let height = seq_block_height(seq);
        match self.block_times.binary_search_by_key(&height, |&(b, _)| b) {
            Ok(i) => self.block_times[i].1,
            Err(i) => self.block_times.get(i.saturating_sub(1)).map_or(0, |&(_, ms)| ms),
        }
    }

    /// Records a FastFS upload to the social account so `/v1/tx` can confirm it (uploads don't
    /// touch the social state and aren't kept in the event log).
    pub fn record_fastfs(&mut self, tx: &str, block_height: u64, block_ms: u64, predecessor: &str, header: Option<FastfsHeader>) {
        let report = ActionReport {
            kind: ActionKind::Fastfs,
            status: if header.is_some() { ActionStatus::Ok } else { ActionStatus::InvalidBorsh },
            keys: vec![],
            file: header,
        };
        self.record_tx(tx, block_height, block_ms, predecessor, report);
    }

    fn record_tx(&mut self, tx: &str, block_height: u64, block_ms: u64, predecessor: &str, report: ActionReport) {
        let n = report.keys.len();
        self.tx_keys_total += n;
        if let Some(existing) = self.txs.get_mut(tx) {
            existing.actions.push(report);
        } else {
            self.txs.insert(
                tx.into(),
                TxReport {
                    block_height,
                    block_ms,
                    predecessor: predecessor.into(),
                    actions: vec![report],
                },
            );
        }
        self.tx_order.push_back((tx.into(), n));
        while self.tx_order.len() > MAX_TX_REPORTS || self.tx_keys_total > MAX_TX_REPORT_KEYS {
            let Some((old, n)) = self.tx_order.pop_front() else {
                break;
            };
            self.tx_keys_total -= n;
            // A tx can span several entries; drop it with its first one.
            self.txs.remove(&old);
        }
    }

    fn apply_row(&mut self, seq: Seq, ms: u64, author_name: &str, key: &str, raw: &str, fx: &mut BlockEffects) -> RowResult {
        let parsed = parse_key(key);
        match parsed {
            Key::Unknown | Key::ReplyLink => return (KeyStatus::Ignored, None),
            Key::Invalid(reason) => return (KeyStatus::Invalid, Some(reason.into())),
            _ => {}
        }
        let value: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
        let author = self.intern(author_name);
        {
            let quota = &mut self.acc(author).quota;
            let day = ms / DAY_MS;
            if quota.day != day {
                *quota = Quota {
                    day,
                    ..Default::default()
                };
            }
            if quota.bytes + raw.len() as u64 > MAX_DAILY_BYTES {
                return RATE_LIMITED;
            }
        }
        let result = match parsed {
            Key::Profile(field) => self.apply_profile_field(author, field, &value),
            Key::ProfileLink(service) => self.apply_profile_link(author, service, &value),
            Key::Post(id) => self.apply_post(author, id, &value, seq, ms, fx),
            Key::Like(target, id) => self.apply_like(author, target, id, &value, seq, ms),
            Key::Repost(target, id) => self.apply_repost(author, target, id, &value, seq, ms),
            Key::Follow(target) => self.apply_follow(author, target, &value, seq, ms),
            Key::Unknown | Key::ReplyLink | Key::Invalid(_) => unreachable!(),
        };
        if result.0 != KeyStatus::RateLimited {
            let account = self.acc(author);
            account.quota.bytes += raw.len() as u64;
            if account.joined_ms.is_none() {
                account.joined_ms = Some(ms);
                self.counts.accounts += 1;
            }
            if !fx.accounts.iter().any(|a| a == author_name) {
                fx.accounts.push(author_name.to_string());
            }
        }
        result
    }

    fn apply_profile_field(&mut self, author: Aid, field: ProfileField, value: &Value) -> RowResult {
        let (new, result) = match values::parse_profile_field(field, value) {
            Ok(v) => (v, OK),
            Err(reason) => (None, (KeyStatus::Invalid, Some(reason))),
        };
        *self.acc(author).profile.field_mut(field) = new.map(Into::into);
        result
    }

    fn apply_profile_link(&mut self, author: Aid, service: &str, value: &Value) -> RowResult {
        let links = &mut self.acc(author).profile.links;
        match values::parse_profile_link(value) {
            Ok(Some(link)) => {
                if links.len() >= MAX_STORED_LINKS && !links.contains_key(service) {
                    return (KeyStatus::Invalid, Some("too many links".into()));
                }
                links.insert(service.into(), link.into());
                OK
            }
            Ok(None) => {
                links.remove(service);
                OK
            }
            Err(reason) => {
                links.remove(service);
                (KeyStatus::Invalid, Some(reason))
            }
        }
    }

    fn build_body(&mut self, author: Aid, v: PostValue) -> PostBody {
        let tokens = text::extract(&v.text);
        let reply_to = v.reply_to.as_ref().map(|r| self.post_ref(r));
        let root = v.root.as_ref().map(|r| self.post_ref(r));
        let quote = v.quote.as_ref().map(|r| self.post_ref(r));
        let mentions: Vec<Aid> = tokens
            .mentions
            .iter()
            .map(|m| self.intern(m))
            .filter(|&m| m != author)
            .collect();
        PostBody {
            text: v.text.into(),
            media: v
                .media
                .into_iter()
                .map(|m| Media {
                    src: m.src.into(),
                    mime: m.mime.into(),
                    w: m.w,
                    h: m.h,
                    alt: m.alt.map(Into::into),
                })
                .collect(),
            reply_to,
            root,
            quote,
            mentions: mentions.into(),
            hashtags: tokens.hashtags.into_iter().map(Into::into).collect(),
        }
    }

    fn apply_post(&mut self, author: Aid, id: u64, value: &Value, seq: Seq, ms: u64, fx: &mut BlockEffects) -> RowResult {
        let author_name = self.account(author).name.clone();
        let (parsed, result) = if value.is_null() {
            (None, OK)
        } else {
            match values::parse_post(&author_name, id, value) {
                Ok(v) => (Some(v), OK),
                Err(reason) => (None, (KeyStatus::Invalid, Some(reason))),
            }
        };
        let pid = self.get_or_stub(PostKey { author, id });
        let was_live = self.post(pid).is_live();
        let first_creation = parsed.is_some() && self.post(pid).created.is_none();
        if parsed.is_some() && !was_live {
            let quota = &mut self.acc(author).quota;
            if quota.posts >= MAX_DAILY_POSTS {
                return RATE_LIMITED;
            }
            quota.posts += 1;
        }
        let new_body = parsed.map(|v| self.build_body(author, v));
        let now_live = new_body.is_some();
        let old_body = std::mem::replace(&mut self.pst(pid).body, new_body);

        let old_parent = old_body.as_ref().and_then(|b| b.reply_to);
        let old_quote = old_body.as_ref().and_then(|b| b.quote);
        let (new_parent, new_quote, new_mentions, new_tags) = match &self.post(pid).body {
            Some(b) => (b.reply_to, b.quote, b.mentions.to_vec(), b.hashtags.to_vec()),
            None => (None, None, vec![], vec![]),
        };

        match (was_live, now_live) {
            (false, true) => {
                self.acc(author).live_posts += 1;
                self.counts.posts += 1;
            }
            (true, false) => {
                self.acc(author).live_posts -= 1;
                self.counts.posts -= 1;
            }
            _ => {}
        }
        if first_creation {
            self.pst(pid).created = Some((seq, ms));
            self.created.push((seq, pid));
            self.acc(author).timeline.push((seq, Entry::Post(pid)));
        } else if now_live {
            // An edit, or re-creation after a delete (keeps the original position).
            self.pst(pid).edited_ms = Some(ms);
        }

        if old_parent != new_parent {
            if let Some(p) = old_parent {
                self.pst(p).replies -= 1;
            }
            if let Some(p) = new_parent {
                let parent = self.pst(p);
                parent.replies += 1;
                parent.children.push(pid);
            }
        }
        if old_quote != new_quote {
            if let Some(q) = old_quote {
                self.pst(q).quotes -= 1;
            }
            if let Some(q) = new_quote {
                let quoted = self.pst(q);
                quoted.quotes += 1;
                quoted.quoted_by.push(pid);
            }
        }
        if now_live {
            let created_seq = self.post(pid).created.map(|c| c.0).unwrap_or(seq);
            for tag in new_tags {
                let list = self.hashtags.entry(tag).or_default();
                let entry = (created_seq, pid);
                if let Err(pos) = list.binary_search(&entry) {
                    list.insert(pos, entry);
                }
            }
        }

        if first_creation {
            let parent_author = new_parent.map(|p| self.post(p).key.author);
            if let Some(recipient) = parent_author {
                self.notify(recipient, NotifKind::Reply, author, Some(pid), seq, ms);
            }
            if let Some(q) = new_quote {
                let recipient = self.post(q).key.author;
                self.notify(recipient, NotifKind::Quote, author, Some(pid), seq, ms);
            }
            for m in new_mentions.into_iter().take(MAX_MENTION_NOTIFICATIONS) {
                if Some(m) != parent_author {
                    self.notify(m, NotifKind::Mention, author, Some(pid), seq, ms);
                }
            }
        }
        fx.posts.push(format!("{author_name}/{id}"));
        result
    }

    fn apply_like(&mut self, author: Aid, target: &str, id: u64, value: &Value, seq: Seq, ms: u64) -> RowResult {
        let (active, status, reason) = edge_value(value);
        let target_author = self.intern(target);
        let pid = self.get_or_stub(PostKey {
            author: target_author,
            id,
        });
        let was = self.likes.contains_key(&(author, pid));
        if active && !was {
            let quota = &mut self.acc(author).quota;
            if quota.likes >= MAX_DAILY_LIKES {
                return RATE_LIMITED;
            }
            quota.likes += 1;
            self.likes.insert((author, pid), seq);
            let post = self.pst(pid);
            post.likes += 1;
            post.likers.push((seq, author));
            self.acc(author).liked.push((seq, pid));
            self.counts.likes += 1;
            self.notify(target_author, NotifKind::Like, author, Some(pid), seq, ms);
        } else if !active && was {
            self.likes.remove(&(author, pid));
            self.pst(pid).likes -= 1;
            self.counts.likes -= 1;
        }
        (status, reason)
    }

    fn apply_repost(&mut self, author: Aid, target: &str, id: u64, value: &Value, seq: Seq, ms: u64) -> RowResult {
        let (active, status, reason) = edge_value(value);
        let target_author = self.intern(target);
        let pid = self.get_or_stub(PostKey {
            author: target_author,
            id,
        });
        let was = self.reposts.contains_key(&(author, pid));
        if active && !was {
            let quota = &mut self.acc(author).quota;
            if quota.reposts >= MAX_DAILY_REPOSTS {
                return RATE_LIMITED;
            }
            quota.reposts += 1;
            self.reposts.insert((author, pid), seq);
            let post = self.pst(pid);
            post.reposts += 1;
            post.reposters.push((seq, author));
            self.acc(author).timeline.push((seq, Entry::Repost(pid)));
            self.notify(target_author, NotifKind::Repost, author, Some(pid), seq, ms);
        } else if !active && was {
            self.reposts.remove(&(author, pid));
            self.pst(pid).reposts -= 1;
        }
        (status, reason)
    }

    fn apply_follow(&mut self, author: Aid, target: &str, value: &Value, seq: Seq, ms: u64) -> RowResult {
        let (active, status, reason) = edge_value(value);
        let target = self.intern(target);
        if target == author {
            return (KeyStatus::Invalid, Some("can't follow yourself".into()));
        }
        let was = self.account(author).following.contains_key(&target);
        if active && !was {
            if self.account(author).following.len() >= MAX_FOLLOWING {
                return RATE_LIMITED;
            }
            let a = self.acc(author);
            a.following.insert(target, seq);
            a.following_log.push((seq, target));
            let t = self.acc(target);
            t.followers.insert(author, seq);
            t.followers_log.push((seq, author));
            self.counts.follows += 1;
            self.notify(target, NotifKind::Follow, author, None, seq, ms);
        } else if !active && was {
            self.acc(author).following.remove(&target);
            self.acc(target).followers.remove(&author);
            self.counts.follows -= 1;
        }
        (status, reason)
    }

    fn notify(&mut self, recipient: Aid, kind: NotifKind, actor: Aid, post: Option<Pid>, seq: Seq, ms: u64) {
        if recipient == actor {
            return;
        }
        let notifs = &mut self.acc(recipient).notifs;
        let duplicate = notifs
            .iter()
            .rev()
            .take(NOTIFICATION_DEDUP_WINDOW)
            .any(|n| n.kind == kind && n.actor == actor && n.post == post);
        if duplicate {
            return;
        }
        notifs.push(Notif {
            seq,
            ms,
            kind,
            actor,
            post,
        });
        if notifs.len() > MAX_NOTIFICATIONS {
            notifs.drain(..MAX_NOTIFICATIONS / 6);
        }
    }

    /// Replaces the set of hidden accounts (denylist).
    pub fn set_hidden(&mut self, names: &[String]) {
        let hidden = names.iter().map(|n| self.intern(n)).collect();
        self.hidden = hidden;
    }

    pub fn is_hidden(&self, aid: Aid) -> bool {
        self.hidden.contains(&aid) || self.is_outside_legion(aid)
    }
}

#[cfg(test)]
mod tests;
