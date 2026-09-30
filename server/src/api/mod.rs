//! The `/v1` read API (docs/API.md).

pub mod dto;

use crate::config::Config;
use crate::ingest::tailer::Progress;
use crate::legacy::LegacyClient;
use crate::model::account_id::is_valid_account_id;
use crate::model::keys::parse_post_id;
use crate::state::query::{ForYouCursor, ProfileTab, FOR_YOU_WINDOW_MS};
use crate::state::{Aid, Seq, State};
use actix_web::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use actix_web::http::StatusCode;
use actix_web::{web, HttpResponse};
use dto::{Ctx, Page};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

const DEFAULT_LIMIT: usize = 20;
const MAX_LIMIT: usize = 100;
const MAX_BATCH: usize = 100;
const CACHED_LIST_TTL: Duration = Duration::from_secs(60);
const TRENDING_WINDOW_MS: u64 = 24 * 3600 * 1000;

pub struct Docs {
    pub skill: String,
    pub standard: String,
    pub api: String,
}

type Cached<T> = Mutex<Option<(Instant, Arc<T>)>>;

#[derive(Default)]
pub struct Caches {
    trending: Cached<Vec<(String, u32)>>,
    top_accounts: Cached<Vec<Aid>>,
    trending_posts: Cached<Vec<crate::state::Pid>>,
}

const TRENDING_POOL_SIZE: usize = 300;

impl AppState {
    /// The For You trending pool, recomputed at most once a minute. Takes (and releases) the
    /// state read lock itself, so call it before locking the state.
    fn trending_pool(&self) -> Arc<Vec<crate::state::Pid>> {
        let cached = self.caches.trending_posts.lock().clone();
        match cached {
            Some((at, pool)) if at.elapsed() < CACHED_LIST_TTL => pool,
            _ => {
                let pool = {
                    let state = self.state.read();
                    // Anchored to chain time, so replays and quiet periods still have a pool.
                    Arc::new(state.ranked_posts(state.last_block_ms, FOR_YOU_WINDOW_MS, TRENDING_POOL_SIZE))
                };
                *self.caches.trending_posts.lock() = Some((Instant::now(), pool.clone()));
                pool
            }
        }
    }
}

pub struct AppState {
    pub state: Arc<RwLock<State>>,
    pub config: Arc<Config>,
    pub progress: Arc<Progress>,
    pub events: broadcast::Sender<Arc<str>>,
    pub legacy: Arc<LegacyClient>,
    pub docs: Docs,
    pub caches: Caches,
}

type App = web::Data<AppState>;

// ---- helpers ----

struct ApiError(StatusCode, &'static str, String);

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, "bad_request", message.into())
    }
    fn not_found(message: impl Into<String>) -> Self {
        Self(StatusCode::NOT_FOUND, "not_found", message.into())
    }
}

impl From<ApiError> for HttpResponse {
    fn from(ApiError(status, error, message): ApiError) -> Self {
        HttpResponse::build(status)
            .insert_header((CACHE_CONTROL, "no-store"))
            .json(json!({ "error": error, "message": message }))
    }
}

type ApiResult = Result<HttpResponse, ApiError>;

fn respond(result: ApiResult) -> HttpResponse {
    result.unwrap_or_else(Into::into)
}

fn json_bytes(body: Vec<u8>, private: bool) -> HttpResponse {
    HttpResponse::Ok()
        .insert_header((
            CACHE_CONTROL,
            if private {
                "private, no-cache"
            } else {
                "public, max-age=2, stale-while-revalidate=30"
            },
        ))
        .insert_header((CONTENT_TYPE, "application/json"))
        .body(body)
}

fn to_json<T: Serialize>(value: &T) -> Vec<u8> {
    serde_json::to_vec(value).expect("serializing a response")
}

fn account_param(account_id: &str) -> Result<&str, ApiError> {
    if is_valid_account_id(account_id) {
        Ok(account_id)
    } else {
        Err(ApiError(
            StatusCode::BAD_REQUEST,
            "invalid_account_id",
            format!("invalid account id: {account_id}"),
        ))
    }
}

#[derive(Deserialize)]
pub struct ListQuery {
    viewer: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
    q: Option<String>,
    since: Option<u64>,
}

impl ListQuery {
    fn limit(&self) -> usize {
        self.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
    }

