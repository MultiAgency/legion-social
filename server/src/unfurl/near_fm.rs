//! near.fm songs (`https://near.fm/song/{uuid}`), played natively by clients.
//! Metadata comes from near.fm's API; audio and covers are FastFS files.

use super::{clean_text, Outcome, Preview, TTL_NEAR_FM, TTL_NOTHING};
use crate::fetch::{read_capped, SafeClient};
use regex::Regex;
use serde::Deserialize;
use std::sync::LazyLock;
use std::time::Duration;
use url::Url;

const MAX_BYTES: usize = 256 * 1024;
const TIMEOUT: Duration = Duration::from_secs(6);
const MAX_DURATION: f64 = 86_400.0;
const MAX_TITLE: usize = 200;
const MAX_ARTIST: usize = 100;

static PROFILE_SLUG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._-]{1,64}$").unwrap());

#[derive(Deserialize)]
struct Response {
    song: Song,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Song {
    title: Option<String>,
    uploader_display_name: Option<String>,
    uploader_account_id: Option<String>,
    cover_image_url: Option<String>,
    audio_url: Option<String>,
    audio_mime_type: Option<String>,
    audio_duration_seconds: Option<f64>,
    is_hidden: bool,
    is_deleted: bool,
}

pub async fn fetch(client: &SafeClient, api: &str, gateway: &str, uuid: &str) -> Outcome {
    let Ok(url) = Url::parse(&format!("{}/api/songs/{uuid}", api.trim_end_matches('/'))) else {
        return Outcome::nothing();
    };
    let response = match client.get(&url, TIMEOUT, &[("accept", "application/json")]).await {
        Ok(response) => response,
        Err(e) => {
            tracing::debug!(target: "unfurl", "near.fm {uuid}: {e}");
            return Outcome::transient();
        }
    };
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Outcome { preview: Preview::Unavailable, ttl: TTL_NOTHING };
    }
    if !response.status().is_success() {
        return Outcome::transient();
    }
    match read_capped(response.bytes_stream(), MAX_BYTES, None).await {
        Ok(capped) if capped.complete => match serde_json::from_slice::<Response>(&capped.body) {
            Ok(r) => to_preview(r.song, uuid, gateway),
            Err(_) => Outcome::transient(),
        },
        Ok(_) => Outcome::nothing(),
        Err(_) => Outcome::transient(),
    }
}

pub fn to_preview(song: Song, uuid: &str, gateway: &str) -> Outcome {
    if song.is_hidden || song.is_deleted {
        return Outcome { preview: Preview::Unavailable, ttl: TTL_NOTHING };
    }
    // Only FastFS files: that's what clients (and their CSP) load media from.
    let on_gateway = |u: &String| u.starts_with(&format!("{}/", gateway.trim_end_matches('/')));
    let (Some(audio), Some(title)) = (
        song.audio_url.filter(on_gateway),
        song.title.and_then(|t| clean_text(&t, MAX_TITLE)),
    ) else {
        return Outcome::nothing();
    };
    let account = song.uploader_account_id.filter(|a| PROFILE_SLUG.is_match(a));
    let artist = song
        .uploader_display_name
        .and_then(|n| clean_text(&n, MAX_ARTIST))
        .or_else(|| account.clone())
        .unwrap_or_else(|| "near.fm".to_string());
    Outcome {
        preview: Preview::NearFm {
            uuid: uuid.to_string(),
            title,
            artist,
            artist_url: account.map(|a| format!("https://near.fm/profile/{a}")),
            cover: song.cover_image_url.filter(on_gateway),
            audio,
            mime: song.audio_mime_type.filter(|m| m.starts_with("audio/")),
            duration: song
                .audio_duration_seconds
                .filter(|d| d.is_finite() && *d > 0.0)
                .map(|d| d.round().min(MAX_DURATION) as u32),
        },
        ttl: TTL_NEAR_FM,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GATEWAY: &str = "https://main.fastfs.io";
    const UUID: &str = "790555c9-f807-4d8d-a81d-a644a7b24f40";

    /// Trimmed from a real `GET https://api.near.fm/api/songs/{uuid}` response.
    const RESPONSE: &str = r#"{"song":{"id":820,"uuid":"790555c9-f807-4d8d-a81d-a644a7b24f40","title":"NEAR IN TRENDS",
      "audio_url":"https://main.fastfs.io/zavodil.near/near-fm.near/8722cb2086b60830d12fdc132a6bdb494089ece6469eb02c063a4d2ae7c1600d.mp3",
      "audio_duration_seconds":233,"audio_mime_type":"audio/mpeg",
      "cover_image_url":"https://main.fastfs.io/zavodil.near/near-fm.near/29efc86d.png",
      "uploader_account_id":"zavodil.near","uploader_display_name":"Vadim","is_hidden":false,"is_deleted":false,
      "genres":[{"id":4,"name":"Rock","slug":"rock"}]}}"#;

    fn song(json: &str) -> Song {
        serde_json::from_str::<Response>(json).unwrap().song
    }

    #[test]
    fn maps_a_song() {
        let outcome = to_preview(song(RESPONSE), UUID, GATEWAY);
        assert_eq!(outcome.ttl, TTL_NEAR_FM);
        assert_eq!(
            outcome.preview,
            Preview::NearFm {
                uuid: UUID.into(),
                title: "NEAR IN TRENDS".into(),
                artist: "Vadim".into(),
                artist_url: Some("https://near.fm/profile/zavodil.near".into()),
                cover: Some("https://main.fastfs.io/zavodil.near/near-fm.near/29efc86d.png".into()),
                audio: "https://main.fastfs.io/zavodil.near/near-fm.near/8722cb2086b60830d12fdc132a6bdb494089ece6469eb02c063a4d2ae7c1600d.mp3".into(),
                mime: Some("audio/mpeg".into()),
                duration: Some(233),
            }
        );
    }

    #[test]
    fn hidden_deleted_and_bad_songs() {
        let hidden = RESPONSE.replace(r#""is_hidden":false"#, r#""is_hidden":true"#);
        assert_eq!(to_preview(song(&hidden), UUID, GATEWAY).preview, Preview::Unavailable);
        let deleted = RESPONSE.replace(r#""is_deleted":false"#, r#""is_deleted":true"#);
        assert_eq!(to_preview(song(&deleted), UUID, GATEWAY).preview, Preview::Unavailable);
        let off_gateway = RESPONSE.replace("https://main.fastfs.io/zavodil.near/near-fm.near/8722", "https://evil.example/8722");
        assert_eq!(to_preview(song(&off_gateway), UUID, GATEWAY).preview, Preview::Nothing);
    }

    #[test]
    fn artist_falls_back_to_the_account() {
        let json = RESPONSE.replace(r#""uploader_display_name":"Vadim""#, r#""uploader_display_name":null"#);
        let Preview::NearFm { artist, .. } = to_preview(song(&json), UUID, GATEWAY).preview else {
            panic!("expected a song");
        };
        assert_eq!(artist, "zavodil.near");
    }
}
