import { describe, expect, it, vi } from "vitest";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { signInWith } from "../wallet-session";

type Handler = (e: never) => void;

/** A fake selector connected as `connected` (or not); `sticky` wallets ignore signOut. */
function fakeSelector(connected: string | null, sticky = false) {
  let accounts = connected ? [{ accountId: connected, active: true }] : [];
  const handlers: Record<string, Handler[]> = {};
  const signOut = vi.fn(async () => {
    if (!sticky) accounts = [];
  });
  const selector = {
    isSignedIn: () => accounts.length > 0,
    wallet: async () => ({ signOut }),
    store: { getState: () => ({ accounts }) },
    on: (event: string, h: Handler) => {
      (handlers[event] ??= []).push(h);
      return { remove: () => (handlers[event] = handlers[event].filter((x) => x !== h)) };
    },
  };
  const emitSignedIn = (accountId: string) => {
    accounts = [{ accountId, active: true }];
    for (const h of handlers.signedIn ?? []) h({ accounts: [{ accountId }] } as never);
  };
  return { selector: selector as unknown as WalletSelector, signOut, emitSignedIn };
}

function fakeModal() {
  const handlers: Handler[] = [];
  const modal = {
    show: vi.fn(),
    hide: vi.fn(),
    on: (_: string, h: Handler) => {
      handlers.push(h);
      return { remove: () => handlers.splice(handlers.indexOf(h), 1) };
    },
  };
  const close = () => handlers.forEach((h) => h({ hideReason: "user-triggered" } as never));
  return { modal: modal as unknown as WalletSelectorModal, close, show: modal.show, hide: modal.hide };
}

describe("signInWith", () => {
  it("signs in through the modal when no wallet is connected", async () => {
    const s = fakeSelector(null);
    const m = fakeModal();
    const result = signInWith(s.selector, m.modal);
    await vi.waitFor(() => expect(m.show).toHaveBeenCalled());
    s.emitSignedIn("alice.near");
    await expect(result).resolves.toBe("alice.near");
    expect(m.hide).toHaveBeenCalled();
  });

  it("disconnects a wallet left connected, then shows the modal (the bug: it hung)", async () => {
    const s = fakeSelector("old.near");
    const m = fakeModal();
    const result = signInWith(s.selector, m.modal);
    await vi.waitFor(() => expect(m.show).toHaveBeenCalled());
    expect(s.signOut).toHaveBeenCalled();
    s.emitSignedIn("new.near");
    await expect(result).resolves.toBe("new.near");
  });

  it("uses the connected account when the wallet won't disconnect", async () => {
    const s = fakeSelector("stuck.near", true);
    const m = fakeModal();
    await expect(signInWith(s.selector, m.modal)).resolves.toBe("stuck.near");
    expect(m.show).not.toHaveBeenCalled();
  });

  it("rejects when the user closes the modal", async () => {
    const s = fakeSelector(null);
    const m = fakeModal();
    const result = signInWith(s.selector, m.modal);
    await vi.waitFor(() => expect(m.show).toHaveBeenCalled());
    m.close();
    await expect(result).rejects.toThrow("cancelled");
  });
});
