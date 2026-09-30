//! Link previews (docs/API.md, `link`): Open Graph cards for web pages and near.fm songs,
//! fetched on demand and cached in memory. YouTube needs no fetch.

pub mod html;
pub mod near_fm;

use crate::config::Config;
use crate::fetch::SafeClient;
use crate::model::links::{classify, LinkKind};
use futures::future::{BoxFuture, FutureExt, Shared};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Preview {
    Card {
        title: String,
        description: Option<String>,
        site_name: Option<String>,
        /// The page's image, as published (clients show it through an image proxy).
        image: Option<String>,
        large: bool,
    },
    Youtube {
        video_id: String,
        start: Option<u32>,
        shorts: bool,
    },
    NearFm {
        uuid: String,
        title: String,
        artist: String,
        artist_url: Option<String>,
        cover: Option<String>,
        audio: String,
        mime: Option<String>,
        duration: Option<u32>,
    },
    /// The linked item exists but can't be shown (e.g. a hidden or deleted near.fm song).
    Unavailable,
    /// Nothing to show.
    #[serde(rename = "none")]
    Nothing,
}

impl Preview {
    /// Whether clients render something for it (and hide the trailing URL).
    pub fn is_renderable(&self) -> bool {
        matches!(self, Preview::Card { .. } | Preview::Youtube { .. } | Preview::NearFm { .. })
    }
}

/// YouTube links are embedded straight from the URL.
pub fn youtube(kind: &LinkKind) -> Option<Preview> {
    match kind {
        LinkKind::Youtube { id, start, shorts } => Some(Preview::Youtube {
            video_id: id.clone(),
            start: *start,
            shorts: *shorts,
        }),
        _ => None,
    }
}

pub const TTL_CARD: Duration = Duration::from_secs(6 * 3600);
pub const TTL_NEAR_FM: Duration = Duration::from_secs(3600);
pub const TTL_NOTHING: Duration = Duration::from_secs(3600);
pub const TTL_TRANSIENT: Duration = Duration::from_secs(600);

/// A fetch result and how long to cache it.
pub struct Outcome {
    pub preview: Preview,
    pub ttl: Duration,
}

impl Outcome {
    /// Nothing to show (e.g. not HTML, no title, 4xx).
    pub fn nothing() -> Self {
        Self { preview: Preview::Nothing, ttl: TTL_NOTHING }
    }

    /// Nothing for now (timeouts, 5xx, network errors): retried sooner.
    pub fn transient() -> Self {
        Self { preview: Preview::Nothing, ttl: TTL_TRANSIENT }
    }
}

/// Collapses whitespace, drops control characters and cuts to `max` characters.
pub(crate) fn clean_text(s: &str, max: usize) -> Option<String> {
    let spaced: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let text = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }
    Some(match text.char_indices().nth(max) {
        Some((cut, _)) => format!("{}…", text[..cut].trim_end()),
        None => text,
    })
}

const CACHE_MAX: usize = 20_000;
const MAX_URL_LEN: usize = 2048;
const CONCURRENCY: usize = 8;

type Pending = Shared<BoxFuture<'static, Arc<Preview>>>;

pub struct Unfurler {
    config: Arc<Config>,
    client: SafeClient,
    /// URL (without fragment) → (expiry, preview).
    cache: Mutex<HashMap<String, (Instant, Arc<Preview>)>>,
    /// In-flight fetches, so concurrent requests for one URL share a single fetch.
    pending: Mutex<HashMap<String, Pending>>,
    permits: Semaphore,
}

impl Unfurler {
    pub fn new(config: Arc<Config>) -> anyhow::Result<Arc<Self>> {
        let client = SafeClient::new(&config.unfurl_user_agent, 5, Duration::from_secs(10), true)?;
        Ok(Arc::new(Self {
            config,
            client,
            cache: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
            permits: Semaphore::new(CONCURRENCY),
        }))
    }

    fn key(url: &str) -> Option<String> {
        if url.len() > MAX_URL_LEN {
            return None;
        }
        let mut parsed = url::Url::parse(url).ok()?;
        parsed.set_fragment(None);
        Some(parsed.into())
    }

    /// A cached preview (no I/O).
    pub fn cached(&self, url: &str) -> Option<Arc<Preview>> {
        let key = Self::key(url)?;
        let cache = self.cache.lock();
        cache
            .get(&key)
            .filter(|(expires, _)| *expires > Instant::now())
            .map(|(_, preview)| preview.clone())
    }

