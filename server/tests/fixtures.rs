//! Runs the shared test vectors in `docs/fixtures/*.json` through the FastData parse rules and
//! the state machine, and checks the expectations.

use near_social_server::ingest::fastdata::{parse_action, LogBlock};
use near_social_server::model::keys::parse_post_ref;
use near_social_server::state::query::{FeedEntry, ProfileTab};
use near_social_server::state::{seq_block_height, State};
use serde_json::{json, Value};
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docs/fixtures")
}

fn build_blocks(fixture: &Value) -> Vec<LogBlock> {
    fixture["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| LogBlock {
            b: b["height"].as_u64().unwrap(),
            t: b["time_ms"].as_u64().unwrap() * 1_000_000,
            a: b["actions"]
                .as_array()
                .unwrap()
                .iter()
                .enumerate()
                .map(|(i, a)| {
                    let args = match a.get("args_raw") {
                        Some(raw) => raw.as_str().unwrap().as_bytes().to_vec(),
                        None => serde_json::to_vec(&a["args"]).unwrap(),
                    };
                    parse_action(
                        i as u64,
                        a["tx"].as_str().map(String::from),
                        a["author"].as_str().unwrap().to_string(),
                        &args,
                    )
                })
                .collect(),
        })
        .collect()
}

fn pid(state: &State, key: &str) -> u32 {
    let (author, id) = parse_post_ref(key).unwrap_or_else(|| panic!("bad post key {key}"));
    state.pid(author, id).unwrap_or_else(|| panic!("unknown post {key}"))
}

fn aid(state: &State, name: &str) -> u32 {
    state.aid(name).unwrap_or_else(|| panic!("unknown account {name}"))
}

fn entry_str(state: &State, e: &FeedEntry) -> String {
    match *e {
        FeedEntry::Post { pid, .. } => format!("post:{}", state.post_key_string(pid)),
        FeedEntry::Repost { pid, by, .. } => {
            format!("repost:{}:{}", state.account(by).name, state.post_key_string(pid))
        }
    }
}

fn feed(state: &State, spec: &str) -> Vec<String> {
    let parts: Vec<&str> = spec.split(':').collect();
    let entries = match parts.as_slice() {
        ["global"] => state.feed_global(None, 100),
        ["following", a] => state.feed_following(aid(state, a), None, 100),
        ["hashtag", t] => state.hashtag_feed(t, None, None, 100),
        ["replies", k] => state.post_replies(pid(state, k), 0, 100).0,
        ["quotes", k] => state.post_quotes(pid(state, k), None, 100),
        ["likes", a] => state.account_likes(aid(state, a), None, 100),
        ["likers", k] => {
            return state
                .post_likers(pid(state, k), None, 100)
                .iter()
                .map(|&(_, a)| state.account(a).name.to_string())
                .collect()
        }
        ["account", a, tab] => {
            let tab = match *tab {
                "posts" => ProfileTab::Posts,
                "replies" => ProfileTab::Replies,
                "media" => ProfileTab::Media,
                other => panic!("unknown tab {other}"),
            };
            state.account_feed(aid(state, a), tab, None, 100)
        }
        _ => panic!("unknown feed spec {spec}"),
    };
    entries.iter().map(|e| entry_str(state, e)).collect()
}

