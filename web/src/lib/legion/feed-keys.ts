/**
 * Feed posting keys in this browser (docs/LEGION.md §3). They live in upstream's keystore
 * (keystore.ts) under the id `{account}:{feed}`; a `:` never appears in an account id, so the
 * keystore's account list never shows them. Light on purpose: the account provider loads this
 * module up front, so the wallet and transaction code stay behind dynamic imports.
 */
import { getPublicKey, removeKey } from "@/lib/near/keystore";
import { viewAccessKey } from "@/lib/near/rpc";
import { loadWallet } from "@/lib/near/wallet-loader";

const PREFIX = "nsk:v1:";

/** The keystore id of `accountId`'s posting key for `feed`. */
export function feedKeyId(accountId: string, feed: string): string {
  return `${accountId}:${feed}`;
}

/** Keystore ids of this account's feed keys in this browser. */
function feedKeyIds(accountId: string): string[] {
  const prefix = `${PREFIX}${accountId}:`;
  try {
    const s = window.localStorage;
    return Array.from({ length: s.length }, (_, i) => s.key(i)).flatMap((k) =>
      k?.startsWith(prefix) ? [k.slice(PREFIX.length)] : [],
    );
  } catch {
    return [];
  }
}

/** Forgets this account's feed keys in this browser (plain sign-out). Their on-chain keys stay. */
export function removeFeedKeys(accountId: string): void {
  feedKeyIds(accountId).forEach(removeKey);
}

/**
 * Revoke and sign out: one wallet approval that deletes the account's social posting key (when
 * given) and every feed key of this browser that's on chain. A key that isn't on chain is left out,
 * since deleting it would fail the whole transaction; one that can't be checked is included, as
 * for the social key.
 */
export async function revokePostingKeys(
  accountId: string,
  socialKey: string | null,
  theme?: "dark" | "light",
): Promise<void> {
  const feedKeys = await Promise.all(
    feedKeyIds(accountId).map(async (id) => {
      const publicKey = getPublicKey(id);
      if (!publicKey) return null;
      const onChain = await viewAccessKey(accountId, publicKey).then((k) => k !== null, () => true);
      return onChain ? publicKey : null;
    }),
  );
  const keys = [socialKey, ...feedKeys].filter((k): k is string => k !== null);
  if (keys.length === 0) return;
  const [w, { PublicKey }, { actionCreators }] = await Promise.all([
    loadWallet(),
    import("@near-js/crypto"),
    import("@near-js/transactions"),
  ]);
  await w.send(accountId, keys.map((k) => actionCreators.deleteKey(PublicKey.fromString(k))), theme);
}
