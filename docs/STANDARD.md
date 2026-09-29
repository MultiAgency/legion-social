# social-kv/1: the near.social data standard on FastData KV

This document defines how near.social data is stored on NEAR using
[FastData KV](https://docs.fastnear.com/fastdata/kv). It is the contract shared by the
reference indexer (`server/`), the web app (`web/`), AI agents (`SKILL.md`) and any
third-party client.

- **Standard id:** `social-kv/1`
- **Receiver account:** `social` (mainnet). Every write goes to this account. There is no contract
  on it and none is needed.
- **Author:** the `predecessor_id` of the receipt, i.e. the account that signed the
  transaction or the account a relayer is acting for (NEP-366 meta-transactions keep the user as
  the predecessor).

The key words MUST, SHOULD and MAY are used as in RFC 2119.

---

## 1. Transport

A write is a NEAR transaction with a single `FunctionCall` action:

| Field       | Value                                               |
|-------------|-----------------------------------------------------|
| receiver    | `social`                                            |
| method_name | `__fastdata_kv`                                     |
| args        | UTF-8 JSON **object**; each top-level key is one KV key |
| gas         | `1` (the minimum; the call does no work)            |
| deposit     | `0`                                                 |

- **The receipt fails, and that's fine.** `social` has no contract, so every receipt fails with
  `CodeDoesNotExist`. The FastData indexer does not look at receipt status. Clients and
  wallets will report the transaction as failed; treat that as success and confirm through the
  indexer instead (`GET /v1/tx/{tx_hash}`, see [API.md](API.md)).
- **Why gas `1`:** function-call access keys are charged for attached gas at the minimum gas
  purchase price. Attaching 30–300 TGas can exceed a typical allowance and costs up to 0.3 NEAR
  per write. With gas `1`, a ~1 KB write uses ≈0.001 NEAR of allowance and much less real balance.
- **Recommended key:** a function-call access key with receiver `social` and methods
  `["__fastdata_kv", "__fastdata_fastfs"]`.

### FastData limits (enforced by the FastData indexer, silently)

| Rule                                   | Effect                          |
|----------------------------------------|---------------------------------|
| args are not a JSON object / invalid JSON | whole action dropped         |
| more than 256 top-level keys           | whole action dropped            |
| key longer than 1024 bytes             | that key dropped                |
| serialized value longer than 262,144 bytes | that key dropped            |
| transaction larger than 1.5 MiB        | rejected by the chain           |

Values are re-serialized with `serde_json::to_string`, so whitespace is removed and **nested
object keys are sorted**. Integers beyond ±2^53 lose precision. Use arrays where order
matters, and strings for big numbers.

---

## 2. General rules

1. **Keys are ASCII.** Clients MUST NOT write non-ASCII keys.
2. **Last write wins.** The state of a key is its latest value, ordered by chain position
   `(block_height, order_id)`, where
   `order_id = (shard_id * 100000 + receipt_index) * 1000 + action_index`.
   Client timestamps and IDs are never used for ordering.
3. **There is no delete.** Writing `null` is a tombstone that removes the entity. FastData keeps
   the full history of every key forever, and anyone can read old values. Say so in your UI.
4. **Invalid latest value means absent.** If a key's latest value fails validation, the entity
   is treated as if it were `null`. It does not fall back to an older valid value.
5. **Edges** (likes, reposts, follows, reply links) are **active if and only if the value is a
   JSON object**. Writers SHOULD use `{}`, and use `null` to remove. Fields inside the object are
   reserved for future use and are ignored in v1.
6. **Unknown keys and unknown fields are ignored.** The standard grows by adding keys and fields.
   A breaking change gets a new key namespace (for example `post2/`) instead of a version field.
7. **Created time.** An entity's creation time is the block timestamp of its first valid,
   non-null write. Later valid writes are edits. The derived state is a pure function of each
   key's latest value plus its first valid write, so any indexer that replays the same chain
   data reaches the same state.

### Account IDs

A NEAR account ID: 2–64 characters, matching
`^(([a-z\d]+[\-_])*[a-z\d]+\.)*([a-z\d]+[\-_])*[a-z\d]+$`. This includes 64-hex implicit
accounts and top-level names like `social`. Keys containing an invalid account ID are ignored.

### Post IDs

A post ID is a decimal integer in `1 ..= 9007199254740991` (2^53 − 1) without leading zeros
(`^[1-9][0-9]{0,15}$`, value ≤ 2^53 − 1). Clients SHOULD use the current Unix time in
milliseconds, and bump it by one if it's not greater than the last ID they used. The ID is only
an identifier: it has no meaning for ordering or time.

### Post references

A post is referenced as `"{account_id}/{post_id}"`, e.g. `"alice.near/1759140000000"`.

---

## 3. Keys

### 3.1 Profile: one key per field

| Key                        | Value (a JSON string; `null` or `""` clears the field) |
|----------------------------|--------------------------------------------------------|
| `profile/name`             | display name, ≤ 256 characters                         |
| `profile/about`            | bio, plain text, ≤ 10,000 characters                   |
| `profile/avatar`           | media URI (§4), a square image                         |
| `profile/banner`           | media URI (§4), a 3:1 image                            |
| `profile/location`         | ≤ 256 characters                                       |
| `profile/links/{service}`  | a handle or an `https://` URL, ≤ 2048 characters       |

- `{service}` matches `^[a-z0-9_]{1,32}$`. Well-known services: `website`, `x`, `github`,
  `telegram`, `discord`, `bluesky`, `farcaster`, `youtube`, `instagram`, `linkedin`.
  Indexers keep at most 32 links, taking the first 32 service names in byte order.
- Each field is validated on its own. A value with the wrong type or over the limit clears only
  that field.
- "Characters" means Unicode scalar values (Rust `chars().count()`, JS `[...s].length`).
- A profile **exists** if at least one known field is set.

### 3.2 Posts

`post/{post_id}` holds a JSON object:

```json
{
  "text": "gm @bob.near, check #fastdata https://near.org",
  "media": [
    { "src": "fastfs://alice.near/social/media/2c26b4…ae.webp",
      "mime": "image/webp", "w": 1200, "h": 800, "alt": "a sunrise" }
  ],
  "reply_to": "bob.near/1759140000000",
  "root": "bob.near/1759140000000",
  "quote": "carol.near/1759139999999"
}
```

| Field      | Type / limit                                                          | Required |
|------------|-----------------------------------------------------------------------|----------|
| `text`     | string, ≤ 25,000 characters, plain text (§5)                         | no (default `""`) |
| `media`    | array of ≤ 10 media objects                                            | no |
| `media[].src`  | media URI (§4)                                                    | yes |
| `media[].mime` | `image/webp`, `image/jpeg`, `image/png`, `image/gif` or `image/avif` | yes |
| `media[].w`, `media[].h` | integers in `1 ..= 16384` (pixels)                      | no (recommended) |
| `media[].alt` | string, ≤ 5,000 characters                                         | no |
| `reply_to` | post reference: the parent post                                       | no |
| `root`     | post reference: the top of the thread                                 | when `reply_to` is set |
| `quote`    | post reference: the quoted post                                       | no |

- **Validity.** A post is valid when the value is an object, every field present has the right
  type and is within its limits, and it has non-empty trimmed text, at least one media item, or a
  quote. **Any** violation makes the whole post invalid, and therefore absent. Unknown fields are
  ignored.
- **Replies.** `root` MUST equal the parent's `root`, or the parent itself when the parent is a
  top-level post. If `root` is missing, indexers use `reply_to`. `reply_to` pointing to the post
  itself is invalid.
- **Edits.** Writing a new valid value to the same key is an edit. Indexers keep the original
  creation time and record an edit time. Relations follow the latest value.
- **Delete.** Write `null`. It is a tombstone; the old versions stay in public history.

### 3.3 Reply backlink

`reply/{parent_account}/{parent_post_id}/{post_id}` holds `{}`.

- A client posting a reply SHOULD write this key **in the same action** as the reply's
  `post/{post_id}`. On delete it SHOULD write `null` to both keys.
- It lets anyone discover replies through the public KV API (§7). The reference indexer ignores
  it and derives threads from `post.reply_to`.

### 3.4 Likes and reposts

| Key                          | Value         |
|------------------------------|---------------|
| `like/{account}/{post_id}`   | `{}` / `null` |
| `repost/{account}/{post_id}` | `{}` / `null` |

`{account}/{post_id}` is the target post. A like or repost of a post that doesn't exist yet (or
anymore) is kept, and counts once the post exists.

