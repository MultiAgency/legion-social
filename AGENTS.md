# Working on legion-social

Read by Claude Code (through `CLAUDE.md`) and by MultiAgency's agents. legion-social is a NEAR Legion layer on near.social: a fork of [near-social-kv](https://github.com/evgenykuzyakov/near-social-kv) whose indexer shows only Legion members, ranked by their soulbound tokens, and adds Legion features. Members' writes are ordinary social-kv/1 writes to `social`, so near.social shows them too. The README explains the system; `docs/STANDARD.md` is the data standard, `docs/LEGION.md` the Legion extension to it.

## Before you change code

- Verify with the checks CI runs. None needs credentials or network:
  - `cargo clippy --all-targets -- -D warnings`
  - `cargo test`
  - `npm --prefix web ci`, then `npm --prefix web run lint`, `npm --prefix web run typecheck` and `npm --prefix web test`
- For a bug, first write a test that fails on it, then fix the code until it passes.
- Plan non-trivial changes before writing them: a **Plan** section in the PR body.

## Staying close to upstream

This is a fork, and upstream keeps moving. Every upstream change we can take cleanly is work we don't do.

- Put Legion code in its own modules (`server/src/legion/`, `web/src/lib/legion/`, `web/src/components/legion/`) and keep edits to upstream files to the few lines that call into them.
- Legion behavior turns on with `LEGION_CONTRACTS`. With it unset, the server behaves exactly like upstream, and upstream's tests pass unchanged.
- Don't reformat upstream code: it is not rustfmt-clean, and a formatting diff conflicts with every rebase. That is why CI runs no `cargo fmt --check`.

## Contracts

- **The standard:** `docs/STANDARD.md` is upstream's social-kv/1. Don't change it here. Legion keys live under `legion/` and are specified in `docs/LEGION.md`; a change to a key's format changes its parser (`server/src/model/`), the web validator (`web/src/lib/social/standard.ts`) and their tests together.
- **Membership is derived, never written.** It comes from the Legion SBT contracts on mainnet (`initiate.`, `ascendant.` and `vanguard.nearlegion.near`), and nothing a user writes to `social` can make them a member or raise their rank.
- **The API:** `/v1` responses are read by the web app and by agents (`SKILL.md`). Add fields; don't rename or remove them.

## Pull requests

- Agents author PRs under their own GitHub identity (`multi-agency` for MultiAgency's agents). A MultiAgency owner reviews, approves and merges.
- PRs go against `staging`; `main` takes owner-only release PRs from `staging`.
- Fill in the template's **Plan** and **Verification**. Each PR also gets an AI review against `REVIEW.md`.
- PR bodies and commit messages carry the change's own description only, with no tool attribution lines.

## Known traps

- The server's state lives in memory and is rebuilt from `DATA_DIR/kv.jsonl` on boot. A first start needs `START_BLOCK_HEIGHT`; `python3 scripts/gen_demo_log.py` makes a demo log that needs no chain access.
- Every `social` receipt fails on chain (there is no contract). That's by design: confirm writes with `GET /v1/tx/{hash}`.
- `NEXT_PUBLIC_*` variables are compiled into the web bundle at build time.
- Agent tokens can't create or change `.github/workflows/`, because workflows run with the repository's secrets. Put a workflow change in the PR description, and a MultiAgency owner commits it to the branch.
