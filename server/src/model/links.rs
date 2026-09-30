//! Classifies URLs found in post text for link previews and embeds (docs/API.md, `link`).

use crate::model::account_id::is_valid_account_id;
use crate::model::keys::parse_post_id;
use regex::Regex;
use std::sync::LazyLock;
use url::Url;

static YOUTUBE_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_-]{11}$").unwrap());
static YOUTUBE_START: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$").unwrap());
static UUID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").unwrap()
});

const MAX_START_SECONDS: u32 = 86_400;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkKind {
    Youtube { id: String, start: Option<u32>, shorts: bool },
    NearFm { uuid: String },
    /// A post on this site: `https://{site}/{account}/post/{id}`.
    SitePost { account: String, id: u64 },
    /// Any other page on this site (never previewed).
    Site,
    Web,
}

/// `90`, `90s`, `1m30s`, `1h2m3s`, `2m` → seconds (0 and garbage → None).
pub fn parse_youtube_start(s: &str) -> Option<u32> {
    let caps = YOUTUBE_START.captures(s)?;
    let part = |i: usize| caps.get(i).map_or(Some(0), |m| m.as_str().parse::<u64>().ok());
    let seconds = part(1)? * 3600 + part(2)? * 60 + part(3)?;
    (seconds > 0).then(|| seconds.min(MAX_START_SECONDS as u64) as u32)
}

fn youtube(url: &Url, host: &str) -> Option<LinkKind> {
    let segments: Vec<&str> = url.path_segments()?.filter(|s| !s.is_empty()).collect();
    let (id, shorts): (String, bool) = match host {
        "youtu.be" => (segments.first()?.to_string(), false),
        "youtube-nocookie.com" => match segments.as_slice() {
            ["embed", id, ..] => (id.to_string(), false),
            _ => return None,
        },
        _ => match segments.as_slice() {
            ["watch"] => (url.query_pairs().find(|(k, _)| k == "v")?.1.into_owned(), false),
            ["shorts", id, ..] => (id.to_string(), true),
            ["embed" | "live" | "v", id, ..] => (id.to_string(), false),
            _ => return None,
        },
    };
    if !YOUTUBE_ID.is_match(&id) {
        return None;
    }
    let start = url
        .query_pairs()
        .find(|(k, _)| k == "t" || k == "start")
        .map(|(_, v)| v.into_owned())
        .or_else(|| url.fragment().and_then(|f| f.strip_prefix("t=")).map(String::from))
        .and_then(|t| parse_youtube_start(&t));
    Some(LinkKind::Youtube { id, start, shorts })
}