    fn cursor(&self) -> Result<Option<Seq>, ApiError> {
        self.cursor
            .as_deref()
            .filter(|c| !c.is_empty())
            .map(|c| c.parse::<Seq>().map_err(|_| ApiError::bad_request("invalid cursor")))
            .transpose()
    }

    fn viewer_name(&self) -> Result<Option<&str>, ApiError> {
        self.viewer
            .as_deref()
            .filter(|v| !v.is_empty())
            .map(account_param)
            .transpose()
    }
}

/// Resolves the viewer under the lock: `(is_private, viewer aid)`.
fn viewer(state: &State, q: &ListQuery) -> Result<(bool, Option<Aid>), ApiError> {
    let name = q.viewer_name()?;
    Ok((name.is_some(), name.and_then(|n| state.aid(n))))
}

fn ctx<'a>(app: &'a AppState, state: &'a State, viewer: Option<Aid>) -> Ctx<'a> {
    Ctx {
        state,
        viewer,
        gateway: &app.config.fastfs_gateway,
    }
}

fn feed_page(app: &AppState, state: &State, q: &ListQuery, entries: Vec<crate::state::query::FeedEntry>) -> Result<HttpResponse, ApiError> {
    let (private, viewer) = viewer(state, q)?;
    let limit = q.limit();
    let next_cursor = (entries.len() >= limit).then(|| entries.last().map(|e| e.seq().to_string())).flatten();
    let page = Page {
        items: ctx(app, state, viewer).feed(&entries),
        next_cursor,
    };
    Ok(json_bytes(to_json(&page), private))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

// ---- handlers ----

pub async fn status(app: App) -> HttpResponse {
    let height = app.progress.last_block_height.load(Ordering::Relaxed);
    let ms = app.progress.last_block_ms.load(Ordering::Relaxed);
    let counts = app.state.read().counts;
    HttpResponse::Ok().insert_header((CACHE_CONTROL, "no-store")).json(json!({
        "standard": "social-kv/1",
        "chain_id": app.config.chain_id.to_string(),
        "social_account_id": app.config.social_account_id,
        "last_block_height": height,
        "last_block_ts": ms,
        "lag_ms": if ms > 0 { now_ms().saturating_sub(ms) } else { 0 },
        "counts": counts,
    }))
}

pub async fn feed_global(app: App, q: web::Query<ListQuery>) -> HttpResponse {
    respond((|| {
        let state = app.state.read();
        let entries = state.feed_global(q.cursor()?, q.limit());
        feed_page(&app, &state, &q, entries)
    })())
}

pub async fn feed_for_you(app: App, q: web::Query<ListQuery>) -> HttpResponse {
    respond((|| {
        let cursor = match q.cursor.as_deref().filter(|c| !c.is_empty()) {
            Some(c) => ForYouCursor::decode(c).ok_or_else(|| ApiError::bad_request("invalid cursor"))?,
            None => ForYouCursor::default(),
        };
        let pool = app.trending_pool();
        let state = app.state.read();
        let (private, viewer) = viewer(&state, &q)?;
        let (entries, next) = state.feed_for_you(viewer, cursor, q.limit(), &pool);
        let c = ctx(&app, &state, viewer);
        let items: Vec<_> = entries
            .iter()
            .filter_map(|(entry, reason)| {
                let mut item = c.feed_item(entry)?;
                item.reason = Some(reason.as_str());
                Some(item)
            })
            .collect();
        let page = Page {
            items,
            next_cursor: next.map(|n| n.encode()),
        };
        Ok(json_bytes(to_json(&page), private))
    })())
}

pub async fn feed_following(app: App, path: web::Path<String>, q: web::Query<ListQuery>) -> HttpResponse {
    respond((|| {
        let account = account_param(&path)?;
        let state = app.state.read();
        let entries = match state.aid(account) {
            Some(aid) => state.feed_following(aid, q.cursor()?, q.limit()),
            None => vec![],
        };
        feed_page(&app, &state, &q, entries)
    })())
}

pub async fn account(app: App, path: web::Path<String>, q: web::Query<ListQuery>) -> HttpResponse {
    respond((|| {
        let account = account_param(&path)?;
        let state = app.state.read();
        let (private, viewer) = viewer(&state, &q)?;
        let profile = ctx(&app, &state, viewer).profile(account, state.aid(account));
        Ok(json_bytes(to_json(&profile), private))
    })())
}

pub async fn account_list(app: App, path: web::Path<(String, String)>, q: web::Query<ListQuery>) -> HttpResponse {
    respond((|| {
        let (account, tab) = path.into_inner();
        let account = account_param(&account)?;
        let state = app.state.read();
        let (cursor, limit) = (q.cursor()?, q.limit());
        let aid = state.aid(account);
        let feed_tab = match tab.as_str() {
            "posts" => Some(ProfileTab::Posts),
            "replies" => Some(ProfileTab::Replies),
            "media" => Some(ProfileTab::Media),
            _ => None,
        };
        if let Some(tab) = feed_tab {
            let entries = aid.map_or(vec![], |a| state.account_feed(a, tab, cursor, limit));
            return feed_page(&app, &state, &q, entries);
        }
        if tab == "likes" {
            let entries = aid.map_or(vec![], |a| state.account_likes(a, cursor, limit));
            return feed_page(&app, &state, &q, entries);
        }
        let list = match (tab.as_str(), aid) {
            ("followers", Some(a)) => state.followers(a, cursor, limit),
            ("following", Some(a)) => state.following(a, cursor, limit),
            ("followers" | "following", None) => vec![],
            _ => return Err(ApiError::not_found(format!("unknown list {tab}"))),
        };
        let (private, viewer) = viewer(&state, &q)?;
        let page = Page::from_items(ctx(&app, &state, viewer).cards(&list), limit, |c| c.cursor.clone());
        Ok(json_bytes(to_json(&page), private))
    })())
}

fn post_pid(state: &State, account: &str, id: &str) -> Result<crate::state::Pid, ApiError> {
    let account = account_param(account)?;
    let id = parse_post_id(id).ok_or_else(|| ApiError::bad_request("invalid post id"))?;
    state
        .pid(account, id)
        .filter(|&pid| state.is_visible(pid))
        .ok_or_else(|| ApiError::not_found("post not found"))
}

pub async fn post(app: App, path: web::Path<(String, String)>, q: web::Query<ListQuery>) -> HttpResponse {
    respond((|| {
        let (account, id) = path.into_inner();
        let state = app.state.read();
        let pid = post_pid(&state, &account, &id)?;
        let (private, viewer) = viewer(&state, &q)?;
        let c = ctx(&app, &state, viewer);
        let (ancestors, parent_missing) = state.thread_ancestors(pid);
        let body = json!({
            "post": c.post(pid, true),
            "ancestors": ancestors.iter().filter_map(|&p| c.post(p, true)).collect::<Vec<_>>(),
            "parent_missing": parent_missing,
        });
        Ok(json_bytes(to_json(&body), private))
    })())
}

pub async fn post_list(app: App, path: web::Path<(String, String, String)>, q: web::Query<ListQuery>) -> HttpResponse {
    respond((|| {
        let (account, id, list) = path.into_inner();
        let state = app.state.read();
        let pid = post_pid(&state, &account, &id)?;
        let limit = q.limit();
        match list.as_str() {
            "replies" => {
                // Offset-based cursor: replies are ordered author-first, then by time.
                let offset = q.cursor()?.unwrap_or(0) as usize;
                let (entries, more) = state.post_replies(pid, offset, limit);
                let (private, viewer) = viewer(&state, &q)?;
                let items = ctx(&app, &state, viewer).feed(&entries);
                let page = Page {
                    items,
                    next_cursor: more.then(|| (offset + limit).to_string()),
                };
                Ok(json_bytes(to_json(&page), private))
            }
            "quotes" => {
                let entries = state.post_quotes(pid, q.cursor()?, limit);
                feed_page(&app, &state, &q, entries)
            }
            "likes" | "reposts" => {
                let list = if list == "likes" {
                    state.post_likers(pid, q.cursor()?, limit)
                } else {
                    state.post_reposters(pid, q.cursor()?, limit)
                };
                let (private, viewer) = viewer(&state, &q)?;
                let page = Page::from_items(ctx(&app, &state, viewer).cards(&list), limit, |c| c.cursor.clone());
                Ok(json_bytes(to_json(&page), private))
            }
            _ => Err(ApiError::not_found(format!("unknown list {list}"))),
        }
    })())
}

#[derive(Deserialize)]
pub struct BatchRequest {
    keys: Vec<String>,
    viewer: Option<String>,
}

pub async fn posts_batch(app: App, body: web::Json<BatchRequest>) -> HttpResponse {
    respond((|| {
        if body.keys.len() > MAX_BATCH {
            return Err(ApiError::bad_request(format!("at most {MAX_BATCH} keys")));
        }
        let q = ListQuery {
            viewer: body.viewer.clone(),
            cursor: None,
            limit: None,
            q: None,
            since: None,
        };
        let state = app.state.read();
        let (private, viewer) = viewer(&state, &q)?;
        let c = ctx(&app, &state, viewer);
        let items: Vec<_> = body
            .keys
            .iter()
            .map(|k| {
                crate::model::keys::parse_post_ref(k)
                    .and_then(|(a, id)| state.pid(a, id))
                    .and_then(|pid| c.post(pid, true))
            })
            .collect();
        Ok(json_bytes(to_json(&json!({ "items": items })), private))
    })())
}

pub async fn hashtag(app: App, path: web::Path<String>, q: web::Query<ListQuery>) -> HttpResponse {
    respond((|| {
        let tag = path.trim_start_matches('#').to_lowercase();
        let state = app.state.read();
        let entries = state.hashtag_feed(&tag, q.cursor()?, q.limit());
        feed_page(&app, &state, &q, entries)
    })())
}

pub async fn trending(app: App) -> HttpResponse {
    let cached = app.caches.trending.lock().clone();
    let top = match cached {
        Some((at, top)) if at.elapsed() < CACHED_LIST_TTL => top,
        _ => {
            let top = Arc::new(app.state.read().trending(now_ms(), TRENDING_WINDOW_MS, 10));
            *app.caches.trending.lock() = Some((Instant::now(), top.clone()));
            top
        }
    };
    let items: Vec<_> = top.iter().map(|(tag, count)| json!({ "tag": tag, "count": count })).collect();
    json_bytes(to_json(&json!({ "items": items })), false)
}

pub async fn notifications(app: App, path: web::Path<String>, q: web::Query<ListQuery>) -> HttpResponse {
    respond((|| {
        let account = account_param(&path)?;
        let state = app.state.read();
        let limit = q.limit();
        let groups = match state.aid(account) {
            Some(aid) => state.notifications(aid, q.cursor()?, limit),
            None => vec![],
        };
        let next_cursor = (groups.len() >= limit).then(|| groups.last().map(|g| g.cursor.to_string())).flatten();
        let (_, viewer) = viewer(&state, &q)?;
        let viewer = viewer.or_else(|| state.aid(account));
        let page = Page {
            items: ctx(&app, &state, viewer).notifications(&groups),
            next_cursor,
        };
        Ok(json_bytes(to_json(&page), true))
    })())
}

pub async fn notification_count(app: App, path: web::Path<String>, q: web::Query<ListQuery>) -> HttpResponse {
    respond((|| {
        let account = account_param(&path)?;
        let state = app.state.read();
        let count = state
            .aid(account)
            .map_or(0, |aid| state.notification_count(aid, q.since.unwrap_or(0)));
        Ok(json_bytes(to_json(&json!({ "count": count })), true))
    })())
}

pub async fn search_accounts(app: App, q: web::Query<ListQuery>) -> HttpResponse {
    respond((|| {
        let query = q.q.as_deref().unwrap_or("").trim().to_lowercase();
        let state = app.state.read();
        let (private, viewer) = viewer(&state, &q)?;
        let found: Vec<(Seq, Aid)> = state
            .search_accounts(&query, q.limit())
            .into_iter()
            .enumerate()
            .map(|(i, aid)| (i as Seq, aid))
            .collect();
        let page = Page {
            items: ctx(&app, &state, viewer).cards(&found),
            next_cursor: None,
        };
        Ok(json_bytes(to_json(&page), private))
    })())
}

pub async fn search_posts(app: App, q: web::Query<ListQuery>) -> HttpResponse {
    respond((|| {
        let query = q.q.as_deref().unwrap_or("").trim().to_lowercase();
        let state = app.state.read();
        let entries = if query.is_empty() {
            vec![]
        } else {
            state.search_posts(&query, q.cursor()?, q.limit())
        };
        feed_page(&app, &state, &q, entries)
    })())
}

pub async fn suggestions(app: App, q: web::Query<ListQuery>) -> HttpResponse {
    respond((|| {
        let cached = app.caches.top_accounts.lock().clone();
        let top = match cached {
            Some((at, top)) if at.elapsed() < CACHED_LIST_TTL => top,
            _ => {
                let top = Arc::new(app.state.read().top_accounts(500));
                *app.caches.top_accounts.lock() = Some((Instant::now(), top.clone()));
                top
            }
        };
        let state = app.state.read();
        let (private, viewer) = viewer(&state, &q)?;
        let picked: Vec<(Seq, Aid)> = top
            .iter()
            .copied()
            .filter(|&aid| {
                viewer.is_none_or(|v| v != aid && !state.account(v).following.contains_key(&aid))
                    && !state.is_hidden(aid)
            })
            .take(q.limit())
            .enumerate()
            .map(|(i, aid)| (i as Seq, aid))
            .collect();
        let page = Page {
            items: ctx(&app, &state, viewer).cards(&picked),
            next_cursor: None,
        };
        Ok(json_bytes(to_json(&page), private))
    })())
}

pub async fn tx(app: App, path: web::Path<String>) -> HttpResponse {
    let hash = path.into_inner();
    let state = app.state.read();
    let body = match state.txs.get(hash.as_str()) {
        Some(report) => json!({
            "tx_hash": hash,
            "indexed": true,
            "block_height": report.block_height,
            "block_ts": report.block_ms,
            "predecessor_id": &*report.predecessor,
            "actions": report.actions,
        }),
        None => json!({ "tx_hash": hash, "indexed": false }),
    };
    HttpResponse::Ok().insert_header((CACHE_CONTROL, "no-store")).json(body)
}

pub async fn stream(app: App) -> HttpResponse {
    let receiver = app.events.subscribe();
    let mut ping = tokio::time::interval(Duration::from_secs(15));
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let events = futures::stream::unfold((receiver, ping), |(mut receiver, mut ping)| async move {
        let chunk = tokio::select! {
            message = receiver.recv() => match message {
                Ok(data) => format!("event: block\ndata: {data}\n\n"),
                Err(broadcast::error::RecvError::Lagged(n)) => format!(": lagged {n}\n\n"),
                Err(broadcast::error::RecvError::Closed) => return None,
            },
            _ = ping.tick() => ": ping\n\n".to_string(),
        };
        Some((Ok::<_, actix_web::Error>(bytes::Bytes::from(chunk)), (receiver, ping)))
    });
    HttpResponse::Ok()
        .insert_header((CONTENT_TYPE, "text/event-stream"))
        // Compression buffers small events (here and at Cloudflare); `no-transform` keeps proxies
        // from compressing it, `X-Accel-Buffering` keeps nginx from buffering it.
        .insert_header(actix_web::http::header::ContentEncoding::Identity)
        .insert_header((CACHE_CONTROL, "no-cache, no-transform"))
        .insert_header(("X-Accel-Buffering", "no"))
        .streaming(events)
}

pub async fn legacy(app: App, path: web::Path<String>) -> HttpResponse {
    let account = match account_param(&path) {
        Ok(a) => a.to_string(),
        Err(e) => return e.into(),
    };
    let data = match app.legacy.get(&account).await {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!(target: "legacy", "legacy lookup for {account} failed: {e:#}");
            return HttpResponse::BadGateway().json(json!({ "error": "legacy_unavailable", "message": e.to_string() }));
        }
    };
    let (on_network, already_following) = {
        let state = app.state.read();
        let me = state.aid(&account);
        let mut on_network = 0;
        let mut already = 0;
        for f in &data.follows {
            if let Some(aid) = state.aid(f) {
                if state.account(aid).joined_ms.is_some() {
                    on_network += 1;
                }
                if me.is_some_and(|m| state.account(m).following.contains_key(&aid)) {
                    already += 1;
                }
            }
        }
        (on_network, already)
    };
    let image = |source: Option<&crate::legacy::ImageSource>, kind: &str| {
        source.map(|s| {
            let mut v = serde_json::to_value(s).unwrap();
            v["proxy_url"] = json!(format!("/v1/legacy/{account}/image/{kind}"));
            v
        })
    };
    HttpResponse::Ok().insert_header((CACHE_CONTROL, "private, max-age=60")).json(json!({
        "account_id": account,
        "exists": data.exists,
        "profile": data.profile,
        "avatar": image(data.avatar.first(), "avatar"),
        "banner": image(data.banner.first(), "banner"),
        "follows": data.follows,
        "follows_on_network": on_network,
        "already_following": already_following,
    }))
}

