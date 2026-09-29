//! Reads an account's legacy near.social data (SocialDB on `social.near`) for migration, and
//! fetches legacy profile images (IPFS / URL / NFT) with SSRF protection.

use crate::config::Config;
use crate::model::account_id::is_valid_account_id;
use crate::model::values::{MAX_ABOUT, MAX_LINK, MAX_LOCATION, MAX_NAME};
use anyhow::{anyhow, bail, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use bytes::{Bytes, BytesMut};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

const CACHE_TTL: Duration = Duration::from_secs(600);
const CACHE_MAX: usize = 10_000;
const MAX_FOLLOWS: usize = 10_000;
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;
const MAX_REFERENCE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ImageSource {
    Ipfs { cid: String },
    Url { url: String },
    Nft { contract_id: String, token_id: String },
    Data { uri: String },
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct LegacyProfile {
    pub name: Option<String>,
    pub about: Option<String>,
    pub location: Option<String>,
    pub links: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default)]
pub struct LegacyData {
    pub exists: bool,
    pub profile: LegacyProfile,
    /// Image sources in near.social's precedence (NFT, then IPFS CID, then URL).
    pub avatar: Vec<ImageSource>,
    pub banner: Vec<ImageSource>,
    pub follows: Vec<String>,
}

fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn non_empty_str(v: &Value) -> Option<&str> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty())
}

/// Strips URL and `@` prefixes from social handles: "https://twitter.com/foo" → "foo".
fn normalize_handle(value: &str) -> String {
    let v = value.trim().trim_end_matches('/');
    let v = v
        .rsplit_once('/')
        .filter(|_| v.contains("://") || v.contains(".com/") || v.contains(".me/") || v.contains(".org/"))
        .map_or(v, |(_, h)| h);
    v.trim_start_matches('@').to_string()
}

/// Every source in a SocialDB image object, in near.social's precedence: the Image widget
/// renders the NFT when one is set, otherwise the IPFS CID, otherwise the URL.
fn image_sources(v: &Value) -> Vec<ImageSource> {
    let mut sources = vec![];
    let nft = &v["nft"];
    if let (Some(contract_id), Some(token_id)) = (non_empty_str(&nft["contractId"]), non_empty_str(&nft["tokenId"])) {
        if is_valid_account_id(contract_id) {
            sources.push(ImageSource::Nft {
                contract_id: contract_id.to_string(),
                token_id: token_id.to_string(),
            });
        }
    }
    if let Some(cid) = non_empty_str(&v["ipfs_cid"]) {
        sources.push(ImageSource::Ipfs { cid: cid.to_string() });
    }
    if let Some(url) = non_empty_str(&v["url"]) {
        sources.push(if url.starts_with("data:") {
            ImageSource::Data { uri: url.to_string() }
        } else {
            ImageSource::Url { url: url.to_string() }
        });
    }
    sources
}

/// Converts SocialDB `{account: {profile, graph}}` into social-kv/1 fields.
pub fn normalize(account_id: &str, root: &Value) -> LegacyData {
    let data = &root[account_id];
    let profile = &data["profile"];
    let mut links = BTreeMap::new();
    if let Some(linktree) = profile["linktree"].as_object() {
        for (service, value) in linktree {
            let Some(value) = non_empty_str(value) else { continue };
            let service = match service.to_lowercase().as_str() {
                "twitter" => "x".to_string(),
                s => s.to_string(),
            };
            if !(1..=32).contains(&service.len())
                || !service.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
            {
                continue;
            }
            let value = if service == "website" {
                value.to_string()
            } else {
                normalize_handle(value)
            };
            if !value.is_empty() && value.chars().count() <= MAX_LINK {
                links.insert(service, value);
            }
        }
    }
    let legacy_profile = LegacyProfile {
        name: non_empty_str(&profile["name"]).map(|s| truncate_chars(s, MAX_NAME)),
        about: non_empty_str(&profile["description"]).map(|s| truncate_chars(s, MAX_ABOUT)),
        location: non_empty_str(&profile["location"]).map(|s| truncate_chars(s, MAX_LOCATION)),
        links,
    };
    let mut follows: Vec<String> = data["graph"]["follow"]
        .as_object()
        .map(|m| {
            m.iter()
                .filter(|(k, v)| !v.is_null() && k.as_str() != account_id && is_valid_account_id(k))
                .map(|(k, _)| k.clone())
                .collect()
        })
        .unwrap_or_default();
    follows.sort();
    follows.truncate(MAX_FOLLOWS);
    let avatar = image_sources(&profile["image"]);
    let banner = image_sources(&profile["backgroundImage"]);
    LegacyData {
        exists: legacy_profile.name.is_some()
            || legacy_profile.about.is_some()
            || !legacy_profile.links.is_empty()
            || !avatar.is_empty()
            || !banner.is_empty()
            || !follows.is_empty(),
        profile: legacy_profile,
        avatar,
        banner,
        follows,
    }
}

