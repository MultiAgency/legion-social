# near.social read API (`/v1`)

The Rust server (`server/`) indexes every `social-kv/1` write (see [STANDARD.md](STANDARD.md))
and serves it over HTTP. All responses are JSON. CORS is open.

Base URL: `{{HOSTNAME}}`, for example `http://127.0.0.1:3040` in development.

## Conventions

- **`viewer`** (query, optional): an account ID. When set, objects include `viewer` flags
  (`liked`, `reposted`, `following`, `followed_by`). Responses with `viewer` are
  `Cache-Control: private, no-cache`; the others are `public, max-age=2, stale-while-revalidate=30`.
- **Pagination:** list endpoints accept `cursor` (opaque string) and `limit` (default 20,
  1–100), and return `{ "items": [...], "next_cursor": "..." | null }`. Pass `next_cursor` back
  as `cursor` to get the next page.
- **Times** are Unix milliseconds (block time).
- **Errors** return `{ "error": "not_found" | "invalid_account_id" | "bad_request" | ..., "message"?: "..." }`
  with the matching HTTP status.
- **Accounts** are always valid: any syntactically valid account ID returns a profile, possibly
  empty (`has_profile: false`, zero counts).

## Objects

### AccountSummary
```json
{ "account_id": "alice.near", "name": "Alice" , "avatar_url": "https://main.fastfs.io/alice.near/social/media/….webp" }
```
`name` and `avatar_url` may be `null`.

### AccountCard (lists of accounts)
```json
{ "account_id": "alice.near", "name": "Alice", "avatar_url": "…", "about": "Building on NEAR",
  "followers": 12, "viewer": { "following": true, "followed_by": false }, "cursor": "…" }
```
`about` is cut to 300 characters. `viewer` is present only when `viewer` was given.

### Profile (`GET /v1/accounts/{account_id}`)
```json
{
  "account_id": "alice.near",
  "has_profile": true,
  "name": "Alice",
  "about": "Building on NEAR",
  "avatar": "fastfs://alice.near/social/media/….webp",
  "avatar_url": "https://main.fastfs.io/alice.near/social/media/….webp",
  "banner": null,
  "banner_url": null,
  "location": "Lisbon",
  "links": { "github": "alice", "website": "https://alice.dev" },
  "counts": { "followers": 12, "following": 40, "posts": 88 },
  "joined_at": 1759140000123,
  "viewer": { "following": false, "followed_by": true }
}
```
`joined_at` is the time of the account's first accepted write, or `null`.

### Post
```json
{
  "key": "alice.near/1759140000000",
  "id": "1759140000000",
  "author": { "account_id": "alice.near", "name": "Alice", "avatar_url": "…" },
  "text": "gm @bob.near #near",
  "media": [ { "src": "fastfs://…", "url": "https://main.fastfs.io/…", "mime": "image/webp", "w": 1200, "h": 800, "alt": "" } ],
  "created_at": 1759140000123,
  "block_height": 170000000,
  "edited_at": null,
  "reply_to": { "key": "bob.near/1759130000000", "author": { "account_id": "bob.near", "name": "Bob", "avatar_url": null } },
  "root": "bob.near/1759130000000",
  "quote": null,
  "mentions": ["bob.near"],
  "hashtags": ["near"],
  "counts": { "replies": 0, "reposts": 0, "likes": 3, "quotes": 0 },
  "viewer": { "liked": false, "reposted": false }
}
```
- `media[].w`, `media[].h` and `media[].alt` may be `null`.
- `reply_to` is `null` for top-level posts. `root` is a post key or `null`.
- `quote` is `null`, a nested **Post** (whose own `quote` is always `null`), or
  `{ "key": "carol.near/…", "unavailable": true }` when the quoted post doesn't exist or was
  deleted.

