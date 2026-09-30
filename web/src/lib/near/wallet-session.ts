/**
 * Sign-in / sign-out logic on top of the wallet selector, kept free of wallet modules so it can
 * be unit-tested.
 *
 * The selector remembers a connected wallet across page loads. If one is still connected when
 * the user signs in (e.g. a wallet that didn't disconnect on sign-out), the modal only shows it as
 * "Connection Successful" and never emits `signedIn`, so sign-in would hang. We disconnect it
 * first; if it won't disconnect, we sign in with the account it's connected as.
 */
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { SigningError } from "./errors";

const DISCONNECT_TIMEOUT_MS = 5_000;

/** The wallet's active account (or its first one). */
export function connectedAccount(selector: WalletSelector): string | null {
  const { accounts } = selector.store.getState();
  return (accounts.find((a) => a.active) ?? accounts[0])?.accountId ?? null;
}

/** Signs the connected wallet out. Returns whether the selector ended up signed out. */
export async function disconnectWallet(selector: WalletSelector): Promise<boolean> {
  if (!selector.isSignedIn()) return true;
  try {
    const wallet = await selector.wallet();
    await Promise.race([
      wallet.signOut(),
      new Promise((resolve) => setTimeout(resolve, DISCONNECT_TIMEOUT_MS)),
    ]);
  } catch {
    /* wallet unavailable */
  }
  return !selector.isSignedIn();
}

/** Opens the modal and resolves with the account the user signs in with. */
export async function signInWith(selector: WalletSelector, modal: WalletSelectorModal): Promise<string> {
  if (selector.isSignedIn() && !(await disconnectWallet(selector))) {
    const account = connectedAccount(selector);
    if (account) return account;
  }
  return new Promise<string>((resolve, reject) => {
    const signedIn = selector.on("signedIn", (e) => {
      const accountId = e.accounts.find((a) => a.accountId)?.accountId;
      if (!accountId) return;
      cleanup();
      modal.hide();
      resolve(accountId);
    });
    const hidden = modal.on("onHide", ({ hideReason }) => {
      if (hideReason !== "user-triggered") return;
      cleanup();
      reject(new SigningError("wallet_rejected", "Sign-in was cancelled."));
    });
    function cleanup() {
      signedIn.remove();
      hidden.remove();
    }
    modal.show();
  });
}
