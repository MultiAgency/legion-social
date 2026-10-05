/**
 * Wallet selector + modal. This module is only ever loaded with `import()` (see
 * `wallet-loader.ts`) so none of the wallet code lands in the initial bundle.
 *
 * The wallet is used only for: sign-in, the one-time AddKey of the app posting key, key
 * rotation, and revoke. Every post/like/follow is signed locally with the app key instead.
 */
import "./buffer-polyfill";
// modal-ui/styles.css minus its Google Fonts @import (see scripts/sync-wallet-modal-css.mjs).
import "./wallet-modal.css";
import { setupWalletSelector, type Wallet, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHotWallet } from "@near-wallet-selector/hot-wallet";
import { setupIntearWallet } from "@near-wallet-selector/intear-wallet";
import { setupSender } from "@near-wallet-selector/sender";
import { setupLedger } from "@near-wallet-selector/ledger";
import { setupNightly } from "@near-wallet-selector/nightly";
import { PublicKey } from "@near-js/crypto";
import { actionCreators, type Action } from "@near-js/transactions";
import { env } from "@/lib/env";
import { SigningError } from "./errors";
import { disconnectWallet, signInWith } from "./wallet-session";

export const POSTING_METHODS = ["__fastdata_kv", "__fastdata_fastfs"];

const NETWORKS = {
  mainnet: {
    networkId: "mainnet",
    helperUrl: "https://helper.mainnet.near.org",
    explorerUrl: "https://nearblocks.io",
    indexerUrl: "https://api.fastnear.com",
  },
  testnet: {
    networkId: "testnet",
    helperUrl: "https://helper.testnet.near.org",
    explorerUrl: "https://testnet.nearblocks.io",
    indexerUrl: "https://test.api.fastnear.com",
  },
} as const;

interface Instance {
  selector: WalletSelector;
  modal: WalletSelectorModal;
}

let instance: Promise<Instance> | null = null;

export function getWalletSelector(theme: "dark" | "light" = "dark"): Promise<Instance> {
  instance ??= (async () => {
    const selector = await setupWalletSelector({
      network: { ...NETWORKS[env.networkId], nodeUrl: env.rpcUrl },
      modules: [
        setupMeteorWallet(),
        setupMyNearWallet(),
        setupHotWallet(),
        setupIntearWallet(),
        setupSender(),
        setupNightly(),
        setupLedger(),
      ],
    });
    const modal = setupModal(selector, {
      theme,
      description:
        "Connect your NEAR account. You'll approve one posting key next, then post without popups.",
    });
    return { selector, modal };
  })().catch((err) => {
    instance = null;
    throw err;
  });
  return instance;
}

function activeAccounts(selector: WalletSelector): string[] {
  return selector.store.getState().accounts.map((a) => a.accountId);
}

/** Opens the wallet modal and resolves with the signed-in account (see wallet-session.ts). */
export async function signInWithModal(theme?: "dark" | "light"): Promise<string> {
  const { selector, modal } = await getWalletSelector(theme);
  return signInWith(selector, modal);
}

/** Returns a wallet signed in as `accountId`, asking the user to connect it if needed. */
async function walletFor(accountId: string, theme?: "dark" | "light"): Promise<Wallet> {
  const { selector } = await getWalletSelector(theme);
  if (selector.isSignedIn() && activeAccounts(selector).includes(accountId)) {
    selector.setActiveAccount(accountId);
    return selector.wallet();
  }
  const signed = await signInWithModal(theme);
  if (signed !== accountId) {
    throw new SigningError(
      "wallet_rejected",
      `Your wallet is connected as ${signed}. Connect ${accountId} to approve this.`,
    );
  }
  return selector.wallet();
}

/** One wallet approval for `actions` on the account itself (also used by lib/legion/feed-send). */
export async function send(accountId: string, actions: Action[], theme?: "dark" | "light") {
  const wallet = await walletFor(accountId, theme);
  try {
    return await wallet.signAndSendTransaction({
      signerId: accountId,
      receiverId: accountId,
      actions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SigningError("wallet_rejected", message || "The wallet rejected the transaction.", err);
  }
}

/** `NEXT_PUBLIC_KEY_ALLOWANCE_NEAR` in yoctoNEAR (1 NEAR = 10^24 yocto). */
export function allowanceYocto(): bigint {
  const micro = BigInt(Math.round(env.keyAllowanceNear * 1_000_000));
  return micro * BigInt(10) ** BigInt(18);
}

function addPostingKeyAction(publicKey: string): Action {
  return actionCreators.addKey(
    PublicKey.fromString(publicKey),
    actionCreators.functionCallAccessKey(env.socialAccountId, POSTING_METHODS, allowanceYocto()),
  );
}

/** One wallet approval: AddKey(app key, FunctionCall to `social`, posting methods, allowance). */
export async function addPostingKey(accountId: string, publicKey: string, theme?: "dark" | "light") {
  await send(accountId, [addPostingKeyAction(publicKey)], theme);
}

/** One wallet approval: `[AddKey(new), DeleteKey(old)]`. */
export async function rotatePostingKey(
  accountId: string,
  oldPublicKey: string | null,
  newPublicKey: string,
  theme?: "dark" | "light",
) {
  const actions = [addPostingKeyAction(newPublicKey)];
  if (oldPublicKey) actions.push(actionCreators.deleteKey(PublicKey.fromString(oldPublicKey)));
  await send(accountId, actions, theme);
}

/** One wallet approval: DeleteKey(app key). */
export async function revokePostingKey(accountId: string, publicKey: string, theme?: "dark" | "light") {
  await send(accountId, [actionCreators.deleteKey(PublicKey.fromString(publicKey))], theme);
}

/** Signs the wallet out (best effort; the next sign-in retries if it didn't stick). */
export async function walletSignOut(): Promise<void> {
  try {
    const { selector } = await getWalletSelector();
    await disconnectWallet(selector);
  } catch {
    /* wallet selector unavailable */
  }
}