### FeedItem (every list of posts)
```json
{ "type": "post", "post": { …Post }, "reposted_by": null, "reposted_at": null, "cursor": "…" }
{ "type": "repost", "post": { …Post }, "reposted_by": { …AccountSummary }, "reposted_at": 1759140000999, "cursor": "…" }
```

Items from `/v1/feed/for_you` also carry `"reason"`: `"following"`, `"trending"` or `"new"`.

### Notification
```json
{
  "kind": "like",
  "actors": [ { …AccountSummary } ],
  "actor_count": 3,
  "post": { …Post },
  "created_at": 1759140000999,
  "cursor": "…"
}
```
- **`kind`** is one of `like`, `repost`, `reply`, `quote`, `mention`, `follow`.
- **Grouping:** consecutive `like`, `repost` and `follow` notifications on the same target are
  grouped. `actors` lists up to 5 of them, newest first; `actor_count` is the total.
- **`post`:**

| `kind` | `post` is |
|---|---|
| `like`, `repost` | your post |
| `reply`, `quote`, `mention` | the new post |
| `follow` | `null` |

## Endpoints

### Status
- `GET /v1/status` returns:
  ```
  { standard: "social-kv/1", chain_id, social_account_id, last_block_height, last_block_ts,
    lag_ms, counts: { accounts, posts, likes, follows } }
  ```

### Feeds (items: FeedItem)
- **`GET /v1/feed/for_you`** (`viewer` optional): the home feed.
  - It interleaves the viewer's following feed with trending posts (every third item) from
    accounts the viewer doesn't follow.
  - Trending posts come from the last 48 h, scored by likes, reposts, replies and quotes, with
    time decay. At most two per author, refreshed every minute.
  - When both sources run out, it continues with recent posts from everyone else.
  - Without a viewer: trending, then recent.
  - Items carry `reason`. The cursor is opaque.
- `GET /v1/feed/global`: all top-level posts, newest first (no replies, no reposts).
- `GET /v1/feed/following/{account_id}`: posts and reposts from the account and everyone it
  follows, newest first (no replies).
- `GET /v1/hashtags/{tag}`: posts with the hashtag (lowercase), newest first.
- `GET /v1/search/posts?q=`: posts whose text contains `q` (case-insensitive), newest first.

### Accounts
- `GET /v1/accounts/{account_id}` returns a Profile.
- `GET /v1/accounts/{account_id}/posts` returns FeedItems: posts and reposts, no replies.
- `GET /v1/accounts/{account_id}/replies` returns FeedItems: the account's replies.
- `GET /v1/accounts/{account_id}/media` returns FeedItems: the account's posts with media.
- `GET /v1/accounts/{account_id}/likes` returns FeedItems: posts the account liked, newest like first.
- `GET /v1/accounts/{account_id}/followers` returns AccountCards, newest first.
- `GET /v1/accounts/{account_id}/following` returns AccountCards, newest first.
- `GET /v1/search/accounts?q=` returns AccountCards. It matches account ID prefix, then
  name-word prefix, ranked by followers.
- `GET /v1/suggestions` returns AccountCards: popular accounts. With `viewer`, it leaves out the
  viewer and accounts they already follow.

### Posts
- **`GET /v1/posts/{account_id}/{post_id}`** returns:
  ```
  { post: Post, ancestors: Post[], parent_missing: boolean }
  ```
  - `ancestors` runs from the root down to the direct parent, up to 20.
  - `parent_missing` is true when the chain stops at a deleted or unknown post.
  - Returns 404 if the post doesn't exist or was deleted.
- **`GET /v1/posts/{account_id}/{post_id}/replies`** returns FeedItems: the author's own replies
  first, then everyone else's, oldest first.
- **`GET /v1/posts/{account_id}/{post_id}/quotes`** returns FeedItems, newest first.
- **`GET /v1/posts/{account_id}/{post_id}/likes`** returns AccountCards.
- **`GET /v1/posts/{account_id}/{post_id}/reposts`** returns AccountCards.
- **`POST /v1/posts/batch`** takes `{ "keys": ["alice.near/1", …], "viewer"?: "…" }` (up to
  100 keys) and returns `{ items: (Post | null)[] }` in input order.