// ---- SSRF protection ----

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_unspecified()
                || v4.is_documentation()
                || o[0] == 0
                || (o[0] == 100 && (64..128).contains(&o[1])) // CGNAT
                || (o[0] == 198 && (18..20).contains(&o[1])) // benchmarking
                || o[0] >= 240)
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(v4));
            }
            let s = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00 // unique local
                || (s[0] & 0xffc0) == 0xfe80 // link local
                || (s[0] == 0x2001 && s[1] == 0x0db8)) // documentation
        }
    }
}

/// Resolves hostnames and refuses non-public addresses.
struct PublicResolver;

impl reqwest::dns::Resolve for PublicResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async move {
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((name.as_str(), 0))
                .await?
                .filter(|a| is_public_ip(a.ip()))
                .collect();
            if addrs.is_empty() {
                return Err("host resolves to no public address".into());
            }
            Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

/// A URL is fetchable if it's http(s) and not a literal non-public IP.
fn is_fetchable(url: &url::Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    match url.host() {
        Some(url::Host::Ipv4(ip)) => is_public_ip(IpAddr::V4(ip)),
        Some(url::Host::Ipv6(ip)) => is_public_ip(IpAddr::V6(ip)),
        Some(url::Host::Domain(d)) => !d.eq_ignore_ascii_case("localhost"),
        None => false,
    }
}

fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.len() > 12 && &bytes[4..8] == b"ftyp" && (&bytes[8..12] == b"avif" || &bytes[8..12] == b"avis") {
        Some("image/avif")
    } else {
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_lowercase();
        (head.contains("<svg")).then_some("image/svg+xml")
    }
}

pub struct Image {
    pub bytes: Bytes,
    pub content_type: &'static str,
}

/// near.social's placeholder images (default avatar, "loading" image): never imported.
const PLACEHOLDER_CIDS: &[&str] = &[
    "bafkreibmiy4ozblcgv3fm3gc6q62s55em33vconbavfd2ekkuliznaq3zm",
    "bafkreidoxgv2w7kmzurdnmflegkthgzaclgwpiccgztpkfdkfzb4265zuu",
];

static CID_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    // Same CID shapes as near.social's NftImage widget.
    regex::Regex::new(
        r"^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|b[a-z2-7]{58,}|B[A-Z2-7]{58,}|z[1-9A-HJ-NP-Za-km-z]{48,}|F[0-9A-F]{50,})$",
    )
    .unwrap()
});

fn is_cid(s: &str) -> bool {
    CID_RE.is_match(s)
}

