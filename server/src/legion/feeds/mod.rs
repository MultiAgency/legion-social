//! Feeds (docs/LEGION.md §3): posts written to an account that doesn't exist (an unclaimed name,
//! such as `legion`) instead of `social`.
//!
//! With Legion on, the tailer keeps the post rows of `__fastdata_kv` actions whose receipt failed
//! with `AccountDoesNotExist` for their receiver, and tags them with that feed (`LogAction::c`).
//! Writes to existing accounts are other apps' and are never read. The first write of an author's
//! `post/{id}` fixes its feed; global, For You and trending stay `social`-only;
//! `GET /v1/feed/channel/{account}` lists a feed. With Legion off, the tailer reads `social` only
//! and replay skips feed rows already in the log (Legion is on before replay: `legion::new_state`),
//! so everything behaves exactly as upstream.

use crate::ingest::fastdata::{ActionStatus, LogAction};
use fastnear_primitives::near_primitives::errors::{ActionErrorKind, TxExecutionError};
use fastnear_primitives::near_primitives::views::ExecutionStatusView;
use crate::model::account_id::is_valid_account_id;
use crate::model::keys::{parse_key, Key};
use crate::state::query::FeedEntry;
use crate::state::{BlockEffects, KeyStatus, Pid, PostKey, Seq, State};
use rustc_hash::FxHashMap;

/// Upper bound on entries inspected per request, as in `state::query`.
const MAX_SCAN: usize = 100_000;

/// `?channel={account}`: scopes a list to one channel feed; absent or empty is `social`.
#[derive(serde::Deserialize)]
pub struct FeedQuery {
    channel: Option<String>,
}

impl FeedQuery {
    pub fn channel(&self) -> Result<Option<&str>, String> {
        match self.channel.as_deref().filter(|c| !c.is_empty()) {
            None => Ok(None),
            Some(c) if is_valid_account_id(c) => Ok(Some(c)),
            Some(c) => Err(format!("invalid channel: {c}")),
        }
    }
}

#[derive(Default)]
pub struct Channels {
    /// The channel of every post first created in one (a post on `social` has no entry).
    by_post: FxHashMap<Pid, Box<str>>,
    /// Each channel's posts, in creation order.
    feeds: FxHashMap<Box<str>, Vec<(Seq, Pid)>>,
}

/// Where a receipt's `__fastdata_kv` writes go.
#[derive(Debug, PartialEq, Eq)]
pub enum Receiver {
    /// The social account: indexed as upstream does.
    Social,
    /// A feed: an unclaimed name, whose receipt failed with `AccountDoesNotExist`.
    Feed(String),
    /// Anything else (an existing account, or feeds while Legion is off): not read.
    Other,
}

/// Classifies a receipt by its receiver and its outcome. Deterministic from chain data, so a replay
/// classifies the same way. A receiver that exists (with or without a contract) is never a feed,
/// so other apps' FastData writes can't fix a post's feed or use anyone's quota, and if a feed's
/// name is ever claimed, its writes stop being read.
pub fn classify(feeds_on: bool, social: &str, receiver: &str, status: &ExecutionStatusView) -> Receiver {
    if receiver == social {
        return Receiver::Social;
    }
    match status {
        ExecutionStatusView::Failure(TxExecutionError::ActionError(e))
            if feeds_on
                && matches!(&e.kind, ActionErrorKind::AccountDoesNotExist { account_id } if account_id.as_str() == receiver) =>
        {
            Receiver::Feed(receiver.to_string())
        }
        _ => Receiver::Other,
    }
}

/// Keys a channel keeps: posts and their reply backlinks (social-kv/1 §3.2–3.3).
fn counts_in_channel(key: &str) -> bool {
    key.starts_with("post/") || key.starts_with("reply/")
}

/// An action sent to `receiver` (not `social`), reduced to the rows a channel keeps and tagged
/// with its channel. `None` when nothing in it counts, so other apps' writes never reach the log.
pub fn channel_action(mut action: LogAction, receiver: &str) -> Option<LogAction> {
    if action.s != ActionStatus::Ok {
        return None;
    }
    action.r.retain(|(key, _)| counts_in_channel(key));
    action.d.retain(|(key, _)| counts_in_channel(key));
    if action.r.is_empty() && action.d.is_empty() {
        return None;
    }
    action.c = Some(receiver.to_string());
    Some(action)
}

