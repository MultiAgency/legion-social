use super::*;
use crate::ingest::fastdata::{parse_action, LogBlock};
use crate::legion::feeds::channel_action;
use crate::legion::{Check, Rank};
use serde_json::{json, Value};

const T0: u64 = 1_759_140_000_000;

/// One block of `(author, receiver, args)`; `None` is `social`.
fn block(height: u64, actions: Vec<(&str, Option<&str>, Value)>) -> LogBlock {
    LogBlock {
        b: height,
        t: (T0 + height * 1000) * 1_000_000,
        a: actions
            .into_iter()
            .enumerate()
            .filter_map(|(i, (author, receiver, args))| {
                let action = parse_action(i as u64, Some(format!("tx{height}-{i}")), author.into(), &serde_json::to_vec(&args).unwrap());
                match receiver {
                    None => Some(action),
                    Some(r) => channel_action(action, r),
                }
            })
            .collect(),
    }
}

fn texts(state: &State, entries: Vec<FeedEntry>) -> Vec<String> {
    entries.into_iter().map(|e| state.post(e.pid()).body.as_ref().unwrap().text.to_string()).collect()
}

fn member(state: &mut State, name: &str) {
    let aid = state.aid(name).unwrap();
    state.record_check(aid, Check { rank: Some(Rank::Initiate), checked_ms: 0 });
}

fn legion_state(blocks: Vec<LogBlock>) -> State {
    let mut state = State::new();
    state.enable_legion();
    for b in blocks {
        state.apply_block(&b);
    }
    state
}

#[test]
fn the_legion_feed_is_members_posts_to_legion_or_tagged_legion() {
    let mut state = legion_state(vec![
        block(1, vec![("m.near", Some("legion"), json!({"post/1": {"text": "members only"}}))]),
        block(2, vec![("m.near", None, json!({"post/2": {"text": "public #legion"}}))]),
        block(3, vec![("m.near", None, json!({"post/3": {"text": "plain"}}))]),
        block(4, vec![("x.near", Some("legion"), json!({"post/1": {"text": "outsider to legion"}}))]),
        block(5, vec![("x.near", None, json!({"post/2": {"text": "outsider #legion"}}))]),
        block(6, vec![("m.near", Some("other"), json!({"post/4": {"text": "other feed #legion"}}))]),
        block(7, vec![("m.near", Some("legion"), json!({"post/5": {"text": "reply", "reply_to": "m.near/1"}}))]),
    ]);
    member(&mut state, "m.near");
    assert_eq!(texts(&state, state.feed_legion(None, None, 10)), ["public #legion", "members only"]);
    // Everyone shows everyone, members or not, but never Legion-only posts.
    let global = texts(&state, state.feed_global(None, 10));
    assert!(global.contains(&"outsider #legion".to_string()));
    assert!(!global.contains(&"members only".to_string()));
}

#[test]
fn the_tag_param_scopes_a_feed() {
    let mut state = legion_state(vec![
        block(1, vec![("m.near", Some("legion"), json!({"post/1": {"text": "meetup #city"}}))]),
        block(2, vec![("m.near", None, json!({"post/2": {"text": "#legion #city"}}))]),
        block(3, vec![("m.near", None, json!({"post/3": {"text": "#legion only"}}))]),
    ]);
    member(&mut state, "m.near");
    assert_eq!(texts(&state, state.feed_legion(Some("city"), None, 10)), ["#legion #city", "meetup #city"]);
    assert!(state.feed_legion(Some("nothing"), None, 10).is_empty());
}

#[test]
fn a_name_feed_matches_the_suffix_only() {
    let state = legion_state(vec![block(
        1,
        vec![
            ("x.agency", None, json!({"post/1": {"text": "x.agency"}})),
            ("xagency.near", None, json!({"post/1": {"text": "xagency.near"}})),
            ("agency", None, json!({"post/1": {"text": "agency"}})),
            ("deep.x.agency", None, json!({"post/1": {"text": "deep.x.agency"}})),
            ("y.agency", Some("legion"), json!({"post/1": {"text": "legion only"}})),
            ("z.agency", None, json!({"post/2": {"text": "reply", "reply_to": "x.agency/1"}})),
        ],
    )]);
    assert_eq!(texts(&state, state.feed_names("agency", None, None, 10)), ["deep.x.agency", "x.agency"]);
    assert!(is_name_suffix("agency") && is_name_suffix("tg") && is_name_suffix("a-b_c"));
    for bad in ["", "a", "Agency", "a.b", "-ab", "ab-", "a--b", "a b"] {
        assert!(!is_name_suffix(bad), "{bad}");
    }
}

