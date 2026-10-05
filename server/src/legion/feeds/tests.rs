use super::*;
use crate::ingest::fastdata::{parse_action, LogBlock};
use serde_json::{json, Value};

const T0: u64 = 1_759_140_000_000;

/// One block of actions, each `(author, receiver, args)`; `None` is `social`. Goes through the
/// same filter the tailer applies, so dropped actions never reach the state.
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

/// A state with Legion on, where feeds are read.
fn legion_state() -> State {
    let mut state = State::new();
    state.enable_legion();
    state
}

/// Applies a block, then makes every account a member, so membership doesn't hide anything here.
fn apply(state: &mut State, block: LogBlock) {
    state.apply_block(&block);
    let aids: Vec<crate::state::Aid> = state.aid_by_name.values().copied().collect();
    for aid in aids {
        state.record_check(aid, crate::legion::Check { rank: Some(crate::legion::Rank::Initiate), checked_ms: 0 });
    }
}

fn texts(state: &State, entries: Vec<FeedEntry>) -> Vec<String> {
    entries
        .into_iter()
        .map(|e| state.post(e.pid()).body.as_ref().unwrap().text.to_string())
        .collect()
}

fn pid(state: &State, author: &str, id: u64) -> Pid {
    state.pid_by_key[&PostKey { author: state.aid(author).unwrap(), id }]
}

fn text(state: &State, author: &str, id: u64) -> Option<String> {
    state.post(pid(state, author, id)).body.as_ref().map(|b| b.text.to_string())
}

#[test]
fn channel_post_is_indexed_with_its_channel() {
    let mut state = legion_state();
    apply(&mut state, block(1, vec![("a.near", Some("guild.near"), json!({"post/1": {"text": "in guild"}}))]));
    let p = pid(&state, "a.near", 1);
    assert_eq!(state.channel_of(p), Some("guild.near"));
    assert!(!state.on_social(p));
    assert_eq!(texts(&state, state.feed_channel("guild.near", None, 10)), vec!["in guild"]);
    assert!(state.feed_channel("other.near", None, 10).is_empty());
}

#[test]
fn only_post_keys_count_in_a_channel() {
    let mut state = legion_state();
    apply(&mut state, block(
        1,
        vec![
            ("a.near", Some("guild.near"), json!({"profile/name": "A", "graph/follow/b.near": {}, "apps": {"x": 1}})),
            ("a.near", Some("guild.near"), json!({"post/1": {"text": "kept"}, "like/b.near/1": {}})),
        ],
    ));
    // The first action had nothing a channel keeps, so it never reached the log.
    let txs: Vec<_> = state.txs.keys().map(|k| k.to_string()).collect();
    assert_eq!(txs, vec!["tx1-1".to_string()]);
    let a = state.aid("a.near").unwrap();
    assert!(state.account(a).profile.name.is_none());
    assert!(state.account(a).following.is_empty());
    assert_eq!(text(&state, "a.near", 1).as_deref(), Some("kept"));
    assert!(state.aid("b.near").is_none());
}

#[test]
fn first_write_fixes_the_channel() {
    let mut state = legion_state();
    apply(&mut state, block(1, vec![("a.near", Some("guild.near"), json!({"post/1": {"text": "v1"}}))]));
    // The same key from social or another channel is ignored, edit or delete.
    apply(&mut state, block(
        2,
        vec![
            ("a.near", None, json!({"post/1": {"text": "from social"}})),
            ("a.near", Some("other.near"), json!({"post/1": null})),
        ],
    ));
    assert_eq!(text(&state, "a.near", 1).as_deref(), Some("v1"));
    assert_eq!(state.txs["tx2-0"].actions[0].keys[0].status, KeyStatus::Ignored);
    // An edit from its own channel applies, and so does a delete.
    apply(&mut state, block(3, vec![("a.near", Some("guild.near"), json!({"post/1": {"text": "v2"}}))]));
    assert_eq!(text(&state, "a.near", 1).as_deref(), Some("v2"));
    apply(&mut state, block(4, vec![("a.near", Some("guild.near"), json!({"post/1": null}))]));
    assert_eq!(text(&state, "a.near", 1), None);
    // A social post can't be moved into a channel either.
    apply(&mut state, block(5, vec![("b.near", None, json!({"post/7": {"text": "social"}}))]));
    apply(&mut state, block(6, vec![("b.near", Some("guild.near"), json!({"post/7": {"text": "moved"}}))]));
    assert_eq!(text(&state, "b.near", 7).as_deref(), Some("social"));
    assert!(state.on_social(pid(&state, "b.near", 7)));
}

