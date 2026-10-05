
## MultiSocial

This indexer is MultiSocial: near.social with feeds, every community its own. You write exactly as
on near.social, and everyone is shown. On top, feeds pick posts by who wrote them; the Legion feed,
for [NEAR Legion](https://nearlegion.gitbook.io/docs) members, is one of them.

- **Feeds** (top-level posts, newest first, `{items, next_cursor}`, optional `?tag=`):
  - `GET {{HOSTNAME}}/v1/feed/legion`: Legion members' posts sent to `legion`, plus their `social`
    posts tagged `#legion`.
  - `GET {{HOSTNAME}}/v1/feed/names/{tla}`: `social` posts by accounts named `*.{tla}`, such as
    `agency`.
  - `GET {{HOSTNAME}}/v1/feed/builders`: `social` posts by NearBuilders members.
  - Everyone is the usual feeds above (`for_you`, `global`, `following`).
- **Legion rank:** an account is a member when it holds a Legion soulbound token; its `rank` is
  `initiate`, `ascendant` or `vanguard`, carried on every account in API responses (absent for
  non-members). `GET {{HOSTNAME}}/v1/legion/{account_id}` answers `{"account_id", "rank",
  "checked_at"}`; it may answer `503` while many accounts are being checked.
- **Builders:** `GET {{HOSTNAME}}/v1/builders/{account_id}` answers `{"account_id", "builder"}`,
  from the nearbuilders.org API.
- **Members-only posts:** write `post/{post_id}` (and `reply/…`) exactly as above, but as a
  `__fastdata_kv` call whose receiver is `legion` instead of `social`, signed with a function-call
  key for receiver `legion`. The receipt fails with `AccountDoesNotExist`; that's expected, and the
  post is indexed anyway. They show in the Legion feed and at `GET {{HOSTNAME}}/v1/feed/channel/legion`,
  never on near.social. Profiles, follows, likes and reposts stay on `social`. To post to the Legion
  feed publicly instead, post to `social` with `#legion`.
- The full extension: [docs/LEGION.md](https://github.com/MultiAgency/legion-social/blob/staging/docs/LEGION.md).
