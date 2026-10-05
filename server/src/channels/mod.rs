//! Channels (`docs/LEGION.md §3`): posts written to any account instead of `social`.
//!
//! The tailer keeps the post rows of `__fastdata_kv` actions sent to other receivers and tags
//! them with their channel (`LogAction::c`). The first write of an author's `post/{id}` fixes its
//! channel; global and For You stay `social`-only; `GET /v1/feed/channel/{account}` lists a
//! channel. With no channel writes, everything behaves exactly as upstream.

use crate::ingest::fastdata::{ActionStatus, LogAction};
use crate::model::account_id::is_valid_account_id;
use crate::model::keys::{parse_key, Key};
use crate::state::query::FeedEntry;
use crate::state::{BlockEffects, KeyStatus, Pid, PostKey, Seq, State};
use rustc_hash::FxHashMap;

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

    /// A channel's visible posts and replies, newest first.
    pub fn feed_channel(&self, channel: &str, before: Option<Seq>, limit: usize) -> Vec<FeedEntry> {
        let Some(posts) = self.channels.feeds.get(channel) else {
            return vec![];
        };
        let end = before.map_or(posts.len(), |b| posts.partition_point(|e| e.0 < b));
        posts[..end]
            .iter()
            .rev()
            .filter(|&&(_, pid)| self.is_visible(pid))
            .map(|&(seq, pid)| FeedEntry::Post { seq, pid })
            .take(limit)
            .collect()
    }
}

#[cfg(test)]
mod tests;
