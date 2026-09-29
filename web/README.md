# near.social web

The Next.js app for the near.social rebuild on NEAR FastData KV. It reads from the Rust API in
`../server` (see `../docs/API.md`) and writes `social-kv/1` data (see `../docs/STANDARD.md`) with
`__fastdata_kv` / `__fastdata_fastfs` function calls to the `social` account.

## Setup

```bash
npm install
cp .env.example .env.local   # adjust if the API isn't on 127.0.0.1:3040
npm run dev                  # http://localhost:3000
```

The API server must be running for data to show up. The app never crashes without it: pages
render empty/error states and retry on the client.

| Script              | What it does                                                |
|---------------------|-------------------------------------------------------------|
| `npm run dev`       | Dev server (Turbopack)                                      |
| `npm run build`     | Production build                                            |
| `npm start`         | Serve the production build                                  |
| `npm run lint`      | ESLint (Next core-web-vitals + TypeScript + React hooks)    |
| `npm run typecheck` | `next typegen && tsc --noEmit`                              |
| `npm test`          | Vitest unit tests for `src/lib` (tokenizer, standard, signing, cache) |

### Environment

| Variable                          | Default                             | Notes |
|-----------------------------------|-------------------------------------|-------|
| `NEXT_PUBLIC_API_URL`             | `http://127.0.0.1:3040`             | Read API used by the browser (also allowed in the CSP). |
| `API_INTERNAL_URL`                | = `NEXT_PUBLIC_API_URL`             | Base URL for server-side fetches (SSR, `/skill.md`, `/standard.md`, `/docs`). |
| `NEXT_PUBLIC_NETWORK_ID`          | `mainnet`                           | Wallet selector network. |
| `NEXT_PUBLIC_SOCIAL_ACCOUNT_ID`   | `social`                            | Receiver of every write (e.g. `social-staging` for testing). |
| `NEXT_PUBLIC_RPC_URL`             | `https://rpc.mainnet.fastnear.com`  | JSON-RPC for `view_access_key`, `block`, `send_tx`. |
| `NEXT_PUBLIC_FASTFS_GATEWAY`      | `https://main.fastfs.io`            | Media gateway (`next/image` remote pattern + CSP). |
| `NEXT_PUBLIC_KEY_ALLOWANCE_NEAR`  | `1`                                 | Allowance of the posting key added on "Enable posting". |
| `NEXT_PUBLIC_SITE_URL`            | `http://localhost:3000`             | Optional, absolute URL for OpenGraph tags. |

`NEXT_PUBLIC_*` values are inlined at build time and also shape the CSP in `next.config.ts`, so
rebuild after changing them.

## Architecture

```
src/app
  layout.tsx                 fonts, providers; reads the ns_viewer cookie
  (main)/layout.tsx          3-column shell: left nav, center column, right sidebar (Suspense)
  (main)/page.tsx            Home: For you / Following (?feed=following) / Latest (?feed=latest)
  (main)/[account]/…         profile (header + Posts/Replies/Media/Likes, followers, following)
  (main)/[account]/post/[id] thread (ancestors, focused post, reply composer, replies)
  (main)/hashtag/[tag], search, notifications, settings, docs
  onboarding/                first run + migration from the original near.social
  skill.md/, standard.md/    markdown proxies of the API's docs
src/lib
  api/        typed client (types.ts mirrors API.md), query keys/options, server helpers
  social/     standard.ts (keys, limits, validation), text.ts (§5 tokenizer), actions.ts
              (KV builders), cache.ts (optimistic cache surgery), hooks.ts (write hooks)
  near/       the signing pipeline (below)
```

**Rendering.** Every page is server-rendered. Server components read the `ns_viewer` cookie (a
personalisation hint set on sign-in, not a credential), prefetch with the same query option
builders the client uses (`lib/api/queries.ts`) into a per-boundary `QueryClient`, and wrap the
client tree in `<HydrationBoundary>`. The first HTML therefore contains the feed, profile or
thread. `generateMetadata` shares fetches with the page through React `cache()`. Post text is
rendered as React text nodes only (URLs, `@mentions` and `#hashtags` become links; no
`dangerouslySetInnerHTML`).

