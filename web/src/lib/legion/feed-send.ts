/**
 * Writes to a feed: the same `__fastdata_kv` call as to `social`, sent to the feed account and
 * signed with a posting key for that receiver. A function-call key names one receiver, so each feed
 * has its own key, added with one wallet approval the first time (docs/LEGION.md §3).
 *
 * Feed keys live in upstream's keystore (keystore.ts), under the id `{account}:{feed}`. A `:` never
 * appears in an account id, so the keystore's account list never shows them.
 */
import type { KeyPair } from "@near-js/crypto";
import { SigningError } from "@/lib/near/errors";
import { getKeyPair, getOrCreateKey, getPublicKey, removeKey } from "@/lib/near/keystore";
import { sendSocialCall, type SendOptions } from "@/lib/near/queue";
import { viewAccessKey } from "@/lib/near/rpc";
import { loadWallet } from "@/lib/near/wallet-loader";

/** The keystore id of `accountId`'s posting key for `feed`. */
export function feedKeyId(accountId: string, feed: string): string {
  return `${accountId}:${feed}`;
}

async function waitForKey(accountId: string, publicKey: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // Right after the wallet's AddKey, a failed lookup is worth retrying.
    if (await viewAccessKey(accountId, publicKey).catch(() => null)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * The account's key for `feed`, active on chain; asks the wallet to add one only when the chain
 * says the key doesn't exist. Any other RPC error is thrown as it is.
 */
export async function feedKey(accountId: string, feed: string): Promise<KeyPair> {
  const id = feedKeyId(accountId, feed);
  const existing = getPublicKey(id);
  if (existing && (await viewAccessKey(accountId, existing))) {
    const kp = await getKeyPair(id);
    if (kp) return kp;
  }
  const publicKey = existing ?? (await getOrCreateKey(id));
  const wallet = await loadWallet();
  await wallet.addChannelKey(accountId, publicKey, feed);
  if (!(await waitForKey(accountId, publicKey, 30_000))) {
    throw new SigningError(
      "access_key_not_found",
      `The posting key for ${feed} isn't visible yet. Try again in a moment.`,
    );
  }
  const kp = await getKeyPair(id);
  if (!kp) throw new SigningError("no_local_key", "Couldn't read the posting key.");
  return kp;
}

/** Sends one `__fastdata_kv` call to `feed`, adding its posting key first if needed. */
export async function sendChannelCall(
  accountId: string,
  feed: string,
  args: Uint8Array,
  opts: SendOptions = {},
): Promise<string> {
  const keyPair = await feedKey(accountId, feed);
  return sendSocialCall(accountId, "__fastdata_kv", args, { ...opts, keyPair, receiverId: feed });
}

/**
 * Forgets this account's feed keys in this browser, on sign-out. Their on-chain keys stay until
 * removed in the wallet: revoking them would take one wallet approval per feed.
 */
export function removeFeedKeys(accountId: string): void {
  const prefix = `nsk:v1:${accountId}:`;
  let ids: string[] = [];
  try {
    const s = window.localStorage;
    ids = Array.from({ length: s.length }, (_, i) => s.key(i)).flatMap((k) =>
      k?.startsWith(prefix) ? [k.slice("nsk:v1:".length)] : [],
    );
  } catch {
    return;
  }
  ids.forEach(removeKey);
}