    /// The preview for `url`, fetched at most once at a time however many callers ask.
    pub async fn preview(self: &Arc<Self>, url: &str) -> Arc<Preview> {
        if !self.config.unfurl_enabled {
            return Arc::new(Preview::Nothing);
        }
        let Some(key) = Self::key(url) else {
            return Arc::new(Preview::Nothing);
        };
        if let Some(preview) = self.cached(&key) {
            return preview;
        }
        let pending = self
            .pending
            .lock()
            .entry(key.clone())
            .or_insert_with(|| {
                let this = self.clone();
                // Spawned, so the result is cached even if every requester goes away.
                let task = tokio::spawn(async move {
                    let outcome = match this.permits.acquire().await {
                        Ok(_permit) => this.fetch(&key).await,
                        Err(_) => Outcome::transient(),
                    };
                    let preview = Arc::new(outcome.preview);
                    this.store(&key, preview.clone(), outcome.ttl);
                    this.pending.lock().remove(&key);
                    preview
                });
                async move { task.await.unwrap_or_else(|_| Arc::new(Preview::Nothing)) }
                    .boxed()
                    .shared()
            })
            .clone();
        pending.await
    }

    fn store(&self, key: &str, preview: Arc<Preview>, ttl: Duration) {
        let mut cache = self.cache.lock();
        if cache.len() >= CACHE_MAX {
            let now = Instant::now();
            cache.retain(|_, (expires, _)| *expires > now);
            if cache.len() >= CACHE_MAX {
                cache.clear();
            }
        }
        cache.insert(key.to_string(), (Instant::now() + ttl, preview));
    }

    async fn fetch(&self, key: &str) -> Outcome {
        let Ok(url) = url::Url::parse(key) else {
            return Outcome::nothing();
        };
        match classify(key, &self.config.site_hosts) {
            Some(LinkKind::NearFm { uuid }) => {
                near_fm::fetch(&self.client, &self.config.near_fm_api_url, &self.config.fastfs_gateway, &uuid).await
            }
            Some(kind @ LinkKind::Youtube { .. }) => Outcome {
                preview: youtube(&kind).unwrap_or(Preview::Nothing),
                ttl: TTL_CARD,
            },
            Some(LinkKind::Web) => html::fetch(&self.client, &url).await,
            _ => Outcome::nothing(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_text() {
        assert_eq!(clean_text("  Hello \n\t world \u{7}", 100).as_deref(), Some("Hello world"));
        assert_eq!(clean_text("   ", 10), None);
        assert_eq!(clean_text("abcdef", 3).as_deref(), Some("abc…"));
        assert_eq!(clean_text("привет мир", 6).as_deref(), Some("привет…"));
    }

    #[test]
    fn cache_key_drops_fragments() {
        assert_eq!(Unfurler::key("https://a.io/x?y=1#frag").as_deref(), Some("https://a.io/x?y=1"));
        assert_eq!(Unfurler::key(&format!("https://a.io/{}", "x".repeat(3000))), None);
    }

    /// `cargo test -p near-social-server unfurl_live -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "fetches real web pages"]
    async fn unfurl_live() {
        let unfurler = Unfurler::new(Arc::new(Config::from_env().unwrap())).unwrap();
        for url in [
            "https://github.com/near/nearcore",
            "https://www.bbc.com/news",
            "https://near.org",
            "https://near.fm/song/790555c9-f807-4d8d-a81d-a644a7b24f40",
            "https://near.fm/song/00000000-0000-4000-8000-000000000000",
            "https://main.fastfs.io/mob.near/fastfs.near/fastnear.png",
            "https://github.com/this-page-does-not-exist-xyz-123/nope",
            "https://x.com/NEARProtocol",
            "http://169.254.169.254/latest/meta-data",
        ] {
            let started = Instant::now();
            let preview = unfurler.preview(url).await;
            println!("{url} ({:?})\n  {}", started.elapsed(), serde_json::to_string(&*preview).unwrap());
        }
    }

    #[test]
    fn serializes_with_kind_tags() {
        let json = |p: &Preview| serde_json::to_value(p).unwrap();
        assert_eq!(json(&Preview::Nothing), serde_json::json!({"kind": "none"}));
        assert_eq!(json(&Preview::Unavailable), serde_json::json!({"kind": "unavailable"}));
        assert_eq!(
            json(&Preview::Youtube { video_id: "x".into(), start: None, shorts: false }),
            serde_json::json!({"kind": "youtube", "video_id": "x", "start": null, "shorts": false})
        );
    }
}
