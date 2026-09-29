use super::*;
use crate::ingest::fastdata::parse_action;
use serde_json::json;

const T0: u64 = 1_759_140_000_000;

fn block(height: u64, ms: u64, actions: Vec<(&str, Value)>) -> LogBlock {
    LogBlock {
        b: height,
        t: ms * 1_000_000,
        a: actions
            .into_iter()
            .enumerate()
            .map(|(i, (author, args))| {
                parse_action(i as u64, Some(format!("tx{height}-{i}")), author.into(), &serde_json::to_vec(&args).unwrap())
            })
            .collect(),
    }
}

fn statuses(state: &State, tx: &str) -> Vec<KeyStatus> {
    state.txs[tx].actions.iter().flat_map(|a| a.keys.iter().map(|k| k.status)).collect()
}

#[test]
fn daily_post_quota_resets_next_day() {
    let mut state = State::new();
    let mut height = 1;
    for chunk in 0..(MAX_DAILY_POSTS as u64 / 100) {
        let args: serde_json::Map<String, Value> = (0..100)
            .map(|i| (format!("post/{}", chunk * 100 + i + 1), json!({"text": "x"})))
            .collect();
        state.apply_block(&block(height, T0, vec![("a.near", Value::Object(args))]));
        height += 1;
    }
    assert_eq!(state.counts.posts, MAX_DAILY_POSTS as u64);
    state.apply_block(&block(height, T0 + 1000, vec![("a.near", json!({"post/100000": {"text": "over"}}))]));
    assert_eq!(statuses(&state, &format!("tx{height}-0")), vec![KeyStatus::RateLimited]);
    // Edits of existing posts are not new posts.
    state.apply_block(&block(height + 1, T0 + 2000, vec![("a.near", json!({"post/1": {"text": "edit"}}))]));
    assert_eq!(statuses(&state, &format!("tx{}-0", height + 1)), vec![KeyStatus::Ok]);
    // Next UTC day.
    state.apply_block(&block(height + 2, T0 + DAY_MS, vec![("a.near", json!({"post/100000": {"text": "ok"}}))]));
    assert_eq!(statuses(&state, &format!("tx{}-0", height + 2)), vec![KeyStatus::Ok]);
    assert_eq!(state.counts.posts, MAX_DAILY_POSTS as u64 + 1);
}

#[test]
fn daily_byte_budget() {
    let mut state = State::new();
    // ~200 KB per value (over the text limit, so invalid, but the bytes still count).
    let big = "x".repeat(200_000);
    let mut applied = 0;
    for i in 0..30u64 {
        state.apply_block(&block(i + 1, T0, vec![("a.near", json!({ format!("post/{}", i + 1): {"text": big} }))]));
        if statuses(&state, &format!("tx{}-0", i + 1)) != vec![KeyStatus::RateLimited] {
            applied += 1;
        }
    }
    assert_eq!(applied, MAX_DAILY_BYTES / 200_011);
}

#[test]
fn follow_cap() {
    let mut state = State::new();
    let targets: Vec<String> = (0..MAX_FOLLOWING + 1).map(|i| format!("u{i}.near")).collect();
    for (n, chunk) in targets.chunks(250).enumerate() {
        let args: serde_json::Map<String, Value> =
            chunk.iter().map(|t| (format!("graph/follow/{t}"), json!({}))).collect();
        state.apply_block(&block(n as u64 + 1, T0 + n as u64, vec![("a.near", Value::Object(args))]));
    }
    let a = state.aid("a.near").unwrap();
    assert_eq!(state.account(a).following.len(), MAX_FOLLOWING);
    assert_eq!(state.counts.follows, MAX_FOLLOWING as u64);
}

#[test]
fn too_many_keys_drops_whole_action() {
    let mut state = State::new();
    let args: serde_json::Map<String, Value> =
        (0..257).map(|i| (format!("graph/follow/u{i}.near"), json!({}))).collect();
    state.apply_block(&block(1, T0, vec![("a.near", Value::Object(args))]));
    let report = &state.txs["tx1-0"];
    assert_eq!(report.actions[0].status, ActionStatus::TooManyKeys);
    assert_eq!(state.counts.follows, 0);
    assert_eq!(state.counts.accounts, 0);
}

