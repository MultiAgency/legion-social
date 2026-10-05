use super::*;
use crate::ingest::fastdata::{parse_action, LogBlock};
use crate::state::query::FeedEntry;

const T0: u64 = 1_759_140_000_000;

fn block(height: u64, actions: Vec<(&str, Value)>) -> LogBlock {
    LogBlock {
        b: height,
        t: (T0 + height) * 1_000_000,
        a: actions
            .into_iter()
            .enumerate()
            .map(|(i, (author, args))| {
                parse_action(i as u64, Some(format!("tx{height}-{i}")), author.into(), &serde_json::to_vec(&args).unwrap())
            })
            .collect(),
    }
}

/// alice.near, bob.near and carol.near each post once.
fn three_posts() -> State {
    let mut state = State::new();
    for (height, author) in [(1, "alice.near"), (2, "bob.near"), (3, "carol.near")] {
        state.apply_block(&block(height, vec![(author, json!({ "post/1": { "text": format!("hi from {author}") } }))]));
    }
    state
}

fn authors(state: &State) -> Vec<String> {
    let mut authors: Vec<String> = state
        .feed_global(None, 50)
        .iter()
        .map(|entry| match entry {
            FeedEntry::Post { pid, .. } => state.account(state.post(*pid).key.author).name.to_string(),
            FeedEntry::Repost { .. } => panic!("no reposts here"),
        })
        .collect();
    authors.sort();
    authors
}

fn check(state: &mut State, name: &str, rank: Option<Rank>, checked_ms: u64) {
    let aid = state.aid(name).unwrap();
    state.record_check(aid, Check { rank, checked_ms });
}

#[test]
fn settings_name_each_rank_once() {
    assert_eq!(
        parse_contracts("initiate=initiate.nearlegion.near, vanguard=vanguard.nearlegion.near").unwrap(),
        vec![(Rank::Initiate, "initiate.nearlegion.near".into()), (Rank::Vanguard, "vanguard.nearlegion.near".into())]
    );
    assert!(parse_contracts("initiate.nearlegion.near").is_err());
    assert!(parse_contracts("prime=prime.nearlegion.near").is_err());
    assert!(parse_contracts("initiate=Not An Account").is_err());
    assert!(parse_contracts("initiate=a.near,initiate=b.near").is_err());
    assert!(parse_contracts(" , ").is_err());
}

#[test]
fn rank_is_the_highest_held() {
    assert_eq!(highest([(Rank::Initiate, true), (Rank::Ascendant, true), (Rank::Vanguard, false)]), Some(Rank::Ascendant));
    assert_eq!(highest([(Rank::Initiate, false), (Rank::Vanguard, true)]), Some(Rank::Vanguard));
    assert_eq!(highest([(Rank::Initiate, false), (Rank::Ascendant, false)]), None);
}

#[test]
fn supply_is_read_from_the_rpc_result() {
    // nft_supply_for_owner on initiate.nearlegion.near, as rpc.mainnet.fastnear.com returns it.
    let bytes: Vec<u8> = b"\"1\"".to_vec();
    assert_eq!(parse_supply(&json!({ "result": { "result": bytes, "logs": [] } })).unwrap(), 1);
    let zero: Vec<u8> = b"\"0\"".to_vec();
    assert_eq!(parse_supply(&json!({ "result": { "result": zero } })).unwrap(), 0);
    // A failed view is an error to retry, never "holds nothing".
    assert!(parse_supply(&json!({ "result": { "error": "wasm execution failed" } })).is_err());
    assert!(parse_supply(&json!({ "error": { "name": "HANDLER_ERROR" } })).is_err());
}

#[test]
fn failed_batches_back_off_and_a_clean_one_resets() {
    assert_eq!(next_delay(TICK, false), TICK);
    assert_eq!(next_delay(TICK, true), TICK * 2);
    assert_eq!(next_delay(TICK * 2, true), TICK * 4);
    assert_eq!(next_delay(MAX_BACKOFF, true), MAX_BACKOFF);
    assert_eq!(next_delay(MAX_BACKOFF, false), TICK);
}

#[test]
fn legion_off_shows_everyone_like_upstream() {
    let state = three_posts();
    assert_eq!(authors(&state), ["alice.near", "bob.near", "carol.near"]);
    assert_eq!(state.rank(state.aid("alice.near").unwrap()), None);
}

