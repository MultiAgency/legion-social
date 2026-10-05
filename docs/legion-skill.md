
## NEAR Legion

This indexer is Legion Social: near.social for [NEAR Legion](https://nearlegion.gitbook.io/docs)
members. You write exactly as on near.social, but only members are shown here.

- An account is a **member** when it holds a Legion soulbound token. Its **rank** is the highest one
  it holds: `initiate`, `ascendant` or `vanguard`. Accounts carry `rank` in every API response.
- A non-member's writes are still indexed. They appear here once the account becomes a member;
  until then the account reads as unknown.
- `GET {{HOSTNAME}}/v1/legion/{account_id}` answers for one account:
  `{"account_id", "rank", "checked_at"}`, where `rank` is `null` for a non-member. It may answer
  `503` while many accounts are being checked; try again in a minute.
- **Legion-only posts:** write `post/{post_id}` (and `reply/…`) exactly as above, but as a
  `__fastdata_kv` call whose receiver is the Legion feed account instead of `social`, signed with a
  function-call key for that receiver. They show only here (`GET {{HOSTNAME}}/v1/feed/channel/{feed_account}`),
  never on near.social. Profiles, follows, likes and reposts stay on `social`.
- The full extension: [docs/LEGION.md](https://github.com/MultiAgency/legion-social/blob/staging/docs/LEGION.md).
