//! JSON shapes of docs/API.md, built from borrowed state (serialize while holding the lock).

use crate::model::values::media_url;
use crate::state::query::LinkTarget;
use crate::unfurl::{self, Preview, Unfurler};
use std::sync::Arc;
use crate::state::query::{FeedEntry, NotifGroup};
use crate::legion::Rank;
use crate::state::{Aid, NotifKind, Pid, Seq, State};
use serde::Serialize;
use std::collections::BTreeMap;

const CARD_ABOUT_CHARS: usize = 300;

pub struct Ctx<'a> {
    pub state: &'a State,
    pub viewer: Option<Aid>,
    pub gateway: &'a str,
    pub site_hosts: &'a [String],
    /// Link previews come from its cache only (no I/O while hydrating).
    pub unfurl: Option<&'a Unfurler>,
}

#[derive(Serialize)]
pub struct AccountSummary<'a> {
    pub account_id: &'a str,
    pub name: Option<&'a str>,
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank: Option<Rank>,
}

#[derive(Serialize)]
pub struct AccountViewer {
    pub following: bool,
    pub followed_by: bool,
}

#[derive(Serialize)]
pub struct AccountCard<'a> {
    pub account_id: &'a str,
    pub name: Option<&'a str>,
    pub avatar_url: Option<String>,
    pub about: Option<String>,
    pub followers: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank: Option<Rank>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer: Option<AccountViewer>,
    pub cursor: String,
}

#[derive(Serialize)]
pub struct ProfileCounts {
    pub followers: usize,
    pub following: usize,
    pub posts: u32,
}

#[derive(Serialize)]
pub struct ProfileDto<'a> {
    pub account_id: &'a str,
    pub has_profile: bool,
    pub name: Option<&'a str>,
    pub about: Option<&'a str>,
    pub avatar: Option<&'a str>,
    pub avatar_url: Option<String>,
    pub banner: Option<&'a str>,
    pub banner_url: Option<String>,
    pub location: Option<&'a str>,
    pub links: BTreeMap<&'a str, &'a str>,
    pub counts: ProfileCounts,
    pub joined_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank: Option<Rank>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer: Option<AccountViewer>,
}

#[derive(Serialize)]
pub struct MediaDto<'a> {
    pub src: &'a str,
    pub url: String,
    pub mime: &'a str,
    pub w: Option<u32>,
    pub h: Option<u32>,
    pub alt: Option<&'a str>,
}

#[derive(Serialize)]
pub struct PostCounts {
    pub replies: u32,
    pub reposts: u32,
    pub likes: u32,
    pub quotes: u32,
}

#[derive(Serialize)]
pub struct PostViewer {
    pub liked: bool,
    pub reposted: bool,
}

#[derive(Serialize)]
pub struct ReplyTo<'a> {
    pub key: String,
    pub author: AccountSummary<'a>,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum QuoteDto<'a> {
    Post(Box<PostDto<'a>>),
    Unavailable { key: String, unavailable: bool },
}

/// The link a post is decorated with: a linked post (shown as a quote) or a URL preview.
#[derive(Serialize)]
pub struct LinkDto<'a> {
    /// The URL as written in the post text.
    pub url: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post: Option<Box<PostDto<'a>>>,
    /// Absent until fetched: `GET /v1/posts/{account}/{id}/preview`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<Arc<Preview>>,
}

#[derive(Serialize)]
pub struct PostDto<'a> {
    pub key: String,
    pub id: String,
    pub author: AccountSummary<'a>,
    pub text: &'a str,
    pub media: Vec<MediaDto<'a>>,
    pub created_at: u64,
    pub block_height: u64,
    pub edited_at: Option<u64>,
    pub reply_to: Option<ReplyTo<'a>>,
    pub root: Option<String>,
    pub quote: Option<QuoteDto<'a>>,
    pub mentions: Vec<&'a str>,
    pub hashtags: Vec<&'a str>,
    /// The channel the post was written to; `None` on `social` (docs/LEGION.md §3).
    pub channel: Option<&'a str>,
    pub counts: PostCounts,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer: Option<PostViewer>,
    /// Only on top-level posts (never on quoted ones).
    pub link: Option<LinkDto<'a>>,
}