#[test]
fn following_feed_merges_and_paginates() {
    let mut state = State::new();
    let mut height = 1;
    let authors: Vec<String> = (0..50).map(|i| format!("u{i}.near")).collect();
    let follows: serde_json::Map<String, Value> =
        authors.iter().map(|a| (format!("graph/follow/{a}"), json!({}))).collect();
    state.apply_block(&block(height, T0, vec![("me.near", Value::Object(follows))]));
    for round in 0..20u64 {
        height += 1;
        let actions = authors
            .iter()
            .map(|a| (a.as_str(), json!({ format!("post/{}", round + 1): {"text": "hi"} })))
            .collect();
        state.apply_block(&block(height, T0 + height, actions));
    }
    let me = state.aid("me.near").unwrap();
    let mut seen = 0;
    let mut cursor = None;
    let mut last_seq = u64::MAX;
    loop {
        let page = state.feed_following(me, cursor, 37);
        if page.is_empty() {
            break;
        }
        for e in &page {
            assert!(e.seq() < last_seq, "strictly newest first");
            last_seq = e.seq();
        }
        seen += page.len();
        cursor = Some(page.last().unwrap().seq());
    }
    assert_eq!(seen, 50 * 20);
}

mod for_you {
    use super::*;
    use crate::state::query::{ForYouCursor, Pos, Reason, FOR_YOU_WINDOW_MS};

    const HOUR: u64 = 3_600_000;

    /// Builds a network: `me` follows f0..f1 (8 posts each); t0..t5 aren't followed and each has 2
    /// posts, the first liked by `n` accounts; o0..o3 are quiet accounts with 3 posts each.
    fn network() -> State {
        let mut state = State::new();
        let mut h = 1;
        let mut emit = |state: &mut State, ms: u64, actions: Vec<(&str, Value)>| {
            state.apply_block(&block(h, ms, actions));
            h += 1;
        };
        emit(&mut state, T0, vec![("me.near", json!({"graph/follow/f0.near": {}, "graph/follow/f1.near": {}}))]);
        for i in 0..8u64 {
            for f in ["f0.near", "f1.near"] {
                emit(&mut state, T0 + i * HOUR, vec![(f, json!({ format!("post/{}", i + 1): {"text": "following"} }))]);
            }
        }
        for t in 0..6u64 {
            let author = format!("t{t}.near");
            emit(&mut state, T0 + 2 * HOUR, vec![(author.as_str(), json!({"post/1": {"text": "hot"}, "post/2": {"text": "warm"}}))]);
            for l in 0..(t + 1) {
                let liker = format!("l{l}.near");
                emit(&mut state, T0 + 3 * HOUR, vec![(liker.as_str(), json!({ format!("like/{author}/1"): {} }))]);
            }
        }
        for o in 0..4u64 {
            let author = format!("o{o}.near");
            let args: serde_json::Map<String, Value> =
                (1..=3).map(|i| (format!("post/{i}"), json!({"text": "quiet"}))).collect();
            emit(&mut state, T0 + 4 * HOUR, vec![(author.as_str(), Value::Object(args))]);
        }
        state
    }

    fn pool(state: &State) -> Vec<Pid> {
        state.ranked_posts(state.last_block_ms, FOR_YOU_WINDOW_MS, 300)
    }

    fn author(state: &State, pid: Pid) -> String {
        state.account(state.post(pid).key.author).name.to_string()
    }

