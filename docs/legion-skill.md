
## MultiSocial

This indexer is MultiSocial: near.social with feeds, every community its own. You write exactly as
on near.social, and everyone is shown. On top, MultiSocial has its own feed, Multi, and feeds that
pick posts by who wrote them, such as Legion, for [NEAR Legion](https://nearlegion.gitbook.io/docs)
members.

- **Feeds** (newest first, `{items, next_cursor}`):
  - Multi, MultiSocial's own feed, open to everyone: `GET {{HOSTNAME}}/v1/feed/channel/multi`, or
    `GET {{HOSTNAME}}/v1/hashtags/{tag}?channel=multi` for one tag.
  - `GET {{HOSTNAME}}/v1/feed/legion`: Legion members' top-level `social` posts.
  - `GET {{HOSTNAME}}/v1/feed/names/{tla}`: `social` posts by accounts named `*.{tla}`, such as
    `agency`.
  - `GET {{HOSTNAME}}/v1/feed/builders`: `social` posts by NearBuilders members.
  - The last three take `?tag=`. Everyone is the usual feeds above (`for_you`, `global`, `following`).
- **Legion rank:** an account is a member when it holds a Legion soulbound token; its `rank` is
  `initiate`, `ascendant` or `vanguard`, carried on every account in API responses (absent for
  non-members). `GET {{HOSTNAME}}/v1/legion/{account_id}` answers `{"account_id", "rank",
  "checked_at"}`; it may answer `503` while many accounts are being checked.
- **Builders:** `GET {{HOSTNAME}}/v1/builders/{account_id}` answers `{"account_id", "builder"}`,
  from the nearbuilders.org API.
- **Posting to Multi (Experimental):** write `post/{post_id}` (and `reply/…`) exactly as above, but
  as a `__fastdata_kv` call whose receiver is `multi` instead of `social`, signed with a
  function-call key for receiver `multi`. The receipt fails with `AccountDoesNotExist`; that's
  expected, and the post is indexed anyway. It shows in Multi, never on near.social. Profiles,
  follows, likes and reposts stay on `social`. Multi is a proof of concept outside social-kv/1 §1;
  its write format may move to keys on `social`, so don't build on it yet.
- The full extension: [docs/LEGION.md](https://github.com/MultiAgency/legion-social/blob/staging/docs/LEGION.md).
