# Review instructions

Every pull request gets these three passes. `AGENTS.md` defines the contracts and conventions they check against. Tag each finding with its pass and a severity.

## Passes

- **Bugs:** logic errors, broken edge cases, regressions, panics on input from chain (any account can write anything to `social`), state that diverges between a live run and a replay of `kv.jsonl`, and failures swallowed silently.
- **Security:** read every changed line in these high-risk paths:
  - `server/src/ingest/` and `server/src/state/`: what gets indexed, and what is hidden;
  - `server/src/legion/`: who counts as a member and at what rank;
  - `web/src/lib/near/`: keys, signing and what is sent on chain.

  Also check:
  - untrusted text (posts, profiles, links, API responses from other services) reaching HTML unescaped, or being rendered as Markdown or HTML when the standard says plain text;
  - anything a user can write to `social` that grants membership, rank or visibility;
  - secrets reaching logs, responses or the client bundle (`NEXT_PUBLIC_*`).
- **Compliance:**
  - the diff does what the PR body's **Plan** says, and its **Verification** is credible;
  - a bug fix comes with a test that fails without the fix;
  - a change to a key format changes its server parser, the web validator, `docs/LEGION.md` and their tests together;
  - Legion code stays in its own modules, and upstream files change only where they call into it (`AGENTS.md`, "Staying close to upstream");
  - with `LEGION_CONTRACTS` unset, behavior matches upstream.

## Severity

- **Important:** would break behavior, show a non-member as a member or at the wrong rank, sign or send something the user didn't ask for, leak a secret, or breach a contract in `AGENTS.md`.
- **Nit:** naming, style and wording. Report at most five, and summarize the rest as a count.

## Skip

`Cargo.lock`, `web/package-lock.json`, anything clippy, `cargo test` and the web lint, typecheck and tests already enforce, and formatting.