#[test]
fn legion_on_shows_everyone_and_ranks_only_members() {
    let mut state = three_posts();
    state.enable_legion();
    assert_eq!(authors(&state), ["alice.near", "bob.near", "carol.near"], "membership hides nobody");
    check(&mut state, "alice.near", Some(Rank::Vanguard), T0);
    check(&mut state, "bob.near", None, T0);
    assert_eq!(authors(&state), ["alice.near", "bob.near", "carol.near"]);
    assert_eq!(state.rank(state.aid("alice.near").unwrap()), Some(Rank::Vanguard));
    assert_eq!(state.rank(state.aid("bob.near").unwrap()), None);
    assert_eq!(state.rank(state.aid("carol.near").unwrap()), None, "unchecked");
}

#[test]
fn a_recheck_ranks_a_new_member_and_unranks_a_revoked_one() {
    let mut state = three_posts();
    state.enable_legion();
    check(&mut state, "alice.near", Some(Rank::Initiate), T0);
    check(&mut state, "bob.near", None, T0);
    check(&mut state, "alice.near", None, T0 + 1);
    check(&mut state, "bob.near", Some(Rank::Ascendant), T0 + 1);
    assert_eq!(state.rank(state.aid("alice.near").unwrap()), None);
    assert_eq!(state.rank(state.aid("bob.near").unwrap()), Some(Rank::Ascendant));
}

#[test]
fn the_denylist_still_hides_a_member() {
    let mut state = three_posts();
    state.enable_legion();
    check(&mut state, "alice.near", Some(Rank::Initiate), T0);
    state.set_hidden(&["alice.near".into()]);
    assert_eq!(authors(&state), ["bob.near", "carol.near"]);
}

#[test]
fn unchecked_accounts_are_due_first_then_stale_ones() {
    let mut state = three_posts();
    state.enable_legion();
    check(&mut state, "alice.near", Some(Rank::Initiate), T0);
    check(&mut state, "bob.near", None, T0 + 100);
    let names = |due: Vec<(Aid, String)>| due.into_iter().map(|(_, name)| name).collect::<Vec<_>>();
    assert_eq!(names(state.legion_due(T0 + 50, 10)), ["carol.near", "alice.near"]);
    assert_eq!(names(state.legion_due(T0 + 50, 1)), ["carol.near"]);
    check(&mut state, "carol.near", None, T0 + 100);
    assert!(state.legion_due(T0, 10).is_empty(), "nothing is due before it goes stale");
    assert!(three_posts().legion_due(T0, 10).is_empty(), "nothing is due with Legion off");
}

#[test]
fn accounts_that_wrote_are_checked_before_accounts_only_followed() {
    let mut state = State::new();
    state.enable_legion();
    // followed.near is seen first, as a follow target, but never writes.
    state.apply_block(&block(1, vec![("fan.near", json!({ "graph/follow/followed.near": {} }))]));
    state.apply_block(&block(2, vec![("poster.near", json!({ "post/1": { "text": "hi" } }))]));
    let due: Vec<String> = state.legion_due(T0, 10).into_iter().map(|(_, name)| name).collect();
    assert_eq!(due, ["fan.near", "poster.near", "followed.near"]);
}

#[test]
fn an_accounts_last_check_is_read_back() {
    let mut state = three_posts();
    assert_eq!(state.legion_check(state.aid("alice.near").unwrap()), None, "Legion off");
    state.enable_legion();
    let alice = state.aid("alice.near").unwrap();
    assert_eq!(state.legion_check(alice), None, "not checked yet");
    check(&mut state, "alice.near", Some(Rank::Ascendant), T0);
    assert_eq!(state.legion_check(alice), Some(Check { rank: Some(Rank::Ascendant), checked_ms: T0 }));
    check(&mut state, "alice.near", None, T0 + 1);
    assert_eq!(state.legion_check(alice), Some(Check { rank: None, checked_ms: T0 + 1 }));
}

#[test]
fn live_checks_are_capped_per_minute() {
    let mut live = Live::default();
    for _ in 0..LIVE_PER_MINUTE {
        assert!(live.take(T0));
    }
    assert!(!live.take(T0 + 59_999), "the minute's budget is spent");
    assert!(live.take(T0 + 60_000), "a new minute starts a new budget");
}