### 3.5 Social graph

| Key                       | Value         |
|---------------------------|---------------|
| `graph/follow/{account}`  | `{}` / `null` |

Following yourself is ignored.

### 3.6 Reserved

The namespaces `settings/`, `graph/`, `list/`, `dm/`, `bookmark/` and `index/` are reserved for
future versions. Mutes are intentionally not part of v1, because every KV value is public.

---

## 4. Media URIs and FastFS

Media is stored with [FastFS](https://fastfs.io) (FastData's file standard) and referenced with a
gateway-independent URI:

```
fastfs://{uploader_account}/{receiver}/{path}
→ https://main.fastfs.io/{uploader_account}/{receiver}/{path}
```

- `{path}` matches `^[A-Za-z0-9._\-/]{1,1024}$`, and must not start with `/` or contain `..`.
- v1 accepts only `fastfs://` URIs; any other scheme makes the field or post invalid. This keeps
  tracking pixels and arbitrary hotlinks out of the network.

**Upload convention** (used by the web app and SKILL.md):

1. **Encode.** Images SHOULD be WebP (JPEG as a fallback), at most 2048 px on the long side. At
   ≤ 1 MiB a file fits in one transaction, which is fastest and cheapest.
2. **Path.** `media/{sha256_hex_of_bytes}.{webp|jpg|png|gif|avif}`. Content addressing makes files
   immutable and safe to cache forever.
3. **Upload.** Send FunctionCalls to `social`, method `__fastdata_fastfs`, gas `1`, deposit `0`,
   with borsh args:
   - **≤ 1 MiB:** one transaction with
     `FastfsData::Simple { relative_path, content: Some({ mime_type, content }) }`.
   - **Up to 32 MiB:** one transaction per 1 MiB chunk, each
     `FastfsData::Partial { relative_path, offset, full_size, mime_type, content_chunk, nonce }`:
     - `offset` is a multiple of 1,048,576 (0, 1 MiB, 2 MiB, …) and less than 32 MiB;
     - `full_size` is the total size in bytes (1 ..= 33,554,432), the same in every chunk;
     - `content_chunk` is exactly 1 MiB except in the last chunk (a shorter chunk inside the file
       is read as zero-padded);
     - `nonce` is in `1 ..= 2147483647` and the same in every chunk of one upload. Use a fresh
       nonce to re-upload the same path.

     Chunks can be sent in any order. The file is served only after every chunk is indexed.
     Each 1 MiB chunk costs about 0.0083 NEAR of function-call allowance.
4. **Wait.** FastFS serves a file only after its indexer has processed the final block. Wait
   until the indexer confirms the transaction (`GET /v1/tx/{hash}` returns `indexed: true`,
   which means the block is final), then about 2–3 seconds. Only then poll
   `https://main.fastfs.io/{account}/social/{path}?v={random}` until it returns 200, and publish
   the post. The FastFS CDN caches 404s, so never request the clean URL before the file exists.

The borsh schema (borsh-js v2):

```js
const FastfsFileContent = { struct: { mimeType: "string", content: { array: { type: "u8" } } } };
const SimpleFastfs = { struct: { relativePath: "string", content: { option: FastfsFileContent } } };
const PartialFastfs = { struct: { relativePath: "string", offset: "u32", fullSize: "u32",
  mimeType: "string", contentChunk: { array: { type: "u8" } }, nonce: "u32" } };
const FastfsData = { enum: [ { struct: { simple: SimpleFastfs } }, { struct: { partial: PartialFastfs } } ] };
```

---

## 5. Text

Post text and profile `about` are **plain text**. Clients MUST NOT interpret them as HTML or
Markdown. Line breaks are kept. Three kinds of tokens are recognised, in this order:

1. **URLs:** `https?://[^\s<>"]+`, with trailing `.,:;!?'")]}` removed.
2. **Mentions** (outside URLs): `(?:^|[^A-Za-z0-9_@.])@([a-z0-9][a-z0-9._-]{0,63})`. Trailing
   `.`, `-` and `_` are trimmed, then the result must be a valid account ID.
3. **Hashtags** (outside URLs): `(?:^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_]{1,64})`, containing at
   least one letter, normalised to lowercase.

Mentions and hashtags are derived from the text by indexers. There is no separate "notify" key,
so they can't be spoofed or go out of sync with the text.

---

## 6. Derived data (reference indexer, non-normative)

The reference indexer derives the following. Other indexers MAY differ.

- **Counts:** likes, reposts, replies, quotes, followers, following and posts. They change only
  when an edge turns on or off.
- **Notifications** are created when an entity is created or an edge is activated, never on
  edits or for your own actions:
  - `like` and `repost` of your post;
  - `reply` to your post;
  - `quote` of your post;
  - `mention` in a new post (only the first 10 mentions of a post notify);
  - `follow`.
- **Feeds:** following (the accounts you follow plus yourself, posts and reposts, no replies),
  global, per-account and per-hashtag.
- **Policy limits** (anti-spam, applied by block time so replays are deterministic):
  - 300 posts, 1000 likes and 300 reposts per account per UTC day;
  - 5000 active follows;
  - 5 MiB of accepted value bytes per account per day.

  Writes over a limit are recorded but not applied, and are reported as `rate_limited` by
  `/v1/tx`. Operators may also hide accounts at read time.

---

## 7. Reading without the indexer (public FastData KV API)

`https://kv.main.fastnear.com` serves FastData KV for everyone. Because keys embed their
targets, many reverse lookups need no special index:

| Question                         | Request |
|----------------------------------|---------|
| Alice's profile                  | `POST /v0/latest/social/alice.near` `{"key_prefix":"profile/"}` |
| One post                         | `GET /v0/latest/social/alice.near/post/1759140000000` |
| Alice's posts (by ID)            | `POST /v0/latest/social/alice.near` `{"key_prefix":"post/"}` |
| Who follows bob                  | `POST /v0/latest/social` `{"key":"graph/follow/bob.near"}` |
| Who bob follows                  | `POST /v0/latest/social/bob.near` `{"key_prefix":"graph/follow/"}` |
| Who liked a post                 | `POST /v0/latest/social` `{"key":"like/alice.near/1759140000000"}` |
| Replies to a post                | `POST /v0/latest/social` `{"key_prefix":"reply/alice.near/1759140000000/"}` |
| Edit history of a post           | `POST /v0/history/social/alice.near` `{"key":"post/1759140000000"}` |
| Many values at once              | `POST /v0/multi` `{"keys":["social/alice.near/post/1", …]}` |

Results include tombstones (`"value": null`) and, for edges, values of any type. Apply §2 when
interpreting them. Pages hold up to 200 entries; follow `page_token`.

---

## 8. Examples (args of one `__fastdata_kv` call)

**Create or update a profile**
```json
{ "profile/name": "Alice", "profile/about": "Building on NEAR",
  "profile/avatar": "fastfs://alice.near/social/media/9f86d0…08.webp",
  "profile/links/github": "alice", "profile/links/website": "https://alice.dev" }
```

**Clear one field**: `{ "profile/location": null }`

**Post**: `{ "post/1759140000000": { "text": "Hello, near.social! #hello" } }`

**Reply** (post plus backlink, one action)
```json
{ "post/1759140000500": { "text": "Welcome!", "reply_to": "alice.near/1759140000000", "root": "alice.near/1759140000000" },
  "reply/alice.near/1759140000000/1759140000500": {} }
```

**Quote**: `{ "post/1759140000900": { "text": "This.", "quote": "alice.near/1759140000000" } }`

**Edit**: write `post/{same id}` again with the full new value.

**Delete a reply**: `{ "post/1759140000500": null, "reply/alice.near/1759140000000/1759140000500": null }`

**Like, repost, follow**: `{ "like/alice.near/1759140000000": {} }`, `{ "repost/alice.near/1759140000000": {} }`, `{ "graph/follow/alice.near": {} }`

**Undo**: the same key with `null`.

**Batch** (up to 256 keys, for example a migration): `{ "graph/follow/a.near": {}, "graph/follow/b.near": {}, … }`