### Hashtags
- `GET /v1/hashtags/trending` returns `{ items: [{ tag, count }] }`: the top 10 over the last
  24 h.

### Notifications
- `GET /v1/notifications/{account_id}` returns Notifications, newest first.
- `GET /v1/notifications/{account_id}/count?since={ms}` returns `{ count }`: notifications
  newer than `since`.

### Transaction outcome
**`GET /v1/tx/{tx_hash}`** reports what the indexer did with a transaction's writes. Poll it after
sending a transaction. It keeps about 200k recent transactions.

```json
{ "tx_hash": "…", "indexed": true, "block_height": 170000000, "block_ts": 1759140000123,
  "predecessor_id": "alice.near",
  "actions": [ { "kind": "kv", "status": "ok", "keys": [ { "key": "post/1759140000000", "status": "ok" } ] } ] }
```

FastFS uploads to `social` are reported too, so clients can confirm an upload's block is final
before probing the FastFS gateway:

```json
{ "tx_hash": "…", "indexed": true, "block_height": 170000000, "block_ts": 1759140000123,
  "predecessor_id": "alice.near",
  "actions": [ { "kind": "fastfs", "status": "ok", "keys": [],
                 "file": { "path": "media/2c26…ae.webp", "deleted": false } } ] }
```

- **Action `kind`:** `kv` (`__fastdata_kv`) or `fastfs` (`__fastdata_fastfs`). FastFS actions
  carry `file` (`path`, and `offset`/`full_size` for multi-part uploads) instead of `keys`.
  FastFS reports aren't persisted, so they're only available for uploads seen since the server
  started.
- **Action `status`:** `ok`, `invalid_json` (not a JSON object), `too_many_keys` (more than 256;
  nothing applied) or `invalid_borsh` (a FastFS payload that couldn't be decoded).
- **Key `status`:**
  - `ok`: accepted.
  - `ignored`: an unknown key, or a known key the indexer doesn't use, such as `reply/…`.
  - `invalid`: failed validation. The entity is now absent. A `reason` string is included.
  - `key_too_long`: dropped.
  - `value_too_large`: dropped.
  - `rate_limited`: over the policy limits and not applied.
- If the server hasn't seen the transaction yet, it returns `{ "tx_hash": "…", "indexed": false }`.

### Live updates
**`GET /v1/stream`** is a Server-Sent Events stream. It sends one `block` event per indexed block
that contains `social` writes:

```
event: block
data: {"block_height":170000000,"block_ts":1759140000123,"tx_hashes":["…"],"posts":["alice.near/1759140000000"],"accounts":["alice.near"]}
```

### Migration from SocialDB (`social.near`)
- **`GET /v1/legacy/{account_id}`** returns the account's legacy near.social profile and follows,
  already converted to `social-kv/1` fields:

```json
{
  "account_id": "alice.near",
  "exists": true,
  "profile": { "name": "Alice", "about": "…", "location": null, "links": { "x": "alice" } },
  "avatar": { "kind": "ipfs", "proxy_url": "/v1/legacy/alice.near/image/avatar" },
  "banner": null,
  "follows": ["bob.near", "carol.near"],
  "follows_on_network": 1,
  "already_following": 0
}
```

  - `follows_on_network` counts the follows that already have activity on the new network.
  - `already_following` counts those the account already follows here.

- **`GET /v1/legacy/{account_id}/image/{avatar|banner}`** returns the legacy image bytes
  (IPFS, URL or NFT media), fetched by the server. The client resizes them and re-uploads them to
  FastFS. The source always comes from the account's legacy profile, never from the request.

### Docs
- `GET /skill.md`: the agent guide.
- `GET /standard.md`: the standard.
- `GET /api.md`: this document.