/// Classifies `url`. `site_hosts` are this site's hostnames (e.g. `near.social`).
pub fn classify(url: &str, site_hosts: &[String]) -> Option<LinkKind> {
    let parsed = Url::parse(url).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    let host = parsed.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    if site_hosts.iter().any(|h| h.eq_ignore_ascii_case(&host)) {
        let segments: Vec<&str> = parsed.path_segments().map_or(vec![], |s| s.filter(|s| !s.is_empty()).collect());
        return Some(match segments.as_slice() {
            [account, "post", id] if is_valid_account_id(account) => match parse_post_id(id) {
                Some(id) => LinkKind::SitePost { account: account.to_string(), id },
                None => LinkKind::Site,
            },
            _ => LinkKind::Site,
        });
    }
    let bare = host.strip_prefix("www.").unwrap_or(&host);
    match bare {
        "youtube.com" | "m.youtube.com" | "music.youtube.com" | "youtu.be" | "youtube-nocookie.com" => {
            let bare = if bare.ends_with("youtube.com") { "youtube.com" } else { bare };
            Some(youtube(&parsed, bare).unwrap_or(LinkKind::Web))
        }
        "near.fm" => {
            let segments: Vec<&str> = parsed.path_segments().map_or(vec![], |s| s.filter(|s| !s.is_empty()).collect());
            Some(match segments.as_slice() {
                ["song", uuid] if UUID.is_match(&uuid.to_ascii_lowercase()) => {
                    LinkKind::NearFm { uuid: uuid.to_ascii_lowercase() }
                }
                _ => LinkKind::Web,
            })
        }
        _ => Some(LinkKind::Web),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn site() -> Vec<String> {
        vec!["near.social".into(), "www.near.social".into()]
    }

    fn yt(id: &str, start: Option<u32>, shorts: bool) -> Option<LinkKind> {
        Some(LinkKind::Youtube { id: id.into(), start, shorts })
    }

    #[test]
    fn youtube_urls() {
        let id = "dQw4w9WgXcQ";
        for (url, expected) in [
            (format!("https://www.youtube.com/watch?v={id}"), yt(id, None, false)),
            (format!("https://youtube.com/watch?feature=share&v={id}&t=90"), yt(id, Some(90), false)),
            (format!("https://m.youtube.com/watch?v={id}&t=1m30s"), yt(id, Some(90), false)),
            (format!("https://music.youtube.com/watch?v={id}"), yt(id, None, false)),
            (format!("https://youtu.be/{id}?t=1h2m3s"), yt(id, Some(3723), false)),
            (format!("https://www.youtube.com/shorts/{id}"), yt(id, None, true)),
            (format!("https://www.youtube.com/embed/{id}?start=30"), yt(id, Some(30), false)),
            (format!("https://www.youtube.com/live/{id}"), yt(id, None, false)),
            (format!("https://www.youtube-nocookie.com/embed/{id}"), yt(id, None, false)),
            (format!("https://www.youtube.com/watch?v={id}#t=2m"), yt(id, Some(120), false)),
            // Not a single video: previewed as an ordinary page.
            ("https://www.youtube.com/watch?v=short".into(), Some(LinkKind::Web)),
            (format!("https://www.youtube.com/watch?v={id}x"), Some(LinkKind::Web)),
            ("https://www.youtube.com/playlist?list=PL123".into(), Some(LinkKind::Web)),
            ("https://www.youtube.com/@near".into(), Some(LinkKind::Web)),
        ] {
            assert_eq!(classify(&url, &site()), expected, "{url}");
        }
    }

    #[test]
    fn youtube_start_times() {
        for (s, expected) in [
            ("90", Some(90)),
            ("90s", Some(90)),
            ("2m", Some(120)),
            ("1h", Some(3600)),
            ("0", None),
            ("", None),
            ("abc", None),
            ("999999999", Some(MAX_START_SECONDS)),
        ] {
            assert_eq!(parse_youtube_start(s), expected, "{s}");
        }
    }

    #[test]
    fn near_fm_urls() {
        let uuid = "790555c9-f807-4d8d-a81d-a644a7b24f40";
        let fm = Some(LinkKind::NearFm { uuid: uuid.into() });
        assert_eq!(classify(&format!("https://near.fm/song/{uuid}"), &site()), fm);
        assert_eq!(classify(&format!("https://www.near.fm/song/{}/?ref=x", uuid.to_uppercase()), &site()), fm);
        assert_eq!(classify("https://near.fm/song/820", &site()), Some(LinkKind::Web));
        assert_eq!(classify("https://near.fm/profile/vadim", &site()), Some(LinkKind::Web));
    }

    #[test]
    fn site_urls() {
        assert_eq!(
            classify("https://near.social/alice.near/post/1759140000000?x=1#y", &site()),
            Some(LinkKind::SitePost { account: "alice.near".into(), id: 1759140000000 })
        );
        assert_eq!(
            classify("https://www.near.social/alice.near/post/12", &site()),
            Some(LinkKind::SitePost { account: "alice.near".into(), id: 12 })
        );
        assert_eq!(classify("https://near.social/alice.near", &site()), Some(LinkKind::Site));
        assert_eq!(classify("https://near.social/Bad/post/12", &site()), Some(LinkKind::Site));
        assert_eq!(classify("https://near.social/alice.near/post/012", &site()), Some(LinkKind::Site));
        assert_eq!(classify("https://github.com/near", &site()), Some(LinkKind::Web));
        assert_eq!(classify("ftp://x.io/a", &site()), None);
    }
}
