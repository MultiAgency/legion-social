//! Link cards from a page's Open Graph / Twitter card tags (falling back to `<title>` and the
//! meta description). Only the start of the page is read, up to `</head>`.

use super::{clean_text, Outcome, Preview, TTL_CARD};
use crate::fetch::{read_capped, SafeClient};
use encoding_rs::Encoding;
use scraper::{Html, Selector};
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;
use url::Url;

const MAX_HTML_BYTES: usize = 512 * 1024;
const TIMEOUT: Duration = Duration::from_secs(6);
const MAX_TITLE: usize = 200;
const MAX_DESCRIPTION: usize = 300;
const MAX_SITE_NAME: usize = 80;
const MAX_IMAGE_URL: usize = 2048;

static HEAD_END: LazyLock<regex::bytes::Regex> =
    LazyLock::new(|| regex::bytes::Regex::new(r"(?i)</head|<body[\s>]").unwrap());
static META_CHARSET: LazyLock<regex::bytes::Regex> = LazyLock::new(|| {
    regex::bytes::Regex::new(r#"(?i)<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_:.\-]+)"#).unwrap()
});
static LOOKS_LIKE_HTML: LazyLock<regex::bytes::Regex> =
    LazyLock::new(|| regex::bytes::Regex::new(r"(?i)^\s*(<!doctype\s+html|<html|<head)").unwrap());

#[derive(Debug, Clone, PartialEq)]
pub struct PageMeta {
    pub title: String,
    pub description: Option<String>,
    pub site_name: Option<String>,
    pub image: Option<String>,
    pub large: bool,
}

impl From<PageMeta> for Preview {
    fn from(m: PageMeta) -> Self {
        Preview::Card {
            title: m.title,
            description: m.description,
            site_name: m.site_name,
            image: m.image,
            large: m.large,
        }
    }
}

pub async fn fetch(client: &SafeClient, url: &Url) -> Outcome {
    let headers = [
        ("accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"),
        ("accept-language", "en"),
    ];
    let response = match client.get(url, TIMEOUT, &headers).await {
        Ok(response) => response,
        Err(e) => {
            tracing::debug!(target: "unfurl", "{url}: {e}");
            return Outcome::transient();
        }
    };
    let status = response.status();
    if status.is_client_error() {
        return Outcome::nothing();
    }
    if !status.is_success() {
        return Outcome::transient();
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_ascii_lowercase);
    if content_type
        .as_deref()
        .is_some_and(|ct| !ct.starts_with("text/html") && !ct.starts_with("application/xhtml+xml"))
    {
        return Outcome::nothing();
    }
    let base = response.url().clone();
    let body = match read_capped(response.bytes_stream(), MAX_HTML_BYTES, Some(&HEAD_END)).await {
        Ok(capped) => capped.body,
        Err(_) => return Outcome::transient(),
    };
    if content_type.is_none() && !LOOKS_LIKE_HTML.is_match(&body[..body.len().min(1024)]) {
        return Outcome::nothing();
    }
    match tokio::task::spawn_blocking(move || extract(&body, content_type.as_deref(), &base)).await {
        Ok(Some(meta)) => Outcome {
            preview: meta.into(),
            ttl: TTL_CARD,
        },
        Ok(None) => Outcome::nothing(),
        Err(_) => Outcome::transient(),
    }
}

/// Decodes by BOM, then the Content-Type charset, then `<meta charset>`, else UTF-8 (lossy).
fn decode(bytes: &[u8], content_type: Option<&str>) -> String {
    let from_header = || {
        content_type?
            .split(';')
            .find_map(|p| p.trim().strip_prefix("charset="))
            .and_then(|label| Encoding::for_label(label.trim_matches(['"', '\'']).as_bytes()))
    };
    let from_meta = || {
        META_CHARSET
            .captures(&bytes[..bytes.len().min(4096)])
            .and_then(|c| Encoding::for_label(&c[1]))
    };
    let encoding = Encoding::for_bom(bytes)
        .map(|(e, _)| e)
        .or_else(from_header)
        .or_else(from_meta)
        .unwrap_or(encoding_rs::UTF_8);
    encoding.decode(bytes).0.into_owned()
}

fn selector(s: &str) -> Selector {
    Selector::parse(s).expect("valid selector")
}

pub fn extract(bytes: &[u8], content_type: Option<&str>, page: &Url) -> Option<PageMeta> {
    let html = Html::parse_document(&decode(bytes, content_type));
    // First occurrence of each `property` / `name` wins.
    let mut meta: HashMap<String, String> = HashMap::new();
    for el in html.select(&selector("meta")) {
        let key = el.value().attr("property").or_else(|| el.value().attr("name"));
        if let (Some(key), Some(content)) = (key, el.value().attr("content")) {
            meta.entry(key.trim().to_ascii_lowercase()).or_insert_with(|| content.to_string());
        }
    }
    let get = |keys: &[&str]| {
        keys.iter()
            .find_map(|k| meta.get(*k).map(String::as_str).filter(|v| !v.trim().is_empty()))
    };
    let title_tag = html.select(&selector("title")).next().map(|t| t.text().collect::<String>());
    let title = get(&["og:title", "twitter:title"])
        .map(str::to_string)
        .or(title_tag)
        .and_then(|t| clean_text(&t, MAX_TITLE))?;
    let description = get(&["og:description", "twitter:description", "description"])
        .and_then(|d| clean_text(d, MAX_DESCRIPTION));
    let site_name = get(&["og:site_name"]).and_then(|s| clean_text(s, MAX_SITE_NAME));
    let base = html
        .select(&selector("base[href]"))
        .next()
        .and_then(|b| b.value().attr("href"))
        .and_then(|href| page.join(href.trim()).ok())
        .unwrap_or_else(|| page.clone());
    let image = get(&["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"])
        .and_then(|src| base.join(src.trim()).ok())
        .filter(|u| {
            matches!(u.scheme(), "http" | "https")
                && u.as_str().len() <= MAX_IMAGE_URL
                && !u.path().to_ascii_lowercase().ends_with(".svg") // the image proxy can't render SVG
        })
        .map(String::from);
    let card = get(&["twitter:card"]).map(|c| c.trim().to_ascii_lowercase());
    let mut large = image.is_some()
        && match card.as_deref() {
            Some("summary_large_image" | "player") => true,
            Some(_) => false,
            None => true,
        };
    let dimension = |k: &str| get(&[k]).and_then(|v| v.trim().parse::<f64>().ok()).filter(|v| *v > 0.0);
    if let (Some(w), Some(h)) = (dimension("og:image:width"), dimension("og:image:height")) {
        if w / h < 1.3 {
            large = false; // square-ish images look better small
        }
    }
    Some(PageMeta {
        title,
        description,
        site_name,
        image,
        large,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page() -> Url {
        Url::parse("https://example.com/articles/one?x=1").unwrap()
    }

    fn meta(html: &str) -> Option<PageMeta> {
        extract(html.as_bytes(), Some("text/html"), &page())
    }

    #[test]
    fn open_graph() {
        let m = meta(
            r#"<html><head><title>Fallback</title>
            <meta property="og:title" content="The &amp; Title">
            <meta property="og:description" content="  A   description  ">
            <meta property="og:site_name" content="Example">
            <meta property="og:image" content="/img/cover.png">
            <meta name="twitter:card" content="summary_large_image">
            </head><body>ignored</body></html>"#,
        )
        .unwrap();
        assert_eq!(m.title, "The & Title");
        assert_eq!(m.description.as_deref(), Some("A description"));
        assert_eq!(m.site_name.as_deref(), Some("Example"));
        assert_eq!(m.image.as_deref(), Some("https://example.com/img/cover.png"));
        assert!(m.large);
    }

    #[test]
    fn fallbacks() {
        let m = meta(
            r#"<head><title> Just a title </title><meta name="description" content="Desc">
            <meta name="twitter:image" content="//cdn.example.net/a.jpg"><meta name="twitter:card" content="summary"></head>"#,
        )
        .unwrap();
        assert_eq!(m.title, "Just a title");
        assert_eq!(m.description.as_deref(), Some("Desc"));
        assert_eq!(m.image.as_deref(), Some("https://cdn.example.net/a.jpg"));
        assert!(!m.large, "twitter:card summary is a small card");
        // Twitter tags only; content before property; single quotes; upper case.
        let m = meta(r#"<HEAD><META content='T' NAME='twitter:title'></HEAD>"#).unwrap();
        assert_eq!(m.title, "T");
        assert_eq!(m.image, None);
        assert!(!m.large);
    }

    #[test]
    fn base_href_and_bad_images() {
        let m = meta(r#"<head><base href="https://static.example.org/assets/"><meta property="og:title" content="t"><meta property="og:image" content="x.jpg"></head>"#).unwrap();
        assert_eq!(m.image.as_deref(), Some("https://static.example.org/assets/x.jpg"));
        for bad in ["javascript:alert(1)", "data:image/png;base64,AAAA", "https://x.io/logo.svg"] {
            let m = meta(&format!(r#"<meta property="og:title" content="t"><meta property="og:image" content="{bad}">"#)).unwrap();
            assert_eq!(m.image, None, "{bad}");
        }
    }

    #[test]
    fn square_images_make_small_cards() {
        let m = meta(r#"<meta property="og:title" content="t"><meta property="og:image" content="/a.png">
            <meta property="og:image:width" content="400"><meta property="og:image:height" content="400">"#)
        .unwrap();
        assert!(!m.large);
    }

    #[test]
    fn no_title_means_no_card() {
        assert_eq!(meta(r#"<head><meta property="og:image" content="/a.png"></head>"#), None);
    }

    #[test]
    fn long_text_is_truncated() {
        let m = meta(&format!(r#"<meta property="og:title" content="{}">"#, "x".repeat(500))).unwrap();
        assert_eq!(m.title.chars().count(), MAX_TITLE + 1);
        assert!(m.title.ends_with('…'));
    }

    #[test]
    fn charsets() {
        let (cp1251, _, _) = encoding_rs::WINDOWS_1251.encode("Привет");
        let html = [b"<head><meta charset=\"windows-1251\"><title>".as_slice(), &cp1251, b"</title></head>"].concat();
        assert_eq!(extract(&html, Some("text/html"), &page()).unwrap().title, "Привет");
        let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode("日本語");
        let html = [b"<title>".as_slice(), &sjis, b"</title>"].concat();
        assert_eq!(extract(&html, Some("text/html; charset=Shift_JIS"), &page()).unwrap().title, "日本語");
        let html = [b"\xEF\xBB\xBF<title>".as_slice(), "héllo".as_bytes(), b"</title>"].concat();
        assert_eq!(extract(&html, Some("text/html; charset=iso-8859-1"), &page()).unwrap().title, "héllo");
    }

    #[test]
    fn truncated_head_still_parses() {
        let m = meta(r#"<html><head><meta property="og:title" content="Cut"><meta property="og:desc"#).unwrap();
        assert_eq!(m.title, "Cut");
    }
}
