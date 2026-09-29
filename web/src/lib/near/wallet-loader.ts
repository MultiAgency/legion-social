/**
 * Lazy entry point for the wallet selector. Keeps wallet code out of the initial bundle; call
 * `preloadWallet()` on hover/focus of wallet buttons so the popup opens within the user gesture.
 */
export type WalletModule = typeof import("./wallet");

let pending: Promise<WalletModule> | null = null;

export function loadWallet(): Promise<WalletModule> {
  pending ??= import("./wallet").catch((err) => {
    pending = null;
    throw err;
  });
  return pending;
}

export function preloadWallet(theme?: "dark" | "light"): void {
  if (typeof window === "undefined") return;
  void loadWallet()
    .then((w) => w.getWalletSelector(theme))
    .catch(() => undefined);
}