#[test]
fn global_and_for_you_stay_on_social() {
    let mut state = legion_state();
    apply(&mut state, block(
        1,
        vec![
            ("a.near", None, json!({"post/1": {"text": "social"}})),
            ("a.near", Some("guild.near"), json!({"post/2": {"text": "guild"}})),
        ],
    ));
    assert_eq!(texts(&state, state.feed_global(None, 10)), vec!["social"]);
    let pool = state.ranked_posts(T0 + 10_000, 86_400_000, 10);
    let (items, _) = state.feed_for_you(None, Default::default(), 10, &pool);
    assert_eq!(texts(&state, items.into_iter().map(|(e, _)| e).collect()), vec!["social"]);
    // The author's profile shows both.
    let a = state.aid("a.near").unwrap();
    let profile = state.account_feed(a, crate::state::query::ProfileTab::Posts, None, 10);
    assert_eq!(texts(&state, profile), vec!["guild", "social"]);
}

#[test]
fn channel_feed_pages_newest_first_and_hides_the_denylisted() {
    let mut state = legion_state();
    for i in 1..=3u64 {
        apply(&mut state, block(i, vec![("a.near", Some("guild.near"), json!({ format!("post/{i}"): {"text": format!("p{i}")} }))]));
    }
    apply(&mut state, block(4, vec![("spam.near", Some("guild.near"), json!({"post/1": {"text": "spam"}}))]));
    state.set_hidden(&["spam.near".to_string()]);
    let first = state.feed_channel("guild.near", None, 2);
    assert_eq!(texts(&state, first.clone()), vec!["p3", "p2"]);
    let rest = state.feed_channel("guild.near", Some(first[1].seq()), 2);
    assert_eq!(texts(&state, rest), vec!["p1"]);
}

#[test]
fn a_log_line_without_a_channel_replays_as_social() {
    let line = r#"{"b":1,"t":1759140001000000000,"a":[{"o":0,"p":"a.near","s":"ok","r":[["post/1","{\"text\":\"old\"}"]]}]}"#;
    let block: LogBlock = serde_json::from_str(line).unwrap();
    assert_eq!(block.a[0].c, None);
    // And a social action serializes exactly as before: no `c`.
    assert_eq!(serde_json::to_string(&block).unwrap(), line);
    let mut state = State::new();
    state.apply_block(&block);
    assert!(state.on_social(pid(&state, "a.near", 1)));
    assert_eq!(texts(&state, state.feed_global(None, 10)), vec!["old"]);
}

#[test]
fn without_channel_writes_nothing_changes() {
    let social = [
        ("a.near", json!({"post/1": {"text": "one"}, "profile/name": "A"})),
        ("b.near", json!({"post/2": {"text": "two", "reply_to": "a.near/1"}, "like/a.near/1": {}})),
    ];
    let mut plain = State::new();
    let mut routed = State::new();
    let actions: Vec<_> = social
        .iter()
        .enumerate()
        .map(|(i, (author, args))| parse_action(i as u64, None, author.to_string(), &serde_json::to_vec(args).unwrap()))
        .collect();
    let raw = LogBlock { b: 1, t: T0 * 1_000_000, a: actions };
    // `plain` skips the channel router; `routed` goes through it.
    let ms = raw.timestamp_ms();
    let mut fx = BlockEffects::default();
    let mut row = 0;
    for action in &raw.a {
        for (key, value) in &action.r {
            plain.apply_row(crate::state::make_seq(raw.b, row), ms, &action.p, key, value, &mut fx);
            row += 1;
        }
    }
    routed.apply_block(&raw);
    assert_eq!(texts(&plain, plain.feed_global(None, 10)), texts(&routed, routed.feed_global(None, 10)));
    let a = plain.aid("a.near").unwrap();
    assert_eq!(plain.post_counts(pid(&plain, "a.near", 1)), routed.post_counts(pid(&routed, "a.near", 1)));
    assert_eq!(plain.account(a).profile.name, routed.account(routed.aid("a.near").unwrap()).profile.name);
}

