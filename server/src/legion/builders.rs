//! NearBuilders members (docs/LEGION.md §4.3): the accounts with an active builder profile on
//! nearbuilders.org, read from its public API (`GET {base}/v1/builders`, paged by `?cursor=`) and
//! refreshed every ten minutes. It's an off-chain list: this server trusts that API for who is a
//! builder. A failed refresh keeps the last good list.

use anyhow::{bail, Context, Result};
use parking_lot::RwLock;
use rustc_hash::FxHashSet;
use serde_json::Value;
use std::future::Future;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

const PROJECT_ID: &str = "builders";
const DEFAULT_API: &str = "https://nearbuilders.org/api";
const REFRESH: Duration = Duration::from_secs(600);
/// Pages read per refresh at most, in case the API never says it's done.
const MAX_PAGES: usize = 1000;

pub type Members = Arc<FxHashSet<String>>;

static MEMBERS: LazyLock<RwLock<Members>> = LazyLock::new(Default::default);

/// The current members (cheap: shares the set).
pub fn members() -> Members {
    MEMBERS.read().clone()
}

/// One page of `GET /v1/builders`: its active members (`withdrawnAt` null) and the next cursor.
pub fn parse_page(page: &Value) -> Result<(Vec<String>, Option<String>)> {
    let Some(data) = page.get("data").and_then(Value::as_array) else {
        bail!("no `data` array");
    };
    let members = data
        .iter()
        .filter(|b| b.get("withdrawnAt").is_some_and(Value::is_null))
        .filter_map(|b| b.get("nearAccount")?.as_str())
        .map(str::to_string)
        .collect();
    let meta = page.get("meta");
    let more = meta.and_then(|m| m.get("hasMore")).and_then(Value::as_bool).unwrap_or(false);
    let next = meta.and_then(|m| m.get("nextCursor")).and_then(|c| match c {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    });
    Ok((members, if more { next } else { None }))
}

/// Every member, page by page. `fetch` gets the cursor (`None` for the first page).
pub async fn fetch_all<F, Fut>(mut fetch: F) -> Result<FxHashSet<String>>
where
    F: FnMut(Option<String>) -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    let mut all = FxHashSet::default();
    let mut cursor = None;
    for _ in 0..MAX_PAGES {
        let (members, next) = parse_page(&fetch(cursor.take()).await?)?;
        all.extend(members);
        match next {
            Some(next) => cursor = Some(next),
            None => return Ok(all),
        }
    }
    bail!("more than {MAX_PAGES} pages")
}

/// Replaces `store` with a fresh list; on failure keeps the last good one and logs why.
pub async fn refresh<F, Fut>(store: &RwLock<Members>, fetch: F)
where
    F: FnMut(Option<String>) -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    match fetch_all(fetch).await {
        Ok(members) => {
            tracing::info!(target: PROJECT_ID, "{} builders", members.len());
            *store.write() = Arc::new(members);
        }
        Err(e) => tracing::warn!(target: PROJECT_ID, "Can't refresh builders, keeping {}: {e:#}", store.read().len()),
    }
}

/// Starts the refresh loop against `NEARBUILDERS_API` (default `https://nearbuilders.org/api`).
pub fn spawn() {
    let base = std::env::var("NEARBUILDERS_API").ok().filter(|v| !v.trim().is_empty());
    let url = format!("{}/v1/builders", base.as_deref().unwrap_or(DEFAULT_API).trim_end_matches('/'));
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).build().expect("reqwest client");
    tokio::spawn(async move {
        loop {
            refresh(&MEMBERS, |cursor| {
                let mut request = client.get(&url);
                if let Some(cursor) = cursor {
                    request = request.query(&[("cursor", cursor)]);
                }
                async move {
                    // Errors drop the URL, so a log line never carries the query.
                    let response = request.send().await.map_err(reqwest::Error::without_url)?;
                    let response = response.error_for_status().map_err(reqwest::Error::without_url)?;
                    response.json::<Value>().await.map_err(reqwest::Error::without_url).context("builders page")
                }
            })
            .await;
            tokio::time::sleep(REFRESH).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn page(members: &[(&str, bool)], next: Option<&str>) -> Value {
        let data: Vec<Value> = members
            .iter()
            .map(|(account, withdrawn)| {
                json!({ "nearAccount": account, "withdrawnAt": if *withdrawn { json!("2026-10-01T00:00:00Z") } else { Value::Null } })
            })
            .collect();
        json!({ "data": data, "meta": { "hasMore": next.is_some(), "nextCursor": next } })
    }

    #[tokio::test]
    async fn pages_through_and_skips_withdrawn_builders() {
        let pages = [
            page(&[("a.near", false), ("gone.near", true)], Some("24")),
            page(&[("b.tg", false)], None),
        ];
        let mut asked = vec![];
        let members = fetch_all(|cursor| {
            asked.push(cursor.clone());
            let page = pages[asked.len() - 1].clone();
            async move { Ok(page) }
        })
        .await
        .unwrap();
        assert_eq!(asked, [None, Some("24".to_string())]);
        let mut members: Vec<_> = members.into_iter().collect();
        members.sort();
        assert_eq!(members, ["a.near", "b.tg"]);
    }

    #[test]
    fn a_numeric_cursor_is_read_and_a_last_page_has_none() {
        let mut p = page(&[], None);
        p["meta"] = json!({ "hasMore": true, "nextCursor": 48 });
        assert_eq!(parse_page(&p).unwrap().1.as_deref(), Some("48"));
        p["meta"] = json!({ "hasMore": false, "nextCursor": 72 });
        assert_eq!(parse_page(&p).unwrap().1, None);
        assert!(parse_page(&json!({ "error": "bad" })).is_err());
    }

    #[tokio::test]
    async fn a_failed_refresh_keeps_the_last_good_list() {
        let store = RwLock::new(Members::default());
        refresh(&store, |_| async { Ok(page(&[("a.near", false)], None)) }).await;
        assert!(store.read().contains("a.near"));
        // A failure halfway through the pages changes nothing.
        let mut n = 0;
        refresh(&store, |_| {
            n += 1;
            let first = n == 1;
            async move {
                if first {
                    Ok(page(&[("b.near", false)], Some("1")))
                } else {
                    bail!("timed out")
                }
            }
        })
        .await;
        assert!(store.read().contains("a.near"));
        assert!(!store.read().contains("b.near"));
        // A good refresh replaces it.
        refresh(&store, |_| async { Ok(page(&[("b.near", false)], None)) }).await;
        assert!(!store.read().contains("a.near"));
        assert!(store.read().contains("b.near"));
    }
}
