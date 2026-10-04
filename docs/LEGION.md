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