#[test]
fn hashtags_are_scoped_to_one_feed() {
    let mut state = legion_state();
    apply(&mut state, block(
        1,
        vec![
            ("a.near", None, json!({"post/1": {"text": "social #near"}})),
            ("a.near", Some("legion.near"), json!({"post/2": {"text": "legion #near"}})),
            ("b.near", Some("other.near"), json!({"post/3": {"text": "other #near"}})),
        ],
    ));
    // No feed: social only, as before channels.
    assert_eq!(texts(&state, state.hashtag_feed("near", None, 10)), vec!["social #near"]);
    assert_eq!(texts(&state, state.feed_hashtag("legion.near", "near", None, 10)), vec!["legion #near"]);
    assert_eq!(texts(&state, state.feed_hashtag("other.near", "near", None, 10)), vec!["other #near"]);
    assert!(state.feed_hashtag("nobody.near", "near", None, 10).is_empty());
}

#[test]
fn trending_counts_social_only() {
    let mut state = legion_state();
    apply(&mut state, block(
        1,
        vec![
            ("a.near", None, json!({"post/1": {"text": "#near"}})),
            ("a.near", Some("legion.near"), json!({"post/2": {"text": "#near #legion"}})),
        ],
    ));
    let top = state.trending(T0 + 10_000, 86_400_000, 10);
    assert_eq!(top, vec![("near".to_string(), 1)]);
}

fn failed(kind: ActionErrorKind) -> ExecutionStatusView {
    use fastnear_primitives::near_primitives::errors::ActionError;
    ExecutionStatusView::Failure(TxExecutionError::ActionError(ActionError { index: Some(0), kind }))
}

fn missing(account: &str) -> ExecutionStatusView {
    failed(ActionErrorKind::AccountDoesNotExist { account_id: account.parse().unwrap() })
}

#[test]
fn only_an_unclaimed_receiver_is_a_feed() {
    // `legion` doesn't exist: its receipts fail with AccountDoesNotExist.
    assert_eq!(classify(true, "social", "legion", &missing("legion")), Receiver::Feed("legion".into()));
    // `social` is read as upstream does, whatever its outcome.
    assert_eq!(classify(true, "social", "social", &missing("social")), Receiver::Social);
    assert_eq!(classify(false, "social", "social", &ExecutionStatusView::SuccessValue(vec![])), Receiver::Social);
    // Existing receivers are other apps': no contract, a missing method, a success.
    let no_code = failed(ActionErrorKind::FunctionCallError(
        fastnear_primitives::near_primitives::errors::FunctionCallError::CompilationError(
            fastnear_primitives::near_primitives::errors::CompilationError::CodeDoesNotExist {
                account_id: "app.near".parse().unwrap(),
            },
        ),
    ));
    let no_method = failed(ActionErrorKind::FunctionCallError(
        fastnear_primitives::near_primitives::errors::FunctionCallError::MethodResolveError(
            fastnear_primitives::near_primitives::errors::MethodResolveError::MethodNotFound,
        ),
    ));
    for status in [no_code, no_method, ExecutionStatusView::SuccessValue(vec![]), ExecutionStatusView::Unknown] {
        assert_eq!(classify(true, "social", "app.near", &status), Receiver::Other);
    }
    // AccountDoesNotExist for some other account isn't this receiver's.
    assert_eq!(classify(true, "social", "app.near", &missing("other.near")), Receiver::Other);
}

#[test]
fn writes_to_existing_receivers_never_reach_the_state() {
    // What the tailer does: an `Other` receipt is skipped before parsing, so it neither fixes a
    // post's feed nor counts toward its author's quota.
    let mut state = legion_state();
    let writes = [
        ("app.near", failed(ActionErrorKind::AccountAlreadyExists { account_id: "app.near".parse().unwrap() })),
        ("legion", missing("legion")),
    ];
    let mut actions = vec![];
    for (i, (receiver, status)) in writes.iter().enumerate() {
        let args = json!({ "post/1": {"text": format!("to {receiver}")} });
        let action = parse_action(i as u64, Some(format!("tx-{i}")), "a.near".into(), &serde_json::to_vec(&args).unwrap());
        if let Receiver::Feed(feed) = classify(true, "social", receiver, status) {
            actions.extend(channel_action(action, &feed));
        }
    }
    apply(&mut state, LogBlock { b: 1, t: T0 * 1_000_000, a: actions });
    assert_eq!(text(&state, "a.near", 1).as_deref(), Some("to legion"));
    assert_eq!(state.channel_of(pid(&state, "a.near", 1)), Some("legion"));
    assert_eq!(state.counts.posts, 1);
    assert!(!state.txs.contains_key("tx-0"));
}