pub async fn legacy_image(app: App, path: web::Path<(String, String)>) -> HttpResponse {
    let (account, kind) = path.into_inner();
    if let Err(e) = account_param(&account) {
        return e.into();
    }
    let banner = match kind.as_str() {
        "avatar" => false,
        "banner" => true,
        _ => return ApiError::not_found("unknown image").into(),
    };
    match app.legacy.image(&account, banner).await {
        Ok(Some(image)) => HttpResponse::Ok()
            .insert_header((CONTENT_TYPE, image.content_type))
            .insert_header((CACHE_CONTROL, "public, max-age=3600"))
            .insert_header(("X-Content-Type-Options", "nosniff"))
            .insert_header(("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox"))
            .body(image.bytes),
        Ok(None) => ApiError::not_found("no legacy image").into(),
        Err(e) => {
            tracing::warn!(target: "legacy", "legacy image for {account} failed: {e:#}");
            HttpResponse::BadGateway().json(json!({ "error": "image_unavailable", "message": e.to_string() }))
        }
    }
}

fn markdown(body: &str) -> HttpResponse {
    HttpResponse::Ok()
        .insert_header((CONTENT_TYPE, "text/markdown; charset=utf-8"))
        .insert_header((CACHE_CONTROL, "public, max-age=300"))
        .body(body.to_string())
}