#[test]
fn the_builders_feed_is_members_social_posts() {
    let state = legion_state(vec![block(
        1,
        vec![
            ("b.near", None, json!({"post/1": {"text": "builder"}})),
            ("n.near", None, json!({"post/1": {"text": "not a builder"}})),
            ("b.near", Some("legion"), json!({"post/2": {"text": "legion only"}})),
        ],
    )]);
    let members: builders::Members = std::sync::Arc::new(["b.near".to_string()].into_iter().collect());
    assert_eq!(texts(&state, state.feed_builders(&members, None, None, 10)), ["builder"]);
    assert!(state.feed_builders(&Default::default(), None, None, 10).is_empty());
}

#[test]
fn feeds_page_newest_first() {
    let state = legion_state(
        (1..=5u64)
            .map(|i| block(i, vec![("x.agency", None, json!({ format!("post/{i}"): {"text": format!("p{i}")} }))]))
            .collect(),
    );
    let first = state.feed_names("agency", None, None, 2);
    assert_eq!(texts(&state, first.clone()), ["p5", "p4"]);
    let second = state.feed_names("agency", None, Some(first[1].seq()), 2);
    assert_eq!(texts(&state, second.clone()), ["p3", "p2"]);
    let last = state.feed_names("agency", None, Some(second[1].seq()), 2);
    assert_eq!(texts(&state, last), ["p1"]);
}

#[test]
fn a_tag_query_is_normalized() {
    let q = |tag: &str| TagQuery { tag: Some(tag.into()) }.tag();
    assert_eq!(q("#City").as_deref(), Some("city"));
    assert_eq!(q("  legion "), Some("legion".into()));
    assert_eq!(q("#"), None);
    assert_eq!(TagQuery { tag: None }.tag(), None);
}

#[test]
fn a_non_members_post_to_legion_appears_nowhere() {
    use crate::api::dto::Ctx;
    use crate::state::query::ProfileTab;
    let mut state = legion_state(vec![
        block(1, vec![("m.near", Some("legion"), json!({"post/1": {"text": "member #city"}}))]),
        block(2, vec![("x.near", Some("legion"), json!({"post/1": {"text": "outsider #city"}}))]),
        block(3, vec![("x.near", None, json!({"post/2": {"text": "outsider on social"}}))]),
    ]);
    member(&mut state, "m.near");
    let x = state.aid("x.near").unwrap();
    let hidden = state.pid_by_key[&crate::state::PostKey { author: x, id: 1 }];
    assert!(!state.is_visible(hidden));
    assert_eq!(texts(&state, state.feed_channel(LEGION_FEED, None, 10)), ["member #city"]);
    assert_eq!(texts(&state, state.feed_hashtag(LEGION_FEED, "city", None, 10)), ["member #city"]);
    assert_eq!(texts(&state, state.feed_legion(None, None, 10)), ["member #city"]);
    assert_eq!(texts(&state, state.account_feed(x, ProfileTab::Posts, None, 10)), ["outsider on social"]);
    assert_eq!(texts(&state, state.search_posts("outsider", None, 10)), ["outsider on social"]);
    let ctx = Ctx { state: &state, viewer: None, gateway: "", site_hosts: &[], unfurl: None };
    assert!(ctx.post(hidden, true).is_none());
    // Its feed shows only the member's post, so the account has a feed; with no member posts, none.
    assert!(state.has_feed(LEGION_FEED));
    let only_outsider = legion_state(vec![block(1, vec![("x.near", Some("legion"), json!({"post/1": {"text": "hi"}}))])]);
    assert!(!only_outsider.has_feed(LEGION_FEED));
    // Once the account becomes a member, its post shows.
    member(&mut state, "x.near");
    assert!(state.is_visible(hidden));
}