#[test]
fn legion_off_reads_social_only_and_matches_upstream() {
    // Feeds are off: an unclaimed receiver is skipped like any other.
    assert_eq!(classify(false, "social", "legion", &missing("legion")), Receiver::Other);
    // So only social writes reach the state, and every read is upstream's.
    let mut state = State::new();
    assert!(state.legion.is_none());
    state.apply_block(&block(
        1,
        vec![
            ("a.near", None, json!({"post/1": {"text": "hello #near"}})),
            ("b.near", None, json!({"post/2": {"text": "reply #near", "reply_to": "a.near/1"}})),
        ],
    ));
    let p = pid(&state, "a.near", 1);
    assert_eq!(state.channel_of(p), None);
    assert!(state.on_social(p));
    assert_eq!(texts(&state, state.feed_global(None, 10)), vec!["hello #near"]);
    assert_eq!(texts(&state, state.hashtag_feed("near", None, 10)), vec!["reply #near", "hello #near"]);
    assert_eq!(state.trending(T0 + 10_000, 86_400_000, 10), vec![("near".to_string(), 2)]);
    assert!(state.feed_channel("legion", None, 10).is_empty());
}

/// What the API answers about this state: profiles, a thread, global, search, hashtags, status.
fn api_view(state: &State) -> Value {
    use crate::api::dto::Ctx;
    let ctx = Ctx { state, viewer: None, gateway: "https://gw", site_hosts: &[], unfurl: None };
    let profile = |name: &'static str| serde_json::to_value(ctx.profile(name, state.aid(name))).unwrap();
    let root = pid(state, "a.near", 1);
    json!({
        "a": profile("a.near"),
        "b": profile("b.near"),
        "root": serde_json::to_value(ctx.post(root, true)).unwrap(),
        "replies": serde_json::to_value(ctx.feed(&state.post_replies(root, 0, 100).0)).unwrap(),
        "global": serde_json::to_value(ctx.feed(&state.feed_global(None, 100))).unwrap(),
        "b_posts": serde_json::to_value(ctx.feed(&state.account_feed(state.aid("b.near").unwrap(), crate::state::query::ProfileTab::Posts, None, 100))).unwrap(),
        "b_replies": serde_json::to_value(ctx.feed(&state.account_feed(state.aid("b.near").unwrap(), crate::state::query::ProfileTab::Replies, None, 100))).unwrap(),
        "search": serde_json::to_value(ctx.feed(&state.search_posts("legion", None, 100))).unwrap(),
        "tag": serde_json::to_value(ctx.feed(&state.hashtag_feed("near", None, 100))).unwrap(),
        "counts": serde_json::to_value(state.counts).unwrap(),
    })
}

#[test]
fn a_log_with_feed_rows_replays_as_upstream_with_legion_off() {
    let social = vec![
        ("a.near", None, json!({"post/1": {"text": "root #near"}, "profile/name": "A"})),
        ("b.near", None, json!({"profile/name": "B"})),
    ];
    let feed = vec![
        ("b.near", Some("legion"), json!({"post/2": {"text": "legion reply #near", "reply_to": "a.near/1"}})),
        ("b.near", Some("legion"), json!({"post/3": {"text": "legion post #near", "quote": "a.near/1"}})),
    ];
    // The log as it was written with Legion on: one social block, one feed block.
    let mut with_feed = State::new();
    with_feed.apply_block(&block(1, social.clone()));
    with_feed.apply_block(&block(2, feed));
    // Upstream never saw the feed block.
    let mut upstream = State::new();
    upstream.apply_block(&block(1, social));
    upstream.apply_block(&block(2, vec![]));
    assert!(with_feed.legion.is_none());
    assert_eq!(api_view(&with_feed), api_view(&upstream));
    // No answer mentions a feed.
    assert!(!api_view(&with_feed).to_string().contains("channel"));
}