/// Finds an IPFS CID in a URL or reference and returns `{cid}[/path]` (query dropped).
/// Handles `ipfs://{cid}`, bare CIDs, `https://host/ipfs/{cid}/…`, subdomain gateways
/// (`https://{cid}.ipfs.host/…`) and hosts that serve the CID as the first path segment
/// (`https://paras-ipfs.paras.id/{cid}`).
pub fn ipfs_path(s: &str) -> Option<String> {
    let s = s.trim();
    let from_segments = |segments: &[&str]| -> Option<String> {
        let first = *segments.first()?;
        is_cid(first).then(|| segments.join("/"))
    };
    if let Some(rest) = s.strip_prefix("ipfs://") {
        let rest = rest.trim_start_matches("ipfs/");
        let rest = rest.split(['?', '#']).next().unwrap_or("");
        return from_segments(&rest.split('/').filter(|p| !p.is_empty()).collect::<Vec<_>>());
    }
    if !s.contains("://") {
        let rest = s.split(['?', '#']).next().unwrap_or("");
        return from_segments(&rest.split('/').filter(|p| !p.is_empty()).collect::<Vec<_>>());
    }
    let url = url::Url::parse(s).ok()?;
    let host = url.host_str()?;
    let segments: Vec<&str> = url.path().split('/').filter(|p| !p.is_empty()).collect();
    if let Some((label, rest)) = host.split_once('.') {
        if is_cid(label) && rest.starts_with("ipfs.") {
            return Some(std::iter::once(label).chain(segments.iter().copied()).collect::<Vec<_>>().join("/"));
        }
    }
    if let Some(i) = segments.iter().position(|p| *p == "ipfs") {
        return from_segments(&segments[i + 1..]);
    }
    from_segments(&segments)
}

fn is_placeholder(cid_path: &str) -> bool {
    PLACEHOLDER_CIDS.contains(&cid_path.split('/').next().unwrap_or(""))
}

/// Candidate URLs for an IPFS `{cid}[/path]`: original content from our gateways (the
/// near.social mirror first), then the near.social image proxy's copy of the mirror URL.
/// The proxy only keeps resized re-encodes, so it always comes last.
pub fn cid_candidates(cid_path: &str, gateways: &[String], image_proxy: &str) -> Vec<String> {
    if is_placeholder(cid_path) {
        return vec![];
    }
    let mut urls: Vec<String> = gateways.iter().map(|g| format!("{g}/ipfs/{cid_path}")).collect();
    urls.extend(proxy_of_mirror(cid_path, gateways, image_proxy));
    urls
}

fn proxy_of_mirror(cid_path: &str, gateways: &[String], image_proxy: &str) -> Option<String> {
    gateways.first().map(|mirror| format!("{image_proxy}/large/{mirror}/ipfs/{cid_path}"))
}

/// Candidate URLs for a legacy image URL. Original content first: IPFS content via our
/// gateways, canonical arweave.net, the URL itself. Then, as a last resort, the near.social
/// image proxy (`i.near.social`): its cache outlives dead gateways, but it only keeps resized
/// re-encodes, never the original bytes.
pub fn url_candidates(url: &str, gateways: &[String], image_proxy: &str) -> Vec<String> {
    let mut originals = vec![];
    let mut resized = vec![];
    if let Some(cid_path) = ipfs_path(url) {
        if is_placeholder(&cid_path) {
            return vec![];
        }
        originals.extend(gateways.iter().map(|g| format!("{g}/ipfs/{cid_path}")));
        resized.extend(proxy_of_mirror(&cid_path, gateways, image_proxy));
    }
    if url.starts_with("http://") || url.starts_with("https://") {
        if let Ok(parsed) = url::Url::parse(url) {
            // `{sandbox}.arweave.net/{txid}/…` → `arweave.net/{txid}/…`
            if parsed.host_str().is_some_and(|h| h.ends_with(".arweave.net")) && parsed.path().len() > 1 {
                originals.push(format!("https://arweave.net{}", parsed.path()));
            }
        }
        originals.push(url.to_string());
        resized.push(format!("{image_proxy}/large/{url}"));
    }
    let mut seen = std::collections::HashSet::new();
    originals
        .into_iter()
        .chain(resized)
        .filter(|u| seen.insert(u.clone()))
        .collect()
}

/// Per-request timeout: our IPFS mirror may need a while to pull unpinned content from the
/// network, so it gets longer than third-party hosts.
pub fn timeout_for(url: &url::Url, mirror_host: Option<&str>, mirror: Duration, default: Duration) -> Duration {
    match (url.host_str(), mirror_host) {
        (Some(host), Some(m)) if host.eq_ignore_ascii_case(m) => mirror,
        _ => default,
    }
}