#[derive(Serialize)]
pub struct FeedItem<'a> {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub post: PostDto<'a>,
    pub reposted_by: Option<AccountSummary<'a>>,
    pub reposted_at: Option<u64>,
    pub cursor: String,
    /// For You only: `following`, `trending` or `new`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

#[derive(Serialize)]
pub struct NotificationDto<'a> {
    pub kind: NotifKind,
    pub actors: Vec<AccountSummary<'a>>,
    pub actor_count: u32,
    pub post: Option<PostDto<'a>>,
    pub created_at: u64,
    pub cursor: String,
}

#[derive(Serialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

impl<T> Page<T> {
    /// A page whose next cursor is the last item's cursor when the page is full.
    pub fn from_items(items: Vec<T>, limit: usize, cursor: impl Fn(&T) -> String) -> Self {
        let next_cursor = (items.len() >= limit).then(|| items.last().map(&cursor)).flatten();
        Self { items, next_cursor }
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

impl<'a> Ctx<'a> {
    fn url(&self, uri: &str) -> String {
        media_url(self.gateway, uri)
    }

    /// A non-member named by a member's post (e.g. a reply's parent) shows its ID only.
    pub fn summary(&self, aid: Aid) -> AccountSummary<'a> {
        let account = self.state.account(aid);
        let profile = (!self.state.is_outside_legion(aid)).then_some(&account.profile);
        AccountSummary {
            account_id: &account.name,
            name: profile.and_then(|p| p.name.as_deref()),
            avatar_url: profile.and_then(|p| p.avatar.as_deref()).map(|a| self.url(a)),
            rank: self.state.rank(aid),
        }
    }

    pub fn account_viewer(&self, aid: Aid) -> Option<AccountViewer> {
        let viewer = self.viewer?;
        Some(AccountViewer {
            following: self.state.account(viewer).following.contains_key(&aid),
            followed_by: self.state.account(aid).following.contains_key(&viewer),
        })
    }

    pub fn card(&self, aid: Aid, cursor: String) -> AccountCard<'a> {
        let account = self.state.account(aid);
        AccountCard {
            account_id: &account.name,
            name: account.profile.name.as_deref(),
            avatar_url: account.profile.avatar.as_deref().map(|a| self.url(a)),
            about: account.profile.about.as_deref().map(|a| truncate_chars(a, CARD_ABOUT_CHARS)),
            followers: self.state.follower_count(aid),
            rank: self.state.rank(aid),
            viewer: self.account_viewer(aid),
            cursor,
        }
    }

