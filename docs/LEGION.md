# legion/1: MultiSocial's extensions to social-kv/1

MultiSocial is near.social with feeds: every community gets its own. It reads the same data as
near.social (every write is a social-kv/1 write to `social`, `docs/STANDARD.md`), shows everyone,
as near.social does, and adds feeds that pick posts by who wrote them. The first community is
[NEAR Legion](https://nearlegion.gitbook.io/docs). This document adds:

1. **Membership:** a NEAR Legion member's rank, derived from chain. Nothing is written.
2. **`legion/` keys:** Legion data near.social clients ignore (social-kv/1 §2: unknown keys are
   ignored).
3. **Members-only posts:** posts sent to the feed account `legion` instead of `social`, kept off
   near.social.
4. **Feeds:** Everyone, Legion, .agency and Builders.

All of it is on only with `LEGION_CONTRACTS` set. Unset, the server is exactly upstream's.

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
- **Membership hides nobody.** Everyone's posts, profiles, lists and counts are upstream's. Only the
  Legion feed (§4.1) is limited to members.
- The indexer checks an account soon after it first writes or is written about, and rechecks
  every account on a cycle (one hour by default). A mint or a revocation shows within that cycle.
- The API adds `rank` (`"initiate"`, `"ascendant"` or `"vanguard"`) to every account object it
  returns: authors, cards and profiles. It's absent for non-members.
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
tracks, and values that are neither an object nor `null`, are ignored. A track counts only while
its author is a member.

Example: `{"legion/skill/builder": {}, "legion/skill/connector": {}}`

### 2.2 Reserved

Every other key under `legion/` is reserved for later versions of this document.

## 3. Members-only posts

A member can post to members only. The post is written exactly as a social-kv/1 post or reply
(`docs/STANDARD.md` §3.2–3.3), but as a `__fastdata_kv` call to the account **`legion`** instead
of `social`. `legion` is the server's `LEGION_FEED` (its default); the web's
`NEXT_PUBLIC_LEGION_FEED` must name the same account, or the web would write members-only posts
somewhere the server doesn't treat as the Legion feed. "Members only" means kept off near.social: the post is public chain data like any
other, readable by anyone through FastData.

A **feed account** is an account that doesn't exist (an unclaimed name), such as `legion`: nobody
owns it, like `social`. Because the account doesn't exist, every receipt sent to it fails on chain
with `AccountDoesNotExist`. That's expected: FastData indexes the call's arguments whatever the
receipt's outcome, as it does for `social` (whose receipts fail with `CodeDoesNotExist`).

**The indexer reads a receiver other than `social` only when its receipt failed with
`AccountDoesNotExist` for that receiver.** Writes to accounts that exist, with or without a
contract, belong to other FastData apps: reading them would let those apps fix a post's feed
account or use up an author's daily limits. The outcome is part of chain data, so a replay reads
exactly the same writes. If someone ever creates the account, its receipts stop failing that way
and the indexer stops reading it by itself. A top-level name such as `legion` can be created only
through the registrar; a sub-account such as `feed.example.near` can be created at any time by the
owner of `example.near`, which makes it a weaker choice.

With Legion off:
- the tailer reads `social` only, so writes to feed accounts made while Legion is off are never
  logged (turning Legion on later doesn't bring them back without reindexing from an earlier block);
- feed-account actions already in the event log are skipped on replay, so state, counts and every
  API answer match upstream; they stay in the log, and with Legion back on a replay reads them again;
- `GET /v1/feed/…` routes of this document aren't registered (404), and `?channel=` is ignored, as
  upstream.

The event log keeps a feed-account action's rows under its own field (`c`), never in `r`, so a build
that doesn't know feed accounts reads the action as empty instead of replaying members-only posts as
`social`.

**Only members' posts to `legion` are shown.** A post sent to `legion` by an account without a rank
(§1) is shown nowhere on the site: not in its feeds, its author's profile, threads, search or
anywhere else. It appears once the account becomes a member, since nothing was dropped. Such a reply doesn't count in its parent's reply
count either, and the web doesn't offer a non-member the reply box on a members-only post.

Where members' members-only posts appear:

| Shown | Not shown |
|---|---|
| The Legion feed (§4.1), to everyone, by members | Everyone: For you, its trending pool, Latest |
| `GET /v1/feed/channel/{account_id}` (the account's Feed tab, `/{account_id}/feed`; `/legion` opens on it) | Trending hashtags, and `GET /v1/hashtags/{tag}` without `channel` |
| `GET /v1/hashtags/{tag}?channel={account_id}` | near.social, which reads only `social` |
| Their author's profile tabs, threads, Following, search, notifications, quotes and links | |

- **Only posts move.** Profiles, follows, likes and reposts stay on `social`. In a feed account,
  only `post/{post_id}` and `reply/…` keys count; every other key sent there is ignored. Media
  stays on `social` (social-kv/1 §4).
- **The first write fixes a post's feed account.** A post is still referenced as
  `"{account_id}/{post_id}"`, so likes, reposts, quotes and replies on `social` can point at it.
  A later write of the same `post/{post_id}` to a different receiver is ignored; edits and deletes
  must go to the post's own feed account.
- **Post objects carry `channel`** (the feed account) only for those posts; it's absent otherwise.
- **The web writes only to `social` and its configured feed account** (`NEXT_PUBLIC_LEGION_FEED`).
  A reply to a post in another feed account goes to `social`; an edit or delete of one is refused.
  Unset, the web is upstream's: no feeds, no Feed tabs, no labels.
- **Limits count across feed accounts.** The per-account daily limits (social-kv/1 §6) cover them
  all together.
- **Writing needs one more key.** A function-call access key names one receiver, so posting to
  `legion` needs a key with receiver `legion` (method `__fastdata_kv`), approved once. "Revoke
  posting key and sign out" deletes it together with the social key; plain sign-out only forgets
  it in the browser.

## 4. Feeds

Home switches between four feeds. Each lists top-level posts, newest first, with the usual
`{items, next_cursor}` paging, and takes `?tag=` to show one hashtag within it. The routes exist
only with Legion on.

| Feed | Who posts | Where it shows | Endpoint |
|---|---|---|---|
| Everyone | Anyone with a NEAR account | Here and on near.social | upstream's: For you, Following, Latest |
| Legion | Legion token holders | Members only by default; Public also goes to near.social, tagged #legion | `GET /v1/feed/legion` |
| .agency | Accounts named `*.agency` | Here and on near.social | `GET /v1/feed/names/agency` |
| Builders | NearBuilders members | Here and on near.social | `GET /v1/feed/builders` |

### 4.1 Legion

Posts sent to `legion` (§3), plus `social` posts tagged `#legion`, written by members (an account
with a rank, §1). A non-member's post to `legion`, or with `#legion`, isn't in it. On the web the
post box offers **Members only** (the default: sent to `legion`) or **Public** (sent to `social`,
with ` #legion` appended when the text doesn't have it), and shows only to members.

### 4.2 Names

`GET /v1/feed/names/{tla}`: `social` posts by accounts whose ID ends with `.{tla}`, such as
`x.agency` or `deep.x.agency` for `agency` (not `xagency.near`, and not `agency` itself). `{tla}`
must be one part of an account ID: 2 to 64 lowercase letters and digits, joined by single `-` or
`_`. The name registry decides who can hold such a name, so the feed needs no list of its own. The
web shows `.agency`. A wallet signs in as one account, so posting as a `.agency` name is done from
that name's own account; the web has no post box there.

### 4.3 Builders

`social` posts by NearBuilders members: the accounts with an active builder profile on
[nearbuilders.org](https://nearbuilders.org) (`withdrawnAt` null), read from its public API
(`GET {NEARBUILDERS_API}/v1/builders`, paged by `?cursor=`; default `https://nearbuilders.org/api`)
every ten minutes. **This is off-chain trust:** the server takes that API's word for who is a
builder. A failed refresh keeps the last good list. `GET /v1/builders/{account_id}` answers
`{"account_id", "builder"}`.

### 4.4 Hashtags per feed

`?tag=` on the three endpoints above lists one hashtag within that feed. `GET /v1/hashtags/{tag}`
stays Everyone's (`social` posts by anyone), and `?channel={account_id}` scopes it to a feed account
(§3).