fn is_absolute_media(s: &str) -> bool {
    s.starts_with("https://") || s.starts_with("http://") || s.starts_with("data:") || s.starts_with("ipfs://")
}

fn join_uri(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path.trim_start_matches('/'))
}

pub struct LegacyClient {
    config: Arc<Config>,
    mirror_host: Option<String>,
    api: reqwest::Client,
    fetcher: reqwest::Client,
    cache: Mutex<HashMap<String, (Instant, Arc<LegacyData>)>>,
}

impl LegacyClient {
    pub fn new(config: Arc<Config>) -> Result<Self> {
        let api = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("near-social-server")
            .build()?;
        let fetcher = reqwest::Client::builder()
            // Upper bound; each request sets its own (shorter) timeout.
            .timeout(config.legacy_mirror_timeout + Duration::from_secs(5))
            .dns_resolver(Arc::new(PublicResolver))
            // Keep our Referer across redirects instead of replacing it with the previous URL.
            .referer(false)
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= MAX_REDIRECTS {
                    attempt.error("too many redirects")
                } else if !is_fetchable(attempt.url()) {
                    attempt.error("redirect to a non-public URL")
                } else {
                    attempt.follow()
                }
            }))
            .user_agent("near-social-server (legacy image import)")
            .build()?;
        let mirror_host = config
            .ipfs_gateways
            .first()
            .and_then(|g| url::Url::parse(g).ok())
            .and_then(|u| u.host_str().map(String::from));
        Ok(Self {
            config,
            mirror_host,
            api,
            fetcher,
            cache: Mutex::new(HashMap::new()),
        })
    }

    async fn view(&self, contract: &str, method: &str, args: Value) -> Result<Value> {
        let response: Value = self
            .api
            .post(&self.config.rpc_url)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": "near-social",
                "method": "query",
                "params": {
                    "request_type": "call_function",
                    "finality": "final",
                    "account_id": contract,
                    "method_name": method,
                    "args_base64": BASE64.encode(serde_json::to_vec(&args)?),
                }
            }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if let Some(error) = response.get("error").or_else(|| response["result"].get("error")) {
            bail!("RPC error: {error}");
        }
        let bytes: Vec<u8> = serde_json::from_value(response["result"]["result"].clone())
            .context("RPC result is not bytes")?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    async fn fetch_social_db(&self, account_id: &str) -> Result<Value> {
        let keys = json!({ "keys": [format!("{account_id}/profile/**"), format!("{account_id}/graph/follow/*")] });
        let from_api = async {
            let response = self
                .api
                .post(format!("{}/get", self.config.legacy_api_url))
                .json(&keys)
                .send()
                .await?
                .error_for_status()?;
            anyhow::Ok(response.json::<Value>().await?)
        };
        match from_api.await {
            Ok(v) => Ok(v),
            Err(e) => {
                tracing::warn!(target: "legacy", "api.near.social failed ({e}), falling back to RPC");
                self.view(&self.config.legacy_contract, "get", keys).await
            }
        }
    }

    pub async fn get(&self, account_id: &str) -> Result<Arc<LegacyData>> {
        if let Some((at, data)) = self.cache.lock().get(account_id) {
            if at.elapsed() < CACHE_TTL {
                return Ok(data.clone());
            }
        }
        let root = self.fetch_social_db(account_id).await?;
        let data = Arc::new(normalize(account_id, &root));
        let mut cache = self.cache.lock();
        if cache.len() >= CACHE_MAX {
            cache.retain(|_, (at, _)| at.elapsed() < CACHE_TTL);
            if cache.len() >= CACHE_MAX {
                cache.clear();
            }
        }
        cache.insert(account_id.to_string(), (Instant::now(), data.clone()));
        Ok(data)
    }

    fn url_candidates(&self, url: &str) -> Vec<String> {
        url_candidates(url, &self.config.ipfs_gateways, &self.config.legacy_image_proxy)
    }

    /// Fetches a legacy profile image. The sources always come from the account's own legacy
    /// profile, never from the request. Tries every source in near.social's precedence, each
    /// through its candidate URLs, within an overall time budget.
    pub async fn image(&self, account_id: &str, banner: bool) -> Result<Option<Image>> {
        let budget = self.config.legacy_image_budget;
        // The budget covers everything, including NFT RPC lookups and reference fetches.
        tokio::time::timeout(budget, self.find_image(account_id, banner))
            .await
            .unwrap_or_else(|_| Err(anyhow!("gave up after {budget:?}")))
    }

    async fn find_image(&self, account_id: &str, banner: bool) -> Result<Option<Image>> {
        let data = self.get(account_id).await?;
        let sources = if banner { &data.banner } else { &data.avatar };
        if sources.is_empty() {
            return Ok(None);
        }
        let deadline = Instant::now() + self.config.legacy_image_budget;
        let mut tried = std::collections::HashSet::new();
        let mut last_error = anyhow!("no usable image source");
        for source in sources {
            let urls = match source {
                ImageSource::Data { uri } => match decode_data_uri(uri) {
                    Ok(image) => return Ok(Some(image)),
                    Err(e) => {
                        last_error = e;
                        continue;
                    }
                },
                ImageSource::Ipfs { cid } => {
                    cid_candidates(cid, &self.config.ipfs_gateways, &self.config.legacy_image_proxy)
                }
                ImageSource::Url { url } => self.url_candidates(url),
                ImageSource::Nft { contract_id, token_id } => match self.nft_media(contract_id, token_id).await {
                    Ok(media) if media.starts_with("data:") => match decode_data_uri(&media) {
                        Ok(image) => return Ok(Some(image)),
                        Err(e) => {
                            last_error = e;
                            continue;
                        }
                    },
                    Ok(media) => self.url_candidates(&media),
                    Err(e) => {
                        last_error = e;
                        continue;
                    }
                },
            };
            let urls: Vec<String> = urls.into_iter().filter(|u| tried.insert(u.clone())).collect();
            if let Some(image) = self.first_image(&urls, deadline, &mut last_error).await {
                return Ok(Some(image));
            }
        }
        // Last resort for NFT avatars: near.social's own resolver.
        let has_nft = sources.iter().any(|s| matches!(s, ImageSource::Nft { .. }));
        if has_nft && !banner && Instant::now() < deadline {
            if let Some(url) = self.magic_avatar_url(account_id).await {
                let urls: Vec<String> = self.url_candidates(&url).into_iter().filter(|u| tried.insert(u.clone())).collect();
                if let Some(image) = self.first_image(&urls, deadline, &mut last_error).await {
                    return Ok(Some(image));
                }
            }
        }
        Err(last_error)
    }

    async fn first_image(&self, urls: &[String], deadline: Instant, last_error: &mut anyhow::Error) -> Option<Image> {
        for url in urls {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                *last_error = anyhow!("gave up after {:?}", self.config.legacy_image_budget);
                return None;
            }
            match self.fetch_image(url, remaining).await {
                Ok(image) => return Some(image),
                Err(e) => {
                    tracing::debug!(target: "legacy", "image {url} failed: {e}");
                    *last_error = e;
                }
            }
        }
        None
    }

    /// near.social's account-avatar resolver answers with the image URL: 200 for a real image,
    /// 203 with the default avatar otherwise.
    async fn magic_avatar_url(&self, account_id: &str) -> Option<String> {
        let response = self
            .api
            .get(format!("{}/{account_id}", self.config.legacy_magic_url))
            .header(reqwest::header::REFERER, &self.config.legacy_referer)
            .send()
            .await
            .ok()?;
        if response.status() != reqwest::StatusCode::OK {
            return None;
        }
        let url = response.text().await.ok()?.trim().to_string();
        (url.starts_with("https://") || url.starts_with("http://"))
            .then_some(url)
            .filter(|u| !ipfs_path(u).is_some_and(|p| is_placeholder(&p)))
    }

    /// Resolves an NFT's image the way near.social's NftImage widget does: token media (absolute,
    /// relative to the contract's `base_uri`, or a bare CID), else the `media` field of the
    /// token's `reference` JSON.
    async fn nft_media(&self, contract_id: &str, token_id: &str) -> Result<String> {
        let token = self.view(contract_id, "nft_token", json!({ "token_id": token_id })).await?;
        let metadata = &token["metadata"];
        let mut base_uri: Option<Option<String>> = None;
        macro_rules! base_uri {
            () => {{
                if base_uri.is_none() {
                    let m = self.view(contract_id, "nft_metadata", json!({})).await.ok();
                    base_uri = Some(
                        m.as_ref()
                            .and_then(|m| m["base_uri"].as_str())
                            .filter(|b| !b.is_empty())
                            .map(String::from),
                    );
                }
                base_uri.clone().flatten()
            }};
        }
        if let Some(media) = metadata["media"].as_str().map(str::trim).filter(|m| !m.is_empty()) {
            if is_absolute_media(media) {
                return Ok(media.to_string());
            }
            return Ok(match base_uri!() {
                Some(base) => join_uri(&base, media),
                None => media.to_string(), // a bare CID, handled by url_candidates
            });
        }
        let reference = metadata["reference"]
            .as_str()
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .ok_or_else(|| anyhow!("NFT has no media"))?;
        let reference_urls = if reference.starts_with("https://") || reference.starts_with("http://") {
            self.url_candidates(reference)
        } else if let Some(id) = reference.strip_prefix("ar://") {
            vec![format!("https://arweave.net/{id}")]
        } else if let Some(base) = base_uri!() {
            self.url_candidates(&join_uri(&base, reference))
        } else if let Some(cid_path) = ipfs_path(reference) {
            cid_candidates(&cid_path, &self.config.ipfs_gateways, &self.config.legacy_image_proxy)
        } else {
            bail!("NFT has no media and an unresolvable reference");
        };
        let mut last_error = anyhow!("NFT reference unavailable");
        for url in reference_urls {
            match self.fetch_bytes(&url, MAX_REFERENCE_BYTES, self.config.legacy_mirror_timeout).await {
                Ok(bytes) => {
                    let json: Value = serde_json::from_slice(&bytes).context("NFT reference is not JSON")?;
                    let media = json["media"]
                        .as_str()
                        .map(str::trim)
                        .filter(|m| !m.is_empty())
                        .ok_or_else(|| anyhow!("NFT reference has no media"))?;
                    if is_absolute_media(media) {
                        return Ok(media.to_string());
                    }
                    return Ok(match base_uri!() {
                        Some(base) if ipfs_path(media).is_none() => join_uri(&base, media),
                        _ => media.to_string(),
                    });
                }
                Err(e) => last_error = e,
            }
        }
        Err(last_error)
    }

    /// GET with SSRF protection, the near.social Referer (the IPFS mirror requires it), a size
    /// cap and a per-host timeout (never longer than `cap`).
    async fn fetch_bytes(&self, url: &str, max: usize, cap: Duration) -> Result<Bytes> {
        let parsed = url::Url::parse(url)?;
        if !is_fetchable(&parsed) {
            bail!("URL is not fetchable");
        }
        let timeout = timeout_for(
            &parsed,
            self.mirror_host.as_deref(),
            self.config.legacy_mirror_timeout,
            self.config.legacy_fetch_timeout,
        )
        .min(cap);
        let mut response = self
            .fetcher
            .get(parsed)
            .timeout(timeout)
            .header(reqwest::header::REFERER, &self.config.legacy_referer)
            .send()
            .await?
            .error_for_status()?;
        if response.content_length().is_some_and(|l| l as usize > max) {
            bail!("response too large");
        }
        let mut body = BytesMut::new();
        while let Some(chunk) = response.chunk().await? {
            if body.len() + chunk.len() > max {
                bail!("response too large");
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body.freeze())
    }

    async fn fetch_image(&self, url: &str, cap: Duration) -> Result<Image> {
        let bytes = self.fetch_bytes(url, MAX_IMAGE_BYTES, cap).await?;
        let content_type = sniff_image(&bytes).ok_or_else(|| anyhow!("not an image"))?;
        Ok(Image { bytes, content_type })
    }
}