    pub fn cards(&self, list: &[(Seq, Aid)]) -> Vec<AccountCard<'a>> {
        list.iter().map(|&(seq, aid)| self.card(aid, seq.to_string())).collect()
    }

    /// A profile for any valid account ID (`aid` is `None` for accounts never seen). A non-member
    /// reads as never seen, except to itself: its own profile must not look empty, or the web app
    /// would send it to onboarding over the profile it has.
    pub fn profile(&self, account_id: &'a str, aid: Option<Aid>) -> ProfileDto<'a> {
        let Some(aid) = aid.filter(|&aid| !self.state.is_outside_legion(aid) || self.viewer == Some(aid)) else {
            return ProfileDto {
                account_id,
                has_profile: false,
                name: None,
                about: None,
                avatar: None,
                avatar_url: None,
                banner: None,
                banner_url: None,
                location: None,
                links: BTreeMap::new(),
                counts: ProfileCounts {
                    followers: 0,
                    following: 0,
                    posts: 0,
                },
                joined_at: None,
                rank: None,
                viewer: self.viewer.map(|_| AccountViewer {
                    following: false,
                    followed_by: false,
                }),
            };
        };
        let account = self.state.account(aid);
        let p = &account.profile;
        ProfileDto {
            account_id: &account.name,
            has_profile: p.exists(),
            name: p.name.as_deref(),
            about: p.about.as_deref(),
            avatar: p.avatar.as_deref(),
            avatar_url: p.avatar.as_deref().map(|a| self.url(a)),
            banner: p.banner.as_deref(),
            banner_url: p.banner.as_deref().map(|a| self.url(a)),
            location: p.location.as_deref(),
            links: p
                .links
                .iter()
                .take(crate::state::MAX_SERVED_LINKS)
                .map(|(k, v)| (&**k, &**v))
                .collect(),
            counts: ProfileCounts {
                followers: self.state.follower_count(aid),
                following: self.state.following_count(aid),
                posts: account.live_posts,
            },
            joined_at: account.joined_ms,
            rank: self.state.rank(aid),
            viewer: self.account_viewer(aid),
        }
    }

    /// A hydrated post, or `None` if it isn't visible. `with_quote` embeds the quoted post.
    pub fn post(&self, pid: Pid, with_quote: bool) -> Option<PostDto<'a>> {
        if !self.state.is_visible(pid) {
            return None;
        }
        let post = self.state.post(pid);
        let body = post.body.as_ref()?;
        let (created_seq, created_ms) = post.created?;
        // Quoted posts are shallow: no quote or link of their own.
        let quote = body.quote.filter(|_| with_quote).map(|q| match self.post(q, false) {
            Some(p) => QuoteDto::Post(Box::new(p)),
            None => QuoteDto::Unavailable {
                key: self.state.post_key_string(q),
                unavailable: true,
            },
        });
        let link = if with_quote { self.link(pid) } else { None };
        Some(PostDto {
            key: self.state.post_key_string(pid),
            id: post.key.id.to_string(),
            author: self.summary(post.key.author),
            text: &body.text,
            media: body
                .media
                .iter()
                .map(|m| MediaDto {
                    src: &m.src,
                    url: self.url(&m.src),
                    mime: &m.mime,
                    w: m.w,
                    h: m.h,
                    alt: m.alt.as_deref(),
                })
                .collect(),
            created_at: created_ms,
            block_height: crate::state::seq_block_height(created_seq),
            edited_at: post.edited_ms,
            reply_to: body.reply_to.map(|p| ReplyTo {
                key: self.state.post_key_string(p),
                author: self.summary(self.state.post(p).key.author),
            }),
            root: body.root.map(|p| self.state.post_key_string(p)),
            quote,
            mentions: body.mentions.iter().map(|&a| &*self.state.account(a).name).collect(),
            hashtags: body.hashtags.iter().map(|t| &**t).collect(),
            channel: self.state.channel_of(pid),
            counts: {
                let (likes, reposts, replies, quotes) = self.state.post_counts(pid);
                PostCounts { replies, reposts, likes, quotes }
            },
            viewer: self.viewer.map(|v| PostViewer {
                liked: self.state.likes.contains_key(&(v, pid)),
                reposted: self.state.reposts.contains_key(&(v, pid)),
            }),
            link,
        })
    }

    fn link(&self, pid: Pid) -> Option<LinkDto<'a>> {
        let (url, target) = self.state.post_link(pid, self.site_hosts)?;
        Some(match target {
            LinkTarget::Post(linked) => LinkDto {
                url,
                post: self.post(linked, false).map(Box::new),
                preview: None,
            },
            LinkTarget::Url(kind) => LinkDto {
                url,
                post: None,
                preview: unfurl::youtube(&kind)
                    .map(Arc::new)
                    .or_else(|| self.unfurl.and_then(|u| u.cached(url))),
            },
        })
    }

    pub fn feed_item(&self, entry: &FeedEntry) -> Option<FeedItem<'a>> {
        let post = self.post(entry.pid(), true)?;
        Some(match *entry {
            FeedEntry::Post { seq, .. } => FeedItem {
                kind: "post",
                post,
                reposted_by: None,
                reposted_at: None,
                cursor: seq.to_string(),
                reason: None,
            },
            FeedEntry::Repost { seq, by, .. } => FeedItem {
                kind: "repost",
                post,
                reposted_by: Some(self.summary(by)),
                reposted_at: Some(self.state.seq_ms(seq)),
                cursor: seq.to_string(),
                reason: None,
            },
        })
    }

    pub fn feed(&self, entries: &[FeedEntry]) -> Vec<FeedItem<'a>> {
        entries.iter().filter_map(|e| self.feed_item(e)).collect()
    }

    pub fn notifications(&self, groups: &[NotifGroup]) -> Vec<NotificationDto<'a>> {
        groups
            .iter()
            .map(|g| NotificationDto {
                kind: g.kind,
                actors: g.actors.iter().map(|&a| self.summary(a)).collect(),
                actor_count: g.actor_count,
                post: g.post.and_then(|p| self.post(p, true)),
                created_at: g.ms,
                cursor: g.cursor.to_string(),
            })
            .collect()
    }
}