impl State {
    /// A post of `author` with this id that has been created (its channel is fixed).
    fn created_post(&self, author: &str, id: u64) -> Option<Pid> {
        let key = PostKey { author: self.aid(author)?, id };
        let pid = *self.pid_by_key.get(&key)?;
        self.post(pid).created.is_some().then_some(pid)
    }

    /// Applies one row of an action sent to `channel` (`None`: `social`). Only posts count in a
    /// channel, and a post's first write fixes its channel: writes to it from anywhere else are
    /// ignored.
    /// Whether `apply_block` reads feed actions (`LogAction::c`) at all. Feeds are part of Legion:
    /// with it off, a feed action in the log is skipped whole, taking no row slots and no `/v1/tx`
    /// report, as upstream never reads it.
    pub(crate) fn reads_feeds(&self) -> bool {
        self.legion.is_some()
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn apply_channel_row(
        &mut self,
        channel: Option<&str>,
        seq: Seq,
        ms: u64,
        author: &str,
        key: &str,
        raw: &str,
        fx: &mut BlockEffects,
    ) -> (KeyStatus, Option<String>) {
        let Key::Post(id) = parse_key(key) else {
            return match channel {
                None => self.apply_row(seq, ms, author, key, raw, fx),
                Some(_) => (KeyStatus::Ignored, None),
            };
        };
        if let Some(pid) = self.created_post(author, id) {
            if self.channel_of(pid) != channel {
                return (KeyStatus::Ignored, Some("the post belongs to another channel".into()));
            }
            return self.apply_row(seq, ms, author, key, raw, fx);
        }
        let result = self.apply_row(seq, ms, author, key, raw, fx);
        if let (Some(channel), Some(pid)) = (channel, self.created_post(author, id)) {
            let created = self.post(pid).created.map_or(seq, |c| c.0);
            self.channels.by_post.insert(pid, channel.into());
            self.channels.feeds.entry(channel.into()).or_default().push((created, pid));
        }
        result
    }

    /// The channel a post was created in; `None` for a post on `social`.
    pub fn channel_of(&self, pid: Pid) -> Option<&str> {
        self.channels.by_post.get(&pid).map(|c| &**c)
    }

    /// Whether a post is on `social`: global and For You show only these.
    pub fn on_social(&self, pid: Pid) -> bool {
        !self.channels.by_post.contains_key(&pid)
    }

    /// Posts tagged `tag` in one feed, newest first (`hashtag_feed` is `social`'s).
    pub fn feed_hashtag(&self, feed: &str, tag: &str, before: Option<Seq>, limit: usize) -> Vec<FeedEntry> {
        let Some(list) = self.hashtags.get(tag) else {
            return vec![];
        };
        let end = before.map_or(list.len(), |b| list.partition_point(|e| e.0 < b));
        list[..end]
            .iter()
            .rev()
            .take(MAX_SCAN)
            .filter(|&&(_, pid)| {
                self.is_visible(pid)
                    && self.channel_of(pid) == Some(feed)
                    && self.post(pid).body.as_ref().is_some_and(|b| b.hashtags.iter().any(|t| &**t == tag))
            })
            .map(|&(seq, pid)| FeedEntry::Post { seq, pid })
            .take(limit)
            .collect()
    }

    /// A channel's visible posts and replies, newest first.
    pub fn feed_channel(&self, channel: &str, before: Option<Seq>, limit: usize) -> Vec<FeedEntry> {
        let Some(posts) = self.channels.feeds.get(channel) else {
            return vec![];
        };
        let end = before.map_or(posts.len(), |b| posts.partition_point(|e| e.0 < b));
        posts[..end]
            .iter()
            .rev()
            .take(MAX_SCAN)
            .filter(|&&(_, pid)| self.is_visible(pid))
            .map(|&(seq, pid)| FeedEntry::Post { seq, pid })
            .take(limit)
            .collect()
    }
}

#[cfg(test)]
mod tests;