fn decode_data_uri(uri: &str) -> Result<Image> {
    let rest = uri.strip_prefix("data:").ok_or_else(|| anyhow!("not a data URI"))?;
    let (meta, payload) = rest.split_once(',').ok_or_else(|| anyhow!("malformed data URI"))?;
    let bytes = if meta.ends_with(";base64") {
        BASE64.decode(payload.trim())?
    } else {
        percent_decode(payload)
    };
    if bytes.len() > MAX_IMAGE_BYTES {
        bail!("image too large");
    }
    let content_type = sniff_image(&bytes).ok_or_else(|| anyhow!("not an image"))?;
    Ok(Image {
        bytes: bytes.into(),
        content_type,
    })
}

fn percent_decode(s: &str) -> Vec<u8> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_legacy_profile() {
        let root = json!({"alice.near": {
            "profile": {
                "name": "Alice",
                "description": "Hello",
                "image": {"ipfs_cid": "bafkrei123", "url": null},
                "backgroundImage": {"nft": {"contractId": "x.near", "tokenId": "7"}},
                "linktree": {"twitter": "https://twitter.com/alice", "github": "@alice", "website": "alice.dev", "telegram": "", "Bad Key": "x"},
                "tags": {"a": ""}
            },
            "graph": {"follow": {"bob.near": "", "carol.near": null, "alice.near": "", "Bad": ""}}
        }});
        let d = normalize("alice.near", &root);
        assert!(d.exists);
        assert_eq!(d.profile.name.as_deref(), Some("Alice"));
        assert_eq!(d.profile.about.as_deref(), Some("Hello"));
        assert_eq!(
            d.profile.links,
            BTreeMap::from([
                ("github".to_string(), "alice".to_string()),
                ("website".to_string(), "alice.dev".to_string()),
                ("x".to_string(), "alice".to_string()),
            ])
        );
        assert!(matches!(d.avatar.as_slice(), [ImageSource::Ipfs { cid }] if cid == "bafkrei123"));
        assert!(matches!(d.banner.as_slice(), [ImageSource::Nft { .. }]));
        assert_eq!(d.follows, vec!["bob.near"]);
        assert!(!normalize("nobody.near", &json!({})).exists);
    }

    const CID: &str = "bafkreih2h5pl7ifraivslkexr6bgtsaeh6ltpyyzvjzmwqsz333thqqlny";
    const QM: &str = "QmP3shtToBeoeHizRtvgUPJTeGbcVn2rdZhERSwEiQHtJh";

    fn gateways() -> Vec<String> {
        vec!["https://ipfs.near.social".into(), "https://ipfs.io".into()]
    }

    #[test]
    fn extracts_ipfs_paths() {
        let cases = [
            (format!("https://byzantion.mypinata.cloud/ipfs/{CID}?img-width=800&img-fit=cover"), Some(CID.to_string())),
            (format!("https://{CID}.ipfs.nftstorage.link/"), Some(CID.to_string())),
            (format!("https://{CID}.ipfs.dweb.link/BASIC.png"), Some(format!("{CID}/BASIC.png"))),
            (format!("https://cloudflare-ipfs.com/ipfs/{QM}/3107.png"), Some(format!("{QM}/3107.png"))),
            (format!("https://paras-ipfs.paras.id/{QM}"), Some(QM.to_string())),
            (format!("ipfs://{CID}/a.png"), Some(format!("{CID}/a.png"))),
            (format!("ipfs://ipfs/{CID}"), Some(CID.to_string())),
            (CID.to_string(), Some(CID.to_string())),
            ("https://pbs.twimg.com/profile_images/1/x.jpg".to_string(), None),
            ("https://example.com/ipfs/not-a-cid".to_string(), None),
        ];
        for (input, expected) in cases {
            assert_eq!(ipfs_path(&input), expected, "{input}");
        }
    }

    #[test]
    fn candidate_order() {
        let url = format!("https://{CID}.ipfs.nftstorage.link/");
        assert_eq!(
            url_candidates(&url, &gateways(), "https://i.near.social"),
            vec![
                // Original bytes first…
                format!("https://ipfs.near.social/ipfs/{CID}"),
                format!("https://ipfs.io/ipfs/{CID}"),
                url.clone(),
                // …resized copies from the near.social image proxy last.
                format!("https://i.near.social/large/https://ipfs.near.social/ipfs/{CID}"),
                format!("https://i.near.social/large/{url}"),
            ]
        );
        let arweave = "https://abc.arweave.net/auXZR03GpP8jcmsOYLkRC37Ummm5_hlMfewI9fvFh4E/Images/3324.png";
        assert_eq!(
            url_candidates(arweave, &gateways(), "https://i.near.social")[0],
            "https://arweave.net/auXZR03GpP8jcmsOYLkRC37Ummm5_hlMfewI9fvFh4E/Images/3324.png"
        );
        let twitter = "https://pbs.twimg.com/profile_images/1/x.jpg";
        assert_eq!(
            url_candidates(twitter, &gateways(), "https://i.near.social"),
            vec![twitter.to_string(), format!("https://i.near.social/large/{twitter}")]
        );
    }

    #[test]
    fn never_imports_placeholders() {
        let placeholder = format!("https://ipfs.near.social/ipfs/{}", PLACEHOLDER_CIDS[0]);
        assert!(url_candidates(&placeholder, &gateways(), "https://i.near.social").is_empty());
        assert!(cid_candidates(PLACEHOLDER_CIDS[1], &gateways(), "https://i.near.social").is_empty());
    }

    #[test]
    fn all_sources_in_widget_precedence() {
        let root = json!({"a.near": {"profile": {
            "image": {"url": "https://x.io/a.png", "nft": {"contractId": "pitchtalk.hot.tg", "tokenId": "2248"}, "ipfs_cid": "bafy"},
            "backgroundImage": {"url": "https://x.io/b.png", "nft": {"contractId": "0xNotNear", "tokenId": "1"}}
        }}});
        let d = normalize("a.near", &root);
        assert!(matches!(
            d.avatar.as_slice(),
            [ImageSource::Nft { .. }, ImageSource::Ipfs { .. }, ImageSource::Url { .. }]
        ));
        assert!(matches!(d.banner.as_slice(), [ImageSource::Url { .. }]));
    }

    #[test]
    fn mirror_gets_a_longer_timeout() {
        let (mirror, default) = (Duration::from_secs(30), Duration::from_secs(8));
        let t = |u: &str| timeout_for(&url::Url::parse(u).unwrap(), Some("ipfs.near.social"), mirror, default);
        assert_eq!(t("https://ipfs.near.social/ipfs/x"), mirror);
        assert_eq!(t("https://IPFS.near.social/ipfs/x"), mirror);
        assert_eq!(t("https://ipfs.io/ipfs/x"), default);
        assert_eq!(t("https://i.near.social/large/https://ipfs.near.social/ipfs/x"), default);
    }

    #[test]
    fn blocks_private_addresses() {
        for ip in ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "::ffff:127.0.0.1"] {
            assert!(!is_public_ip(ip.parse().unwrap()), "{ip}");
        }
        assert!(is_public_ip("1.1.1.1".parse().unwrap()));
        assert!(!is_fetchable(&url::Url::parse("http://169.254.169.254/latest").unwrap()));
        assert!(!is_fetchable(&url::Url::parse("file:///etc/passwd").unwrap()));
        assert!(!is_fetchable(&url::Url::parse("http://localhost:8080/").unwrap()));
        assert!(is_fetchable(&url::Url::parse("https://ipfs.near.social/ipfs/x").unwrap()));
    }

    #[test]
    fn data_uris() {
        let png = [0x89, b'P', b'N', b'G', 0, 0];
        let uri = format!("data:image/png;base64,{}", BASE64.encode(png));
        assert_eq!(decode_data_uri(&uri).unwrap().content_type, "image/png");
        let svg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
        assert_eq!(decode_data_uri(svg).unwrap().content_type, "image/svg+xml");
    }
}
