/**
 * Confirms writes through the indexer (`GET /v1/tx/{hash}`), since the chain always reports
 * `__fastdata_kv` receipts as failed and FastData drops invalid writes silently.
 */
import { api } from "@/lib/api/client";
import type { TxOutcome } from "@/lib/api/types";
import { SigningError } from "./errors";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ConfirmOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

/** Polls `/v1/tx/{hash}` until `indexed: true`. Throws `confirm_timeout` after the deadline. */
export async function waitForTx(hash: string, opts: ConfirmOptions = {}): Promise<TxOutcome> {
  const { timeoutMs = 60_000, intervalMs = 1000, signal } = opts;
  const deadline = Date.now() + timeoutMs;
  let delay = Math.min(500, intervalMs);
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const outcome = await api.tx(hash, signal);
      if (outcome.indexed) return outcome;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      /* transient API errors: keep polling until the deadline */
    }
    if (Date.now() + delay > deadline) break;
    await sleep(delay);
    delay = intervalMs;
  }
  throw new SigningError(
    "confirm_timeout",
    "Sent, but the indexer hasn't confirmed it yet. It should show up shortly.",
  );
}

export interface OutcomeProblem {
  key?: string;
  status: string;
  reason?: string;
}

/** Everything the indexer didn't accept. `ignored` keys (e.g. `reply/…` backlinks) are fine. */
export function outcomeProblems(outcome: TxOutcome): OutcomeProblem[] {
  const problems: OutcomeProblem[] = [];
  for (const action of outcome.actions ?? []) {
    if (action.status !== "ok") {
      problems.push({ status: action.status });
      continue;
    }
    for (const k of action.keys) {
      if (k.status !== "ok" && k.status !== "ignored") {
        problems.push({ key: k.key, status: k.status, reason: k.reason });
      }
    }
  }
  return problems;
}

export function describeProblems(problems: OutcomeProblem[]): string {
  const first = problems[0];
  if (!first) return "";
  const what =
    first.status === "rate_limited"
      ? "rate limited (daily limit reached)"
      : first.status === "invalid" && first.reason
        ? `invalid: ${first.reason}`
        : first.status.replaceAll("_", " ");
  const more = problems.length > 1 ? ` (+${problems.length - 1} more)` : "";
  return first.key ? `${first.key}: ${what}${more}` : `${what}${more}`;
}

/** Waits for the indexer and throws `indexer_rejected` if any key wasn't accepted. */
export async function confirmTx(hash: string, opts?: ConfirmOptions): Promise<TxOutcome> {
  const outcome = await waitForTx(hash, opts);
  const problems = outcomeProblems(outcome);
  if (problems.length > 0) {
    throw new SigningError("indexer_rejected", describeProblems(problems), problems);
  }
  return outcome;
}
