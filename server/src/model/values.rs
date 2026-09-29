//! Value validation of social-kv/1 (STANDARD.md §3–4).

use crate::model::account_id::is_valid_account_id;
use crate::model::keys::{parse_post_ref, ProfileField};
use serde_json::Value;

pub const MAX_NAME: usize = 256;
pub const MAX_ABOUT: usize = 10_000;
pub const MAX_LOCATION: usize = 256;
pub const MAX_LINK: usize = 2048;
pub const MAX_TEXT: usize = 25_000;
pub const MAX_MEDIA: usize = 10;
pub const MAX_ALT: usize = 5_000;
pub const MAX_DIMENSION: u64 = 16_384;
pub const MEDIA_MIME_TYPES: &[&str] = &[
    "image/webp",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/avif",
];

fn char_len(s: &str) -> usize {
    s.chars().count()
}

/// `fastfs://{account}/{receiver}/{path}` with a safe path.
pub fn is_valid_media_uri(s: &str) -> bool {
    let Some(rest) = s.strip_prefix("fastfs://") else {
        return false;
    };
    let mut parts = rest.splitn(3, '/');
    let (Some(account), Some(receiver), Some(path)) = (parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    is_valid_account_id(account)
        && is_valid_account_id(receiver)
        && (1..=1024).contains(&path.len())
        && !path.starts_with('/')
        && !path.contains("..")
        && path
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-' | b'/'))
}

/// Resolves a validated `fastfs://` URI to an HTTPS URL on the gateway.
pub fn media_url(gateway: &str, uri: &str) -> String {
    format!("{gateway}/{}", &uri["fastfs://".len()..])
}

/// A profile field value: `Ok(None)` clears the field.
pub fn parse_profile_field(field: ProfileField, value: &Value) -> Result<Option<String>, String> {
    let s = match value {
        Value::Null => return Ok(None),
        Value::String(s) if s.is_empty() => return Ok(None),
        Value::String(s) => s,
        _ => return Err("expected a string or null".into()),
    };
    match field {
        ProfileField::Name if char_len(s) > MAX_NAME => Err(format!("name over {MAX_NAME} chars")),
        ProfileField::About if char_len(s) > MAX_ABOUT => {
            Err(format!("about over {MAX_ABOUT} chars"))
        }
        ProfileField::Location if char_len(s) > MAX_LOCATION => {
            Err(format!("location over {MAX_LOCATION} chars"))
        }
        ProfileField::Avatar | ProfileField::Banner if !is_valid_media_uri(s) => {
            Err("expected a fastfs:// media URI".into())
        }
        _ => Ok(Some(s.clone())),
    }
}

pub fn parse_profile_link(value: &Value) -> Result<Option<String>, String> {
    match value {
        Value::Null => Ok(None),
        Value::String(s) if s.is_empty() => Ok(None),
        Value::String(s) if char_len(s) > MAX_LINK => Err(format!("link over {MAX_LINK} chars")),
        Value::String(s) => Ok(Some(s.clone())),
        _ => Err("expected a string or null".into()),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MediaValue {
    pub src: String,
    pub mime: String,
    pub w: Option<u32>,
    pub h: Option<u32>,
    pub alt: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PostValue {
    pub text: String,
    pub media: Vec<MediaValue>,
    pub reply_to: Option<(String, u64)>,
    pub root: Option<(String, u64)>,
    pub quote: Option<(String, u64)>,
}

fn opt_ref(obj: &serde_json::Map<String, Value>, field: &str) -> Result<Option<(String, u64)>, String> {
    match obj.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => parse_post_ref(s)
            .map(|(a, id)| Some((a.to_string(), id)))
            .ok_or_else(|| format!("{field}: expected \"account/post_id\"")),
        Some(_) => Err(format!("{field}: expected a string")),
    }
}

fn parse_dimension(v: Option<&Value>, field: &str) -> Result<Option<u32>, String> {
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_u64() {
            Some(n) if (1..=MAX_DIMENSION).contains(&n) => Ok(Some(n as u32)),
            _ => Err(format!("media.{field}: expected an integer 1..={MAX_DIMENSION}")),
        },
    }
}

fn parse_media(v: &Value) -> Result<MediaValue, String> {
    let obj = v.as_object().ok_or("media: expected objects")?;
    let src = match obj.get("src") {
        Some(Value::String(s)) if is_valid_media_uri(s) => s.clone(),
        _ => return Err("media.src: expected a fastfs:// URI".into()),
    };
    let mime = match obj.get("mime") {
        Some(Value::String(s)) if MEDIA_MIME_TYPES.contains(&s.as_str()) => s.clone(),
        _ => return Err(format!("media.mime: expected one of {}", MEDIA_MIME_TYPES.join(", "))),
    };
    let alt = match obj.get("alt") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if char_len(s) <= MAX_ALT => Some(s.clone()),
        Some(Value::String(_)) => return Err(format!("media.alt over {MAX_ALT} chars")),
        Some(_) => return Err("media.alt: expected a string".into()),
    };
    Ok(MediaValue {
        src,
        mime,
        w: parse_dimension(obj.get("w"), "w")?,
        h: parse_dimension(obj.get("h"), "h")?,
        alt,
    })
}

/// Validates a `post/{id}` value (not null). Any violation makes the post invalid.
pub fn parse_post(author: &str, id: u64, value: &Value) -> Result<PostValue, String> {
    let obj = value.as_object().ok_or("post must be a JSON object")?;
    let text = match obj.get("text") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) if char_len(s) <= MAX_TEXT => s.clone(),
        Some(Value::String(_)) => return Err(format!("text over {MAX_TEXT} chars")),
        Some(_) => return Err("text: expected a string".into()),
    };
    let media = match obj.get("media") {
        None | Some(Value::Null) => vec![],
        Some(Value::Array(items)) if items.len() <= MAX_MEDIA => {
            items.iter().map(parse_media).collect::<Result<Vec<_>, _>>()?
        }
        Some(Value::Array(_)) => return Err(format!("more than {MAX_MEDIA} media items")),
        Some(_) => return Err("media: expected an array".into()),
    };
    let reply_to = opt_ref(obj, "reply_to")?;
    let root = opt_ref(obj, "root")?;
    let quote = opt_ref(obj, "quote")?;
    let is_self = |r: &Option<(String, u64)>| matches!(r, Some((a, i)) if a == author && *i == id);
    if is_self(&reply_to) || is_self(&quote) {
        return Err("a post can't reply to or quote itself".into());
    }
    if text.trim().is_empty() && media.is_empty() && quote.is_none() {
        return Err("post needs text, media or a quote".into());
    }
    // Without a parent, `root` is meaningless.
    let root = if reply_to.is_some() {
        root.or_else(|| reply_to.clone())
    } else {
        None
    };
    Ok(PostValue {
        text,
        media,
        reply_to,
        root,
        quote,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn media_uris() {
        assert!(is_valid_media_uri("fastfs://alice.near/social/media/abc.webp"));
        for bad in [
            "https://x.com/a.png",
            "fastfs://alice.near/social/",
            "fastfs://alice.near/social//a",
            "fastfs://alice.near/social/../a",
            "fastfs://Alice/social/a",
            "fastfs://alice.near/social/a b",
        ] {
            assert!(!is_valid_media_uri(bad), "{bad}");
        }
        assert_eq!(
            media_url("https://main.fastfs.io", "fastfs://a.near/social/media/x.webp"),
            "https://main.fastfs.io/a.near/social/media/x.webp"
        );
    }

    #[test]
    fn posts() {
        let p = parse_post("a.near", 5, &json!({"text": "hi", "reply_to": "b.near/1"})).unwrap();
        assert_eq!(p.root, Some(("b.near".into(), 1)));
        assert!(parse_post("a.near", 5, &json!({"text": " "})).is_err());
        assert!(parse_post("a.near", 5, &json!({"text": 1})).is_err());
        assert!(parse_post("a.near", 5, &json!({"text": "x", "reply_to": "a.near/5"})).is_err());
        assert!(parse_post("a.near", 5, &json!({"text": "x", "quote": "bad"})).is_err());
        assert!(parse_post("a.near", 5, &json!({"quote": "b.near/2"})).is_ok());
        assert!(parse_post("a.near", 5, &json!({"text": "x".repeat(MAX_TEXT)})).is_ok());
        assert!(parse_post("a.near", 5, &json!({"text": "x".repeat(MAX_TEXT + 1)})).is_err());
        let m = json!({"media": [{"src": "fastfs://a.near/social/media/1.webp", "mime": "image/webp", "w": 10, "h": 20}]});
        assert_eq!(parse_post("a.near", 5, &m).unwrap().media[0].w, Some(10));
        let bad = json!({"media": [{"src": "https://evil/1.png", "mime": "image/png"}]});
        assert!(parse_post("a.near", 5, &bad).is_err());
        // Unknown fields are ignored.
        assert!(parse_post("a.near", 5, &json!({"text": "x", "future": 1})).is_ok());
    }

    #[test]
    fn profile_fields() {
        assert_eq!(parse_profile_field(ProfileField::Name, &json!("Al")).unwrap(), Some("Al".into()));
        assert_eq!(parse_profile_field(ProfileField::Name, &json!("")).unwrap(), None);
        assert_eq!(parse_profile_field(ProfileField::Name, &Value::Null).unwrap(), None);
        assert!(parse_profile_field(ProfileField::Name, &json!({"a": 1})).is_err());
        assert!(parse_profile_field(ProfileField::Avatar, &json!("https://x/y.png")).is_err());
        assert!(parse_profile_field(ProfileField::Name, &json!("é".repeat(MAX_NAME))).is_ok());
        assert!(parse_profile_field(ProfileField::Name, &json!("é".repeat(MAX_NAME + 1))).is_err());
    }
}
