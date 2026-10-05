/**
 * Writes to a feed: the same `__fastdata_kv` call as to `social`, sent to the feed account and
 * signed with a posting key for that receiver. A function-call key names one receiver, so each feed
 * has its own key, added with one wallet approval the first time (docs/LEGION.md §3). Loaded only
 * with the write path (`lib/near/kv`).
 */
import type { KeyPair } from "@near-js/crypto";
import { PublicKey } from "@near-js/crypto";
import { actionCreators } from "@near-js/transactions";
import { SigningError } from "@/lib/near/errors";
import { getKeyPair, getOrCreateKey, getPublicKey } from "@/lib/near/keystore";
import { sendSocialCall, type SendOptions } from "@/lib/near/queue";
import { viewAccessKey } from "@/lib/near/rpc";
import { loadWallet } from "@/lib/near/wallet-loader";
import { feedKeyId } from "./feed-keys";

/** Whether a wallet error means the person cancelled (as the account provider reads it). */
function isCancel(err: unknown): boolean {
  return /cancel|reject|denied|closed/i.test(err instanceof Error ? err.message : String(err));
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

/** One wallet approval: AddKey(key, FunctionCall to `feed`, `__fastdata_kv`, the usual allowance). */
async function addFeedKey(accountId: string, publicKey: string, feed: string): Promise<void> {
  const w = await loadWallet();
  const permission = actionCreators.functionCallAccessKey(feed, ["__fastdata_kv"], w.allowanceYocto());
  await w.send(accountId, [actionCreators.addKey(PublicKey.fromString(publicKey), permission)]);
}

/**
 * The account's key for `feed`, active on chain. Asks the wallet to add one only when the chain
 * says the key doesn't exist; any other RPC error is thrown as it is. Like enabling posting, it
 * checks the chain even after a wallet error, since some wallets throw after the key was added.
 */
export async function feedKey(accountId: string, feed: string): Promise<KeyPair> {
  const id = feedKeyId(accountId, feed);
  const existing = getPublicKey(id);
  if (existing && (await viewAccessKey(accountId, existing))) {
    const kp = await getKeyPair(id);
    if (kp) return kp;
  }
  const publicKey = existing ?? (await getOrCreateKey(id));
  let walletError: unknown = null;
  try {
    await addFeedKey(accountId, publicKey, feed);
  } catch (err) {
    walletError = err;
  }
  const timeout = walletError ? (isCancel(walletError) ? 0 : 4000) : 30_000;
  if (!(await waitForKey(accountId, publicKey, timeout))) {
    if (walletError) throw walletError;
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