fn check(name: &str, fixture: &Value, state: &State) {
    let expect = &fixture["expect"];
    let ctx = |what: &str| format!("[{name}] {what}");

    if let Some(c) = expect.get("counts") {
        let counts = serde_json::to_value(state.counts).unwrap();
        assert_eq!(&counts, c, "{}", ctx("counts"));
    }

    for (account, fields) in expect["profiles"].as_object().into_iter().flatten() {
        let p = &state.account(aid(state, account)).profile;
        let actual = json!({
            "name": p.name.as_deref(),
            "about": p.about.as_deref(),
            "avatar": p.avatar.as_deref(),
            "banner": p.banner.as_deref(),
            "location": p.location.as_deref(),
            "links": p.links.iter().map(|(k, v)| (k.to_string(), json!(&**v))).collect::<serde_json::Map<_, _>>(),
        });
        for (field, value) in fields.as_object().unwrap() {
            assert_eq!(&actual[field], value, "{}", ctx(&format!("profile {account}.{field}")));
        }
    }

    for (key, fields) in expect["posts"].as_object().into_iter().flatten() {
        let post = state.post(pid(state, key));
        let body = post.body.as_ref();
        let actual = json!({
            "live": post.is_live(),
            "text": body.map(|b| b.text.to_string()),
            "likes": post.likes,
            "reposts": post.reposts,
            "replies": post.replies,
            "quotes": post.quotes,
            "edited": post.edited_ms.is_some(),
            "created_block": post.created.map(|c| seq_block_height(c.0)),
            "reply_to": body.and_then(|b| b.reply_to).map(|p| state.post_key_string(p)),
        });
        for (field, value) in fields.as_object().unwrap() {
            assert_eq!(&actual[field], value, "{}", ctx(&format!("post {key}.{field}")));
        }
    }

    for (account, fields) in expect["follows"].as_object().into_iter().flatten() {
        let a = aid(state, account);
        let names = |list: Vec<(u64, u32)>| {
            let mut v: Vec<String> = list.iter().map(|&(_, x)| state.account(x).name.to_string()).collect();
            v.sort();
            json!(v)
        };
        assert_eq!(names(state.following(a, None, 1000)), fields["following"], "{}", ctx(&format!("{account} following")));
        assert_eq!(names(state.followers(a, None, 1000)), fields["followers"], "{}", ctx(&format!("{account} followers")));
    }

    for (spec, expected) in expect["feeds"].as_object().into_iter().flatten() {
        assert_eq!(json!(feed(state, spec)), *expected, "{}", ctx(&format!("feed {spec}")));
    }

    for (account, expected) in expect["notifications"].as_object().into_iter().flatten() {
        let groups = state.notifications(aid(state, account), None, 100);
        let actual: Vec<Value> = groups
            .iter()
            .map(|g| {
                json!([
                    g.kind,
                    g.actors.iter().map(|&a| state.account(a).name.to_string()).collect::<Vec<_>>(),
                    g.post.map(|p| state.post_key_string(p)),
                ])
            })
            .collect();
        assert_eq!(json!(actual), *expected, "{}", ctx(&format!("notifications {account}")));
    }

    for (tx, expected) in expect["tx"].as_object().into_iter().flatten() {
        let report = state.txs.get(tx.as_str()).unwrap_or_else(|| panic!("{}", ctx(&format!("missing tx {tx}"))));
        let actual: Vec<Value> = report
            .actions
            .iter()
            .map(|a| {
                json!({
                    "status": a.status,
                    "keys": a.keys.iter().map(|k| json!([&*k.key, k.status])).collect::<Vec<_>>(),
                })
            })
            .collect();
        assert_eq!(json!(actual), *expected, "{}", ctx(&format!("tx {tx}")));
    }
}

#[test]
fn fixtures() {
    let mut ran = 0;
    for entry in std::fs::read_dir(fixtures_dir()).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "json") || path.file_name().unwrap() == "text.json" {
            continue;
        }
        let name = path.file_stem().unwrap().to_string_lossy().to_string();
        let fixture: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let blocks = build_blocks(&fixture);

        let mut state = State::new();
        for block in &blocks {
            state.apply_block(block);
        }
        check(&name, &fixture, &state);

        // Replaying the same log must produce the same state (round-trip through JSON too).
        let mut replayed = State::new();
        for block in &blocks {
            let line = serde_json::to_string(block).unwrap();
            replayed.apply_block(&serde_json::from_str(&line).unwrap());
        }
        check(&format!("{name} (replayed)"), &fixture, &replayed);
        ran += 1;
    }
    assert!(ran >= 2, "expected fixtures in {}", fixtures_dir().display());
}

#[test]
fn text_vectors() {
    let path = fixtures_dir().join("text.json");
    let cases: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    for case in cases.as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let tokens = near_social_server::model::text::extract(text);
        assert_eq!(json!(tokens.mentions), case["mentions"], "mentions of {text:?}");
        assert_eq!(json!(tokens.hashtags), case["hashtags"], "hashtags of {text:?}");
        let urls: Vec<&str> = near_social_server::model::text::url_spans(text)
            .into_iter()
            .map(|(s, e)| &text[s..e])
            .collect();
        assert_eq!(json!(urls), case["urls"], "urls of {text:?}");
    }
}