#[test]
fn live_results_are_reused_until_stale_and_bounded() {
    let mut live = Live::default();
    live.remember("x.near".into(), Check { rank: None, checked_ms: T0 });
    assert_eq!(live.cached("x.near", T0), Some(Check { rank: None, checked_ms: T0 }));
    assert_eq!(live.cached("x.near", T0 + 1), None, "stale");
    assert_eq!(live.cached("y.near", 0), None);
    for i in 0..LIVE_CACHE_MAX {
        live.remember(format!("a{i}.near"), Check { rank: None, checked_ms: T0 });
    }
    assert!(live.results.len() <= LIVE_CACHE_MAX);
}

#[test]
fn a_snapshot_restores_checks_for_known_accounts_only() {
    let mut state = three_posts();
    state.enable_legion();
    check(&mut state, "alice.near", Some(Rank::Ascendant), T0);
    check(&mut state, "bob.near", None, T0);
    let mut snapshot = state.legion_snapshot();
    snapshot.insert("stranger.near".into(), Check { rank: Some(Rank::Vanguard), checked_ms: T0 });

    let dir = std::env::temp_dir().join(format!("legion-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    save_snapshot(&dir.join(SNAPSHOT_FILE), &snapshot).unwrap();

    let restored = RwLock::new(three_posts());
    start(&restored, &dir);
    let restored = restored.into_inner();
    std::fs::remove_dir_all(&dir).unwrap();

    assert_eq!(restored.rank(restored.aid("alice.near").unwrap()), Some(Rank::Ascendant));
    assert_eq!(restored.aid("stranger.near"), None, "restoring doesn't invent accounts");
    let due: Vec<String> = restored.legion_due(T0, 10).into_iter().map(|(_, name)| name).collect();
    assert_eq!(due, ["carol.near"]);
}

/// alice.near posts; member carol.near and non-member bob.near each follow alice, like, repost,
/// reply to and quote her post.
#[test]
fn a_non_members_profile_lists_and_counts_are_upstreams() {
    let mut state = State::new();
    state.apply_block(&block(1, vec![("alice.near", json!({ "post/1": { "text": "hi" } }))]));
    state.apply_block(&block(
        2,
        vec![("bob.near", json!({ "profile/name": "Bob", "graph/follow/alice.near": {}, "like/alice.near/1": {} }))],
    ));
    state.enable_legion();
    check(&mut state, "alice.near", Some(Rank::Initiate), T0);
    check(&mut state, "bob.near", None, T0);
    let ctx = crate::api::dto::Ctx { state: &state, viewer: None, gateway: "", site_hosts: &[], unfurl: None };
    let bob = state.aid("bob.near").unwrap();
    let profile = ctx.profile("bob.near", Some(bob));
    assert!(profile.has_profile);
    assert_eq!((profile.name, profile.rank, profile.counts.following), (Some("Bob"), None, 1));
    assert_eq!(ctx.summary(bob).name, Some("Bob"));
    assert_eq!(state.account_likes(bob, None, 100).len(), 1);
    let alice = ctx.profile("alice.near", state.aid("alice.near"));
    assert_eq!((alice.counts.followers, alice.rank), (1, Some(Rank::Initiate)), "bob's follow counts");
    assert_eq!(state.post(0).likes, 1);
}

#[test]
fn an_older_check_never_overwrites_a_newer_one() {
    let mut state = three_posts();
    state.enable_legion();
    let alice = state.aid("alice.near").unwrap();
    check(&mut state, "alice.near", Some(Rank::Initiate), T0 + 10);
    check(&mut state, "alice.near", None, T0);
    assert_eq!(state.rank(alice), Some(Rank::Initiate), "a batch that started earlier lost the race");
    check(&mut state, "alice.near", None, T0 + 20);
    assert_eq!(state.rank(alice), None);
}

#[test]
fn the_endpoint_rechecks_a_non_member_after_a_minute_and_trusts_members() {
    let non = |ms| Some(Check { rank: None, checked_ms: ms });
    let member = |ms| Some(Check { rank: Some(Rank::Initiate), checked_ms: ms });
    assert!(needs_live_check(None, T0));
    assert!(!needs_live_check(non(T0), T0 + 59_999));
    assert!(needs_live_check(non(T0), T0 + 60_000));
    assert!(!needs_live_check(member(T0), T0 + 86_400_000));
}