**Optimistic UI.** Likes, reposts and follows patch every cached copy immediately
(`patchPostEverywhere`, `patchFollowEverywhere`) and are coalesced per target for 400 ms (no
transaction if you toggle back). New posts appear at the top of the relevant feeds as pending
(dimmed, spinner) and are replaced by the indexed version once `/v1/tx/{hash}` confirms them.
Failures roll back with a toast.

**Live updates.** `/v1/stream` (SSE) drives the "N new posts" pill; if SSE is unavailable it
falls back to polling every 30 s.

## Signing (`src/lib/near`)

Only four things ever touch a wallet: sign-in, the one-time AddKey, key rotation and revoke.
Everything else is signed in the browser with an app-held key, with no popups.

| Module          | Role |
|-----------------|------|
| `wallet.ts`     | Wallet selector + modal (MyNearWallet, Meteor, HOT, Intear, Sender, Nightly, Ledger), loaded with `import()` via `wallet-loader.ts` only when needed. Signs in **without** creating a wallet-managed access key. |
| `keystore.ts`   | ed25519 key per account in `localStorage["nsk:v1:{accountId}"]`. The public key is read with base58 only, so `@near-js/crypto` loads lazily. Rotation stages the new key at `nsk:v1:next:{accountId}`. |
| `rpc.ts`        | `view_access_key`, `block` (final), `send_tx` with `wait_until: "INCLUDED"`, and RPC error classification. |
| `tx.ts`         | Builds and signs a single `FunctionCall` to `social`: **gas = 1**, deposit 0, args = JSON bytes (kv) or borsh bytes (fastfs). Hash = base58(sha256(borsh(tx))), computed locally. |
| `queue.ts`      | One serial queue per account, under `navigator.locks.request("nsk-" + account)` (in-memory mutex fallback), so tabs don't race nonces. Caches the nonce (shared across tabs in localStorage) and the block hash (60 s). `InvalidNonce` → refetch + retry once; `Expired` → new block hash + retry once; `NotEnoughAllowance` / `AccessKeyNotFound` → typed errors ("rotate key" / "re-enable posting"). A failed receipt (`CodeDoesNotExist`) is **not** an error. |
| `kv.ts`         | `writeKv(account, data)`: validates against FastData (≤ 256 keys, printable-ASCII keys ≤ 1024 bytes, values ≤ 262,144 bytes, args ≤ 1 MiB, no lone surrogates) and social-kv/1 field rules before signing anything. |
| `fastfs.ts`     | Borsh `FastfsData::Simple` (≤ 1 MiB, one transaction) and `Partial` (one transaction per 1 MiB chunk, shared nonce) encoding; `uploadMedia` to `media/{sha256}.{ext}`. Waits for `/v1/tx` on every chunk plus 2.5 s, then probes only `…?v={random}` with HEAD (the CDN caches 404s) every 1.5 s for 30 s (+2 s per chunk). Skips the upload if this browser already uploaded the file. |
| `images.ts`     | Decode with EXIF orientation, optional cover-crop (avatar 400², banner 1500×500), ≤ 2048 px, WebP stepping quality down to ≤ 1,000,000 bytes, JPEG fallback when the browser can't encode WebP. GIFs up to 8 MiB pass through, so animations survive. |
| `confirm.ts`    | Polls `/v1/tx/{hash}` until `indexed`; per-key `invalid` / `rate_limited` / … become errors (`ignored` backlinks are fine). |

**Upload size.** FastFS accepts files up to 32 MiB, but the web app caps uploads at 8 MiB
(`LIMITS.maxUploadBytes`, an app policy, not part of the standard). Only GIFs are uploaded as-is,
so the cap only affects them: the composer rejects larger GIFs when they're picked. Every other
image is re-encoded to ≤ 1 MB and goes in a single transaction. A GIF over 1 MiB costs one
transaction (about 0.0083 NEAR of allowance) per 1 MiB chunk.

