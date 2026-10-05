/**
 * App-held ed25519 posting keys, one per account, in localStorage `nsk:v1:{accountId}` (the
 * secret key string, `ed25519:<base58(seed ‖ public key)>`).
 *
 * The key is a function-call access key limited to receiver `social` and the methods
 * `__fastdata_kv` / `__fastdata_fastfs`, with a small allowance. It can't transfer funds.
 * A pending key (during rotation) lives at `nsk:v1:next:{accountId}` until it's confirmed
 * on chain.
 *
 * Reading the public key needs only base58, so the crypto libraries (`@near-js/crypto`) are
 * loaded lazily, when a key is created or used to sign.
 */
import type { KeyPair, KeyPairString } from "@near-js/crypto";
import { isAccountId } from "@/lib/social/standard";
import { base58Decode, base58Encode } from "./base58";

export const PREFIX = "nsk:v1:";
const NEXT_PREFIX = "nsk:v1:next:";

export function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const loadCrypto = () => import("@near-js/crypto");

/** `ed25519:<seed ‖ pk>` → `ed25519:<pk>` (the last 32 bytes of the extended secret key). */
export function publicKeyFromSecret(secret: string): string | null {
  if (!secret.startsWith("ed25519:")) return null;
  try {
    const bytes = base58Decode(secret.slice("ed25519:".length));
    if (bytes.length !== 64) return null;
    return `ed25519:${base58Encode(bytes.slice(32))}`;
  } catch {
    return null;
  }
}

export function getSecret(accountId: string): string | null {
  return storage()?.getItem(PREFIX + accountId) ?? null;
}

const publicKeyCache = new Map<string, string | null>();

/** Public key of the account's posting key in this browser, or null. */
export function getPublicKey(accountId: string): string | null {
  const raw = getSecret(accountId);
  if (!raw) return null;
  if (!publicKeyCache.has(raw)) publicKeyCache.set(raw, publicKeyFromSecret(raw));
  return publicKeyCache.get(raw) ?? null;
}

/** The signing key (loads the crypto library). */
export async function getKeyPair(accountId: string): Promise<KeyPair | null> {
  const raw = getSecret(accountId);
  if (!raw) return null;
  const { KeyPair } = await loadCrypto();
  try {
    return KeyPair.fromString(raw as KeyPairString);
  } catch {
    return null;
  }
}

async function generate(): Promise<string> {
  const { KeyPair } = await loadCrypto();
  return KeyPair.fromRandom("ed25519").toString();
}

/** Returns the public key of the existing key, or creates and stores a new one. */
export async function getOrCreateKey(accountId: string): Promise<string> {
  const existing = getPublicKey(accountId);
  if (existing) return existing;
  const secret = await generate();
  storage()?.setItem(PREFIX + accountId, secret);
  notify();
  return publicKeyFromSecret(secret)!;
}

export function removeKey(accountId: string): void {
  const s = storage();
  if (!s) return;
  s.removeItem(PREFIX + accountId);
  s.removeItem(NEXT_PREFIX + accountId);
  // Drop cached nonces for this account's keys (see queue.ts).
  const nonceSlots: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(`nsk:nonce:${accountId}:`)) nonceSlots.push(k);
  }
  nonceSlots.forEach((k) => s.removeItem(k));
  notify();
}

/* Rotation: the new key is stored aside until the wallet transaction lands. */

/** Creates the pending rotation key and returns its public key. */
export async function createNextKey(accountId: string): Promise<string> {
  const secret = await generate();
  storage()?.setItem(NEXT_PREFIX + accountId, secret);
  return publicKeyFromSecret(secret)!;
}

export function promoteNextKey(accountId: string): void {
  const s = storage();
  const next = s?.getItem(NEXT_PREFIX + accountId);
  if (!s || !next) return;
  s.setItem(PREFIX + accountId, next);
  s.removeItem(NEXT_PREFIX + accountId);
  notify();
}

export function discardNextKey(accountId: string): void {
  storage()?.removeItem(NEXT_PREFIX + accountId);
}

/** Accounts that have a posting key in this browser. */
export function listKeyAccounts(): string[] {
  const s = storage();
  if (!s) return [];
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k || !k.startsWith(PREFIX) || k.startsWith(NEXT_PREFIX)) continue;
    const account = k.slice(PREFIX.length);
    if (isAccountId(account)) out.push(account);
  }
  return out.sort();
}

/* Change notifications (same tab + other tabs via the storage event). */

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

export function subscribeKeys(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(PREFIX)) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
