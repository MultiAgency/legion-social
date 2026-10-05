# legion/1: the NEAR Legion extension to social-kv/1

legion-social is near.social for [NEAR Legion](https://nearlegion.gitbook.io/docs) members. It
reads the same data as near.social: every write is a social-kv/1 write to `social`
(`docs/STANDARD.md`), and near.social shows members' posts too. This document adds two things:

1. **Membership**: who is shown, and at what rank. It's derived from chain; nothing is written.
2. **`legion/` keys**: Legion-only data, which near.social clients ignore (social-kv/1 §2,
   unknown keys are ignored).

## 1. Membership

An account is a **member** when it holds a Legion soulbound token (NEP-171, can't be
transferred). Its **rank** is the highest rank it holds:

| Rank | Contract (mainnet) |
|---|---|
| `initiate` | `initiate.nearlegion.near` |
| `ascendant` | `ascendant.nearlegion.near` |
| `vanguard` | `vanguard.nearlegion.near` |

- A contract "holds" an account when `nft_supply_for_owner({"account_id"})` (NEP-181) is greater
  than zero.
- Rank comes only from these contracts. Nothing an account writes to `social` can make it a member
  or raise its rank.
- The indexer shows members only. A non-member's posts, likes, reposts, follows and profile are
  indexed as usual, but hidden when read, exactly as the operator denylist hides an account. If
  the account later becomes a member, everything it wrote appears, because nothing was dropped.
- The indexer checks an account soon after it first writes or is written about, and rechecks
  every account on a cycle (one hour by default). A mint or a revocation shows within that cycle.
- The API adds `rank` (`"initiate"`, `"ascendant"` or `"vanguard"`) to every account object it
  returns: authors, cards and profiles.
- `GET /v1/legion/{account_id}` answers for one account: `{"account_id", "rank", "checked_at"}`,
  where `rank` is `null` for a non-member. An account the indexer hasn't checked yet, including
  one that has never written to `social`, is checked when asked, and so is a stored "not a
  member" over a minute old. Live checks are capped at 30 a minute for the whole server (past
  that: `503`, try again shortly); answers for accounts the indexer doesn't hold are cached, a
  member answer for the recheck interval and a "not a member" for a minute. With Legion off it's a 404.

## 2. `legion/` keys

### 2.1 Skill tracks

*Specified, not yet indexed:* the server ignores these keys until the skill-tracks task lands.

A member says which Legion skill tracks they work on. Each track is an edge, written the same way
as a follow (social-kv/1 §2.5):

| Key | Value |
|---|---|
| `legion/skill/{track}` | `{}` to add the track, `null` to remove it |

`{track}` is one of `amplifier`, `power_user`, `builder`, `connector` and `chaos_agent`. Other
tracks, and values that are neither an object nor `null`, are ignored. Like membership, a track is
shown only while its author is a member.

Example: `{"legion/skill/builder": {}, "legion/skill/connector": {}}`

### 2.2 Reserved

Every other key under `legion/` is reserved for later versions of this document.

## 3. Legion-only feed

A member can post to Legion only. The post is written exactly as a social-kv/1 post or reply
(`docs/STANDARD.md` §3.2–3.3), but as a `__fastdata_kv` call to the account **`legion`** instead
of `social`. "Legion-only" means kept off near.social: the post is public chain data like any
other, readable by anyone through FastData.

A **feed** is an account that doesn't exist (an unclaimed name), such as `legion`: nobody owns it,
like `social`. Because the account doesn't exist, every receipt sent to it fails on chain with
`AccountDoesNotExist`. That's expected: FastData indexes the call's arguments whatever the
receipt's outcome, as it does for `social` (whose receipts fail with `CodeDoesNotExist`).

**The indexer reads a receiver other than `social` only when its receipt failed with
`AccountDoesNotExist` for that receiver.** Writes to accounts that exist, with or without a
contract, belong to other FastData apps: reading them would let those apps fix a post's feed or use
up an author's daily limits. The outcome is part of chain data, so a replay reads exactly the same
writes. If someone ever creates the account, its receipts stop failing that way and the indexer
stops reading that feed by itself. A top-level name such as `legion` can be created only through
the registrar; a sub-account such as `feed.example.near` can be created at any time by the owner of
`example.near`, which makes it a weaker choice for a feed.

**Feeds are part of Legion.** With Legion off (no `LEGION_CONTRACTS`):
- the tailer reads `social` only, so feed writes made while Legion is off are never logged (turning
  Legion on later doesn't bring them back without reindexing from an earlier block);
- feed actions already in the event log are skipped on replay, so state, counts and every API
  answer match upstream; they stay in the log, and with Legion back on a replay reads them again;
- `GET /v1/feed/channel/…` isn't registered (404) and `?channel=` is ignored, as upstream.

The event log keeps a feed action's rows under its own field (`c`), never in `r`, so a build that
doesn't know feeds reads the action as empty instead of replaying Legion-only posts as `social`.

Where feed posts appear on Legion Social:

| Shown | Not shown |
|---|---|
| The feed itself (`GET /v1/feed/channel/{account_id}`; the Legion tab and `/legion`) | Latest (`/v1/feed/global`) |
| `GET /v1/hashtags/{tag}?channel={account_id}` | For you, and its trending pool |
| Their author's profile tabs, and threads (as replies or parents) | Trending hashtags |
| Following (`/v1/feed/following/{account}`), for people who follow the author | `GET /v1/hashtags/{tag}` without `channel` |
| Search, notifications, quotes and links | near.social, which reads only `social` |

- **Only posts move.** Profiles, follows, likes and reposts stay on `social`. In a feed, only
  `post/{post_id}` and `reply/…` keys count; every other key sent there is ignored. Media stays on
  `social` (social-kv/1 §4).
- **The first write fixes a post's feed.** A post is still referenced as
  `"{account_id}/{post_id}"`, so likes, reposts, quotes and replies on `social` can point at it.
  A later write of the same `post/{post_id}` to a different receiver is ignored; edits and deletes
  must go to the post's own feed.
- **Post objects carry `channel`** (the feed) only for feed posts; it's absent otherwise.
- **Other feeds work the same way.** Any unclaimed name is a feed of its own: the web shows it as
  that name's Feed tab (`/{account_id}/feed`), and a name with no profile opens on it.
- **The web writes only to `social` and its configured Legion feed** (`NEXT_PUBLIC_LEGION_FEED`).
  A reply to a post in another feed goes to `social`; an edit or delete of a post in another feed
  is refused. Unset, the web shows no feeds at all: no choice in the composer, no Legion tab, no
  Feed tab, no feed labels or feed-scoped hashtag links, and `/{account_id}/feed` is a 404.
- **Limits count across feeds.** The per-account daily limits (social-kv/1 §6) cover every feed
  together.
- **Writing needs one more key.** A function-call access key names one receiver, so posting to
  `legion` needs a key with receiver `legion` (method `__fastdata_kv`), approved once. "Revoke
  posting key and sign out" deletes it together with the social key; plain sign-out only forgets
  it in the browser.
- **No code runs on a feed.** An unclaimed name has no account and no contract, and once someone
  creates it, it's no longer read as a feed.