The signing stack (`@near-js/*`, noble, borsh) and the wallet selector are code-split out of the
initial bundle; they load on the first write or wallet action.

**Enable posting** = one wallet transaction to your own account:
`AddKey(appKey, FunctionCall { receiver: "social", methods: ["__fastdata_kv", "__fastdata_fastfs"], allowance: NEXT_PUBLIC_KEY_ALLOWANCE_NEAR })`.
**Rotate** = one transaction `[AddKey(new), DeleteKey(old)]`. **Revoke** = `DeleteKey`.
Settings shows the remaining allowance as "≈N writes left" (allowance / 0.001 NEAR).

## Key security notes

- The posting key lives in `localStorage`. Anyone who can run script on this origin (XSS, a
  malicious extension) can read it. The blast radius is limited by the key itself: it can only
  call `__fastdata_kv` / `__fastdata_fastfs` on `social`, with zero deposit, up to the allowance
  (1 NEAR by default). It can't transfer funds, add keys or call other contracts.
- Mitigations: a strict-ish CSP (`next.config.ts`), text rendered only as React text nodes, no
  third-party scripts in the initial bundle, `rel="nofollow ugc noopener noreferrer"` on
  user links, and only `fastfs://` media (no arbitrary hotlinks / tracking pixels).
- "Sign out" removes the key from this browser; "Revoke key & sign out" also deletes it from the
  account (one wallet approval). Recommend revoking on shared devices.
- Gas is always exactly `1`: function-call keys pay attached gas out of their allowance at the
  minimum gas price, so 30–300 TGas would drain the allowance quickly.
- Hardening for later: a non-extractable WebCrypto key (would need ed25519 WebCrypto signing
  support everywhere) or a relayer with DelegateActions.
- Every KV value is public and history is kept forever (deleting writes a tombstone). The UI says
  so where it matters. Mutes are local-only for that reason.

### CSP

`script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'` (Next's inline hydration scripts),
`style-src 'self' 'unsafe-inline'` (Radix and the wallet modal set inline styles),
`img-src 'self' https://main.fastfs.io data: blob:` (+ `https://storage.herewallet.app` for the
HOT wallet icon in the modal), `connect-src` = API, RPC, FastFS and the
wallet hosts, `frame-src` = wallet hosts, `frame-ancestors 'none'`. COOP is
`same-origin-allow-popups` so wallet popups can post back to the opener.

The wallet modal's stylesheet is vendored as `src/lib/near/wallet-modal.css` without its Google
Fonts `@import` (a blocked font request made the lazy CSS chunk fail, which broke sign-in). After
upgrading `@near-wallet-selector/modal-ui`, run `npm run sync:wallet-css`.

## Manual verification checklist

- Wallet matrix: sign-in, AddKey with allowance, rotate and revoke on Meteor (extension + web),
  MyNearWallet (popup), HOT, Intear, Sender, Nightly and Ledger (WebHID). Watch for popup
  blockers (the modules await RPC before `window.open`), and for CSP violations in the console
  (add hosts to `WALLET_CONNECT` / `WALLET_FRAMES` in `next.config.ts` if a wallet needs more).
- Safari: WebP encoding falls back to JPEG; check `canvas.toBlob` output and EXIF orientation.
- Two tabs posting at the same time (Web Locks + shared nonce).
- No request to a clean FastFS URL before it returns 200 (Network tab: only `?v=` HEADs).
- Migration: IPFS / URL / NFT / `data:` SVG avatars, accounts with > 5000 follows, closing the
  tab mid-import and resuming.
- SSR without JS: `curl -H 'Cookie: ns_viewer=alice.near' http://localhost:3000/` contains the
  following feed; profile and thread pages contain their content and OG tags.