pub async fn skill_md(app: App) -> HttpResponse {
    markdown(&app.docs.skill)
}

pub async fn standard_md(app: App) -> HttpResponse {
    markdown(&app.docs.standard)
}

pub async fn api_md(app: App) -> HttpResponse {
    markdown(&app.docs.api)
}

pub async fn index(app: App) -> HttpResponse {
    let base = &app.config.public_url;
    HttpResponse::Ok().insert_header((CONTENT_TYPE, "text/plain; charset=utf-8")).body(format!(
        "near.social API (social-kv/1)\n\nAgent guide: {base}/skill.md\nStandard:    {base}/standard.md\nAPI:         {base}/api.md\nStatus:      {base}/v1/status\n"
    ))
}

pub fn routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/", web::get().to(index))
        .route("/skill.md", web::get().to(skill_md))
        .route("/SKILL.md", web::get().to(skill_md))
        .route("/standard.md", web::get().to(standard_md))
        .route("/api.md", web::get().to(api_md))
        .route("/v1/status", web::get().to(status))
        .route("/v1/feed/global", web::get().to(feed_global))
        .route("/v1/feed/following/{account}", web::get().to(feed_following))
        .route("/v1/feed/for_you", web::get().to(feed_for_you))
        .route("/v1/accounts/{account}", web::get().to(account))
        .route("/v1/accounts/{account}/{list}", web::get().to(account_list))
        .route("/v1/posts/batch", web::post().to(posts_batch))
        .route("/v1/posts/{account}/{id}", web::get().to(post))
        .route("/v1/posts/{account}/{id}/{list}", web::get().to(post_list))
        .route("/v1/hashtags/trending", web::get().to(trending))
        .route("/v1/hashtags/{tag}", web::get().to(hashtag))
        .route("/v1/notifications/{account}", web::get().to(notifications))
        .route("/v1/notifications/{account}/count", web::get().to(notification_count))
        .route("/v1/search/accounts", web::get().to(search_accounts))
        .route("/v1/search/posts", web::get().to(search_posts))
        .route("/v1/suggestions", web::get().to(suggestions))
        .route("/v1/tx/{hash}", web::get().to(tx))
        .route("/v1/stream", web::get().to(stream))
        .route("/v1/legacy/{account}", web::get().to(legacy))
        .route("/v1/legacy/{account}/image/{kind}", web::get().to(legacy_image));
}
