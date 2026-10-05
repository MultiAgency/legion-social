/**
 * Writes to a feed: the same `__fastdata_kv` call as to `social`, sent to the feed account and
 * signed with a posting key for that receiver. A function-call key names one receiver, so each feed
 * has its own key, added with one wallet approval the first time (docs/LEGION.md §3).
 */
import type { KeyPair, KeyPairString } from "@near-js/crypto";
import { SigningError } from "@/lib/near/errors";
import { publicKeyFromSecret } from "@/lib/near/keystore";
import { sendSocialCall, type SendOptions } from "@/lib/near/queue";
import { viewAccessKey } from "@/lib/near/rpc";
import { loadWallet } from "@/lib/near/wallet-loader";

const loadCrypto = () => import("@near-js/crypto");

/** localStorage slot of `accountId`'s posting key for `channel`. */
export function channelKeySlot(accountId: string, channel: string): string {
  return `nsk:ch:v1:${accountId}:${channel}`;
}

function read(slot: string): string | null {
  try {
    return window.localStorage.getItem(slot);
  } catch {
    return null;
  }
}

async function keyPair(slot: string): Promise<KeyPair | null> {
  const raw = read(slot);
  if (!raw) return null;
  const { KeyPair } = await loadCrypto();
  try {
    return KeyPair.fromString(raw as KeyPairString);
  } catch {
    return null;
  }
}

async function waitForKey(accountId: string, publicKey: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await viewAccessKey(accountId, publicKey).catch(() => null)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/** The account's key for `channel`, active on chain; asks the wallet to add one if needed. */
export async function channelKey(accountId: string, channel: string): Promise<KeyPair> {
  const slot = channelKeySlot(accountId, channel);
  let kp = await keyPair(slot);
  if (kp && (await viewAccessKey(accountId, kp.getPublicKey().toString()).catch(() => null))) return kp;
  if (!kp) {
    const { KeyPair } = await loadCrypto();
    const secret = KeyPair.fromRandom("ed25519").toString();
    try {
      // Stored like upstream's posting key (keystore.ts): a function-call key that can't move funds.
      window.localStorage.setItem(slot, secret);
    } catch {
      throw new SigningError("no_local_key", "This browser can't store a posting key.");
    }
    kp = await keyPair(slot);
  }
  const publicKey = publicKeyFromSecret(read(slot) ?? "");
  if (!kp || !publicKey) throw new SigningError("no_local_key", "Couldn't create a posting key.");
  const wallet = await loadWallet();
  await wallet.addChannelKey(accountId, publicKey, channel);
  if (!(await waitForKey(accountId, publicKey, 30_000))) {
    throw new SigningError(
      "access_key_not_found",
      `The posting key for ${channel} isn't visible yet. Try again in a moment.`,
    );
  }
  return kp;
}

/** Sends one `__fastdata_kv` call to `channel`, adding its posting key first if needed. */
export async function sendChannelCall(
  accountId: string,
  channel: string,
  args: Uint8Array,
  opts: SendOptions = {},
): Promise<string> {
  const keyPair = await channelKey(accountId, channel);
  return sendSocialCall(accountId, "__fastdata_kv", args, { ...opts, keyPair, receiverId: channel });
}
