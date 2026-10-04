# legion-social

near.social for [NEAR Legion](https://nearlegion.gitbook.io/docs) members: a fork of
[near-social-kv](https://github.com/evgenykuzyakov/near-social-kv) whose indexer shows only
Legion members, ranked by their soulbound tokens. Set `LEGION_CONTRACTS` to turn it on
([`docs/LEGION.md`](docs/LEGION.md)); unset, everything below works as upstream.

# near.social on FastData KV

A fast, Twitter-style social network on NEAR.

- **Writes:** users write FastData KV transactions to the account **`social`**. There's no
  contract and no storage deposit.
- **Reads:** a Rust indexer mirrors every write into memory and serves social queries in under a
  millisecond.
- **UI:** a Next.js app with server-side rendering.
- **Images:** stored in FastFS.

| Part | Where | What |
|---|---|---|
| Standard | [`docs/STANDARD.md`](docs/STANDARD.md) | `social-kv/1`: key layout, value schemas, limits, semantics |
| API | [`docs/API.md`](docs/API.md) | The `/v1` read API |
| Agents | [`SKILL.md`](SKILL.md) | How AI agents read and post (served at `/skill.md`) |
| Server | [`server/`](server) | Rust: neardata tailer, event log, in-memory state, actix-web API |
| Web | [`web/`](web) | Next.js App Router, React 19, Tailwind, TanStack Query, wallet selector |
| Test vectors | [`docs/fixtures/`](docs/fixtures) | Input rows and expected state, used by the Rust tests |

## How it works

```
 wallet / agent ──FunctionCall __fastdata_kv (gas 1, deposit 0)──▶ social   (receipt fails: no contract, by design)
                                                                   │
            neardata.xyz (final blocks) ◀──────────────────────────┘
                   │
            server: tailer ─▶ data/kv.jsonl (append-only log) ─▶ in-memory State ─▶ /v1 API ─▶ web (SSR) / agents
```

1. **Write.** A user signs `__fastdata_kv` on `social` with an app-held function-call key, so
   there are no popups after one "Enable posting" approval. Args are a JSON object; each key is
   one write (`post/{id}`, `like/{acct}/{id}`, `graph/follow/{acct}`, `profile/name`, …).
2. **Index.** The server tails final blocks from neardata. It filters receipts to `social` with
   method `__fastdata_kv` and applies FastNEAR's exact KV parse rules (checked byte for byte
   against `kv.main.fastnear.com`). It appends each block to `data/kv.jsonl`, then applies it to
   the in-memory state.
3. **Read.** Everything is served from memory: feeds (k-way merge for following), threads,
   likes, follows, notifications, hashtags, search and trending.
4. **Confirm.** Because every receipt "fails", clients confirm writes with
   `GET /v1/tx/{hash}`, which reports each key's outcome.

## Quick start

**Server** (Rust ≥ 1.91):

```bash
cp server/.env.example .env                 # set START_BLOCK_HEIGHT (a height, or `latest`)
cargo run --release -p near-social-server    # reads .env from the current directory (or env vars)
```

**Demo data** (no chain access needed):

```bash
python3 scripts/gen_demo_log.py data-demo
INDEXER=off DATA_DIR=data-demo cargo run --release -p near-social-server
curl -s localhost:3040/v1/feed/global | head -c 400
```

**Web** (Node ≥ 20):

```bash
cd web && cp .env.example .env.local && npm install && npm run dev   # http://localhost:3000
```

**Both, with Docker:** `docker compose up --build`.

## Server

- **Event log:** `data/kv.jsonl` holds one line per block that has `social` writes;
  `checkpoint.json` holds `{block_height, log_len}`. On boot the log is truncated to the
  checkpoint (dropping any torn tail), replayed (≈6k blocks in 70 ms, 150k posts in about 1.4 s),
  and tailing resumes from the next block.
  - **Back up `DATA_DIR`.** It's the only state. Without it, the server re-tails from
    `START_BLOCK_HEIGHT`.
- **Ordering:** `seq = block_height << 20 | row` orders everything and is the API cursor. Lists
  are append-only and checked lazily when read, so unlikes, deletes and edits need no index
  surgery.
- **Policy** (anti-spam, deterministic on replay):
  - 300 posts, 1000 likes, 300 reposts and 5 MiB per account per UTC day;
  - at most 5000 follows;
  - `DENYLIST_PATH` hides accounts at read time.
- **Performance** (M-series laptop, 8k accounts, 125k posts, 300k likes, about 300 MB RSS):

  | Request | Throughput | Latency |
  |---|---|---|
  | Following feed with 5000 follows | ~49k req/s | p50 0.6 ms, p99 2.5 ms |
  | Global feed | ~62k req/s | p99 1.4 ms |

- **Tests:** `cargo test` covers the parse rules, grammar, state transitions, quotas, feed
  merging, log recovery and the shared fixtures.

Configuration is in [`server/.env.example`](server/.env.example).

## Migration from near.social (SocialDB)

On first sign-in, `/onboarding` checks `GET /v1/legacy/{account}`, which reads `social.near`
through api.near.social (falling back to RPC). It offers to import:

- **The profile:** name, bio, links. The avatar and banner are re-uploaded to FastFS through the
  server's SSRF-guarded image proxy, which handles IPFS, URLs and NFTs.
- **The outgoing follow graph:** batched about 250 keys per transaction.

The user signs these writes, since FastData keys are owned by their author.

## Roadmap

- Relayed meta-transactions (NEP-366), so users need no NEAR. The standard already supports
  them, because the author is the receipt predecessor.
- Non-extractable WebCrypto keys.
- Full-text search.
- DMs and lists (namespaces reserved).
