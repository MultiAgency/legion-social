//! Home feeds (docs/LEGION.md §4): feeds that pick posts by who wrote them. Everyone is upstream's
//! global feed; these three are Legion's, served only with Legion on.
//!
//! - Legion: members' `social` posts (`?source=members`), and Legion space: members' posts sent to
//!   the Legion feed account (`?source=space`). Without `source`, both.
//! - Names: `social` posts by accounts named `*.{tla}`, such as `.agency`.
//! - Builders: `social` posts by NearBuilders members (`legion::builders`).
//!
//! Like global, each lists top-level posts, newest first, and takes an optional `?tag=`.

use crate::legion::builders;
use crate::api::{account_param, feed_page, respond, ApiError, AppState, ListQuery};
use crate::state::query::{newest_first, FeedEntry, MAX_SCAN};
use crate::state::{Pid, Seq, State};
use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::json;


/// Which Legion feed `GET /v1/feed/legion?source=` lists: members' `social` posts (`members`), or
/// their posts sent to the Legion feed account (`space`). Without it, both.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum LegionSource {
    Members,
    Space,
}

#[derive(Deserialize)]
pub struct SourceQuery {
    source: Option<LegionSource>,
}

/// `?tag=`: scopes a feed to one hashtag (with or without `#`, any case).
#[derive(Deserialize)]
pub struct TagQuery {
    tag: Option<String>,
}

impl TagQuery {
    fn tag(&self) -> Option<String> {
        let tag = self.tag.as_deref()?.trim().trim_start_matches('#').to_lowercase();
        (!tag.is_empty()).then_some(tag)
    }
}

/// Whether `tla` can be the last part of an account ID, such as `agency` or `near`.
pub fn is_name_suffix(tla: &str) -> bool {
    (2..=64).contains(&tla.len())
        && tla.split(['-', '_']).all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

impl State {
    fn has_tag(&self, pid: Pid, tag: &str) -> bool {
        self.body(pid).is_some_and(|b| b.hashtags.iter().any(|t| &**t == tag))
    }

    /// A home feed's visible top-level posts, newest first: every post, or a hashtag's, that
    /// `keep` lets in.
    fn home_feed(&self, tag: Option<&str>, before: Option<Seq>, limit: usize, keep: impl Fn(Pid) -> bool) -> Vec<FeedEntry> {
        let source = match tag {
            Some(tag) => self.hashtags.get(tag).map_or(&[][..], Vec::as_slice),
            None => &self.created[..],
        };
        newest_first(source, before)
            .take(MAX_SCAN)
            .filter(|&&(_, pid)| {
                self.is_visible(pid)
                    && self.body(pid).is_some_and(|b| b.reply_to.is_none())
                    && tag.is_none_or(|tag| self.has_tag(pid, tag))
                    && keep(pid)
            })
            .map(|&(seq, pid)| FeedEntry::Post { seq, pid })
            .take(limit)
            .collect()
    }

    /// The Legion feed: members' posts sent to the Legion feed account (`LEGION_FEED`), or on
    /// `social` with #legion.
    /// `source` picks one of the two: `Members` (Legion: members' `social` posts) or `Space`
    /// (Legion space: members' posts sent to the Legion feed account); `None` is both.
    pub fn feed_legion(&self, source: Option<LegionSource>, tag: Option<&str>, before: Option<Seq>, limit: usize) -> Vec<FeedEntry> {
        let Some(legion) = self.legion_feed() else { return vec![] };
        self.home_feed(tag, before, limit, |pid| {
            self.rank(self.post(pid).key.author).is_some()
                && match (self.channel_of(pid), source) {
                    (Some(feed), None | Some(LegionSource::Space)) => feed == legion,
                    (None, None | Some(LegionSource::Members)) => true,
                    _ => false,
                }
        })
    }

    /// A name feed: `social` posts by accounts named `*.{tla}`.
    pub fn feed_names(&self, tla: &str, tag: Option<&str>, before: Option<Seq>, limit: usize) -> Vec<FeedEntry> {
        let suffix = format!(".{tla}");
        self.home_feed(tag, before, limit, |pid| {
            self.on_social(pid) && self.account(self.post(pid).key.author).name.ends_with(&suffix)
        })
    }

    /// The Builders feed: `social` posts by NearBuilders members.
    pub fn feed_builders(&self, members: &builders::Members, tag: Option<&str>, before: Option<Seq>, limit: usize) -> Vec<FeedEntry> {
        self.home_feed(tag, before, limit, |pid| {
            self.on_social(pid) && members.contains(&*self.account(self.post(pid).key.author).name)
        })
    }
}

/// The home feed routes, registered with the other feed routes (only with Legion on).
pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/v1/feed/legion", web::get().to(legion_feed))
        .route("/v1/feed/names/{tla}", web::get().to(names_feed))
        .route("/v1/feed/builders", web::get().to(builders_feed))
        .route("/v1/builders/{account}", web::get().to(builder));
}

type App = web::Data<AppState>;

async fn legion_feed(app: App, q: web::Query<ListQuery>, t: web::Query<TagQuery>, s: web::Query<SourceQuery>) -> HttpResponse {
    respond((|| {
        let state = app.state.read();
        let entries = state.feed_legion(s.source, t.tag().as_deref(), q.cursor()?, q.limit());
        feed_page(&app, &state, &q, entries)
    })())
}

async fn names_feed(app: App, path: web::Path<String>, q: web::Query<ListQuery>, t: web::Query<TagQuery>) -> HttpResponse {
    respond((|| {
        if !is_name_suffix(&path) {
            return Err(ApiError::bad_request(format!("invalid name suffix: {path}")));
        }
        let state = app.state.read();
        let entries = state.feed_names(&path, t.tag().as_deref(), q.cursor()?, q.limit());
        feed_page(&app, &state, &q, entries)
    })())
}

async fn builders_feed(app: App, q: web::Query<ListQuery>, t: web::Query<TagQuery>) -> HttpResponse {
    respond((|| {
        let members = builders::members();
        let state = app.state.read();
        let entries = state.feed_builders(&members, t.tag().as_deref(), q.cursor()?, q.limit());
        feed_page(&app, &state, &q, entries)
    })())
}

/// `GET /v1/builders/{account}`: `{account_id, builder}`.
async fn builder(path: web::Path<String>) -> HttpResponse {
    respond((|| {
        let account = account_param(&path)?;
        Ok(HttpResponse::Ok()
            .insert_header((actix_web::http::header::CACHE_CONTROL, "public, max-age=60"))
            .json(json!({ "account_id": account, "builder": builders::members().contains(account) })))
    })())
}

#[cfg(test)]
mod tests;