#[test]
fn a_block_mixing_feed_and_social_actions_replays_as_upstream_with_legion_off() {
    let first = vec![("a.near", None, json!({"post/1": {"text": "root"}}))];
    // The feed action comes first in its block: with Legion off it must take no row slot.
    let mixed = vec![
        ("b.near", Some("legion"), json!({"post/2": {"text": "legion post"}})),
        ("b.near", None, json!({"post/3": {"text": "social post", "reply_to": "a.near/1"}})),
    ];
    let mut with_feed = State::new();
    with_feed.apply_block(&block(1, first.clone()));
    let fx = with_feed.apply_block(&block(2, mixed));
    let mut upstream = State::new();
    upstream.apply_block(&block(1, first));
    upstream.apply_block(&block(2, vec![("b.near", None, json!({"post/3": {"text": "social post", "reply_to": "a.near/1"}}))]));
    assert_eq!(api_view(&with_feed), api_view(&upstream));
    // The skipped feed action gets no /v1/tx report.
    assert_eq!(fx.tx_hashes, vec!["tx2-1".to_string()]);
}

#[test]
fn a_feed_action_reads_as_empty_to_a_build_without_feeds() {
    let b = block(1, vec![("a.near", Some("legion"), json!({"post/1": {"text": "legion only"}}))]);
    let line = serde_json::to_value(&b).unwrap();
    let action = &line["a"][0];
    // Its rows live under `c`, never in `r`.
    assert!(action.get("r").is_none());
    assert_eq!(action["c"]["f"], "legion");
    assert_eq!(action["c"]["r"][0][0], "post/1");
    // A build that doesn't know `c` (upstream, or before feeds) ignores it and applies nothing.
    let mut old = line.clone();
    old["a"][0].as_object_mut().unwrap().remove("c");
    let old: LogBlock = serde_json::from_value(old).unwrap();
    let mut state = legion_state();
    state.apply_block(&old);
    assert_eq!(state.counts.posts, 0);
    // This build replays it as the Legion-only post it is.
    let mut state = legion_state();
    apply(&mut state, serde_json::from_value(line).unwrap());
    assert_eq!(state.channel_of(pid(&state, "a.near", 1)), Some("legion"));
}

#[test]
fn the_channel_param_is_ignored_with_legion_off() {
    let social = vec![("a.near", None, json!({"post/1": {"text": "#near"}}))];
    let legion_channel = FeedQuery { channel: Some("legion".into()) };
    let bad_channel = FeedQuery { channel: Some("not an account".into()) };
    // Off: upstream's list, whatever the parameter says.
    let mut off = State::new();
    off.apply_block(&block(1, social.clone()));
    assert_eq!(texts(&off, legion_channel.hashtag(&off, "near", None, 10).unwrap()), vec!["#near"]);
    assert_eq!(texts(&off, bad_channel.hashtag(&off, "near", None, 10).unwrap()), vec!["#near"]);
    // On: the feed's list, and a bad account is an error.
    let mut on = legion_state();
    apply(&mut on, block(1, social));
    assert!(legion_channel.hashtag(&on, "near", None, 10).unwrap().is_empty());
    assert!(bad_channel.hashtag(&on, "near", None, 10).is_err());
}

#[test]
fn profiles_say_whether_an_account_has_a_feed() {
    use crate::api::dto::Ctx;
    let mut state = legion_state();
    apply(&mut state, block(1, vec![("a.near", Some("legion"), json!({"post/1": {"text": "hi"}}))]));
    let ctx = Ctx { state: &state, viewer: None, gateway: "https://gw", site_hosts: &[], unfurl: None };
    let feed = serde_json::to_value(ctx.profile("legion", state.aid("legion"))).unwrap();
    assert_eq!(feed["has_feed"], true);
    // Absent, not false, on every other profile.
    let author = serde_json::to_value(ctx.profile("a.near", state.aid("a.near"))).unwrap();
    assert!(author.get("has_feed").is_none());
    // With Legion off there are no feeds at all.
    let mut off = State::new();
    off.apply_block(&block(1, vec![("a.near", None, json!({"post/1": {"text": "hi"}}))]));
    assert!(!off.has_feed("legion"));
}

#[test]
fn a_feed_of_only_hidden_posts_has_no_feed() {
    let mut state = legion_state();
    apply(&mut state, block(1, vec![("spam.near", Some("legion"), json!({"post/1": {"text": "spam"}}))]));
    assert!(state.has_feed("legion"));
    // Denylisted: the feed would show nothing, so the profile says there's no feed.
    state.set_hidden(&["spam.near".to_string()]);
    assert!(!state.has_feed("legion"));
    // Not a member: the same.
    let mut state = legion_state();
    state.apply_block(&block(1, vec![("outsider.near", Some("legion"), json!({"post/1": {"text": "hi"}}))]));
    assert!(state.feed_channel("legion", None, 10).is_empty());
    assert!(!state.has_feed("legion"));
}
