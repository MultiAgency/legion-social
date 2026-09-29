/**
 * One serial write queue per account.
 *
 * Every write for an account runs inside `navigator.locks.request("nsk-" + accountId)` (with an
 * in-memory mutex as fallback and as the in-tab ordering), so two tabs never race nonces. The
 * last used nonce is shared across tabs through localStorage and read inside the lock; the
 * block hash is cached for 60 s.
 */
import type { KeyPair } from "@near-js/crypto";
import { baseDecode } from "@near-js/utils";
import { SigningError } from "./errors";
import { getKeyPair } from "./keystore";
import { classifyTxError, finalBlock, sendTx, viewAccessKey } from "./rpc";
import { buildSignedTx, type SocialMethod } from "./tx";

const BLOCK_HASH_TTL_MS = 60_000;

/* ------------------------------------------------------------------------------------------ */
/* Locks                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const tails = new Map<string, Promise<unknown>>();

/** In-memory mutex: runs `fn` after every previously queued job for `name`. */
export function withMemoryLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(name) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(name, tail);
  void tail.then(() => {
    if (tails.get(name) === tail) tails.delete(name);
  });
  return run;
}

function withWebLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks && typeof locks.request === "function") {
    return locks.request(name, () => fn()) as Promise<T>;
  }
  return fn();
}

/** Runs `job` exclusively for `accountId`, across tabs when Web Locks are available. */
export function enqueue<T>(accountId: string, job: () => Promise<T>): Promise<T> {
  const name = `nsk-${accountId}`;
  return withMemoryLock(name, () => withWebLock(name, job));
}

/* ------------------------------------------------------------------------------------------ */
/* Nonce and block hash caches                                                                */
/* ------------------------------------------------------------------------------------------ */

let blockCache: { hash: Uint8Array; at: number } | null = null;

async function recentBlockHash(force: boolean): Promise<Uint8Array> {
  if (!force && blockCache && Date.now() - blockCache.at < BLOCK_HASH_TTL_MS) {
    return blockCache.hash;
  }
  const block = await finalBlock();
  blockCache = { hash: baseDecode(block.header.hash), at: Date.now() };
  return blockCache.hash;
}

const memoryNonces = new Map<string, bigint>();

function nonceSlot(accountId: string, publicKey: string) {
  return `nsk:nonce:${accountId}:${publicKey}`;
}

function readStoredNonce(slot: string): bigint | null {
  let best = memoryNonces.get(slot) ?? null;
  try {
    const raw = window.localStorage.getItem(slot);
    if (raw && /^\d+$/.test(raw)) {
      const n = BigInt(raw);
      if (best === null || n > best) best = n;
    }
  } catch {
    /* storage unavailable */
  }
  return best;
}

function storeNonce(slot: string, nonce: bigint) {
  memoryNonces.set(slot, nonce);
  try {
    window.localStorage.setItem(slot, nonce.toString());
  } catch {
    /* storage unavailable */
  }
}

async function nextNonce(accountId: string, keyPair: KeyPair, refresh: boolean): Promise<bigint> {
  const publicKey = keyPair.getPublicKey().toString();
  const slot = nonceSlot(accountId, publicKey);
  let last = refresh ? null : readStoredNonce(slot);
  if (last === null) {
    const ak = await viewAccessKey(accountId, publicKey);
    if (!ak) {
      throw new SigningError(
        "access_key_not_found",
        "Your posting key isn't active on this account. Enable posting again.",
      );
    }
    last = BigInt(ak.nonce);
    const cached = refresh ? null : readStoredNonce(slot);
    if (cached !== null && cached > last) last = cached;
  }
  const next = last + BigInt(1);
  storeNonce(slot, next);
  return next;
}

/* ------------------------------------------------------------------------------------------ */
/* Sending                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export interface SendOptions {
  /** Called right after the transaction is signed (before broadcast). */
  onSigned?: (hash: string) => void;
}

/**
 * Signs and sends one FunctionCall to `social` with the account's app key, serialized per
 * account. Resolves with the tx hash once the transaction is included in a block.
 *
 * A failed receipt (`CodeDoesNotExist`, the normal outcome) is not an error: FastData indexes
 * the call regardless. Confirm the result through `/v1/tx/{hash}`.
 */
export function sendSocialCall(
  accountId: string,
  methodName: SocialMethod,
  args: Uint8Array,
  opts: SendOptions = {},
): Promise<string> {
  return enqueue(accountId, async () => {
    const keyPair = await getKeyPair(accountId);
    if (!keyPair) {
      throw new SigningError("no_local_key", "Enable posting to write from this browser.");
    }
    let refreshNonce = false;
    let refreshBlock = false;
    let retriedNonce = false;
    let retriedBlock = false;

    for (;;) {
      const nonce = await nextNonce(accountId, keyPair, refreshNonce);
      const blockHash = await recentBlockHash(refreshBlock);
      const signed = buildSignedTx({
        signerId: accountId,
        keyPair,
        nonce,
        blockHash,
        methodName,
        args,
      });
      opts.onSigned?.(signed.hash);
      try {
        await sendTx(signed.base64);
        return signed.hash;
      } catch (err) {
        if (err instanceof SigningError) throw err;
        const kind = classifyTxError(err);
        switch (kind) {
          case "invalid_nonce":
            if (retriedNonce) break;
            retriedNonce = true;
            refreshNonce = true;
            continue;
          case "expired":
            if (retriedBlock) break;
            retriedBlock = true;
            refreshBlock = true;
            continue;
          case "timeout":
            // The node accepted it but didn't see it included in time; /v1/tx confirms.
            return signed.hash;
          case "not_enough_allowance":
            throw new SigningError(
              "not_enough_allowance",
              "Your posting key ran out of allowance. Rotate it in Settings.",
              err,
            );
          case "access_key_not_found":
            throw new SigningError(
              "access_key_not_found",
              "Your posting key isn't active on this account. Enable posting again.",
              err,
            );
          case "not_enough_balance":
            throw new SigningError(
              "not_enough_balance",
              "Your account doesn't have enough NEAR to pay for gas.",
              err,
            );
          default:
            break;
        }
        throw new SigningError(
          "rpc_error",
          `Transaction failed: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
    }
  });
}