    #[test]
    fn ranking_prefers_engagement_and_caps_authors() {
        let state = network();
        let ranked = pool(&state);
        // The most-liked post (t5, 6 likes) wins.
        assert_eq!(author(&state, ranked[0]), "t5.near");
        // Never more than two posts per author.
        let mut per_author: FxHashMap<String, usize> = FxHashMap::default();
        for &pid in &ranked {
            *per_author.entry(author(&state, pid)).or_default() += 1;
        }
        assert!(per_author.values().all(|&n| n <= 2), "{per_author:?}");
        // Same engagement, older post scores lower.
        let now = state.last_block_ms;
        let f_old = state.pid("f0.near", 1).unwrap();
        let f_new = state.pid("f0.near", 8).unwrap();
        assert!(state.trending_score(f_new, now) > state.trending_score(f_old, now));
        // Posts older than the window are excluded.
        assert!(state.ranked_posts(now + FOR_YOU_WINDOW_MS + 10 * HOUR, FOR_YOU_WINDOW_MS, 300).is_empty());
    }

    #[test]
    fn replies_and_hidden_accounts_stay_out_of_the_pool() {
        let mut state = network();
        state.apply_block(&block(
            10_000,
            state.last_block_ms + 1000,
            vec![("r.near", json!({"post/1": {"text": "reply", "reply_to": "t5.near/1", "root": "t5.near/1"}}))],
        ));
        state.set_hidden(&["t5.near".to_string()]);
        let ranked = pool(&state);
        assert!(ranked.iter().all(|&p| author(&state, p) != "t5.near" && author(&state, p) != "r.near"));
    }

    #[test]
    fn mixes_following_with_trending_every_third_slot() {
        let state = network();
        let me = state.aid("me.near").unwrap();
        let (items, next) = state.feed_for_you(Some(me), ForYouCursor::default(), 9, &pool(&state));
        let reasons: Vec<Reason> = items.iter().map(|(_, r)| *r).collect();
        use Reason::*;
        assert_eq!(reasons, vec![Following, Following, Trending, Following, Following, Trending, Following, Following, Trending]);
        for (entry, reason) in &items {
            let who = author(&state, entry.pid());
            match reason {
                Following => assert!(who == "f0.near" || who == "f1.near"),
                _ => assert!(who != "f0.near" && who != "f1.near" && who != "me.near"),
            }
        }
        assert!(next.is_some());
    }

    #[test]
    fn paging_covers_every_post_exactly_once() {
        let state = network();
        let me = state.aid("me.near").unwrap();
        let pool = pool(&state);
        let mut cursor = ForYouCursor::default();
        let mut seen = FxHashSet::default();
        let mut last_reason = Reason::Following;
        loop {
            let (items, next) = state.feed_for_you(Some(me), cursor, 7, &pool);
            for (entry, reason) in items {
                assert!(seen.insert(entry.pid()), "duplicate {}", state.post_key_string(entry.pid()));
                last_reason = reason;
            }
            // Round-trip the cursor through its string form, like the API does.
            match next {
                Some(n) => cursor = ForYouCursor::decode(&n.encode()).unwrap(),
                None => break,
            }
        }
        assert_eq!(seen.len() as u64, state.counts.posts);
        assert_eq!(last_reason, Reason::New, "quiet accounts arrive at the end");
    }

    #[test]
    fn signed_out_is_trending_then_new() {
        let state = network();
        let pool = pool(&state);
        let (items, _) = state.feed_for_you(None, ForYouCursor::default(), 100, &pool);
        let first_new = items.iter().position(|(_, r)| *r == Reason::New).unwrap();
        assert!(items[..first_new].iter().all(|(_, r)| *r == Reason::Trending));
        assert!(items[first_new..].iter().all(|(_, r)| *r == Reason::New));
        assert_eq!(first_new, pool.len());
        assert_eq!(items.len() as u64, state.counts.posts);
    }

    #[test]
    fn cursor_encoding() {
        let c = ForYouCursor { following: Pos::Before(123), pool: 7, recent: Pos::Done };
        assert_eq!(c.encode(), "f123.p7.gx");
        assert_eq!(ForYouCursor::decode("f123.p7.gx"), Some(c));
        assert_eq!(ForYouCursor::decode("fs.p0.gs"), Some(ForYouCursor::default()));
        for bad in ["", "123", "f1.p2", "f1.p2.g3.x", "fz.p0.gs", "f1.p-1.gs"] {
            assert_eq!(ForYouCursor::decode(bad), None, "{bad}");
        }
    }
}
