"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { profileQuery } from "@/lib/api/queries";
import { errorMessage } from "@/lib/near/errors";
import {
  createNextKey,
  discardNextKey,
  getOrCreateKey,
  getPublicKey,
  listKeyAccounts,
  promoteNextKey,
  removeKey,
  subscribeKeys,
} from "@/lib/near/keystore";
import { removeFeedKeys } from "@/lib/legion/feed-send";
import { viewAccessKey, type AccessKeyView } from "@/lib/near/rpc";
import { loadWallet, preloadWallet } from "@/lib/near/wallet-loader";
import { isOnboarded, readLocal, subscribeLocal, useHydrated, writeLocal } from "@/lib/local-store";
import { isAccountId } from "@/lib/social/standard";
import { readViewerCookie, setViewerCookie } from "@/lib/viewer-cookie";
import { env } from "@/lib/env";
import Link from "next/link";
import { HelpTip } from "@/components/common/help-tip";
import { sleep } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SESSION_KEY = "ns:session";

/**
 * - `none`: no posting key in this browser
 * - `checking`: local key exists, on-chain status being verified
 * - `active`: local key exists and is on the account
 * - `missing`: local key exists but isn't on the account (AddKey not done, or revoked)
 * - `unknown`: the RPC couldn't be reached
 */
export type KeyStatus = "none" | "checking" | "active" | "missing" | "unknown";

type Busy = null | "sign-in" | "enable" | "rotate" | "revoke";
type Prompt = null | "sign-in" | "enable-posting";

export interface AccountContextValue {
  accountId: string | null;
  /** True once the browser session has been read. */
  ready: boolean;
  keyStatus: KeyStatus;
  /** The posting key exists in this browser AND on the account (verified via RPC). */
  hasKey: boolean;
  /**
   * Writes may be attempted: a local key exists and isn't known to be missing on chain (true
   * while the on-chain check is in flight or the RPC is unreachable; the send surfaces errors).
   */
  canWrite: boolean;
  publicKey: string | null;
  accessKey: AccessKeyView | null;
  /** Accounts with a posting key in this browser (for the account switcher). */
  keyAccounts: string[];
  busy: Busy;
  signIn: () => Promise<string | null>;
  enablePosting: () => Promise<boolean>;
  rotateKey: () => Promise<boolean>;
  revokeAndSignOut: () => Promise<boolean>;
  signOut: () => Promise<void>;
  switchAccount: (accountId: string) => void;
  refreshKey: () => Promise<void>;
  /** Returns true if the user can write now; otherwise opens the sign-in / enable dialog. */
  requireKey: () => boolean;
  /** Returns true if signed in; otherwise opens the sign-in dialog. */
  requireSignIn: () => boolean;
}

const AccountContext = React.createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const ctx = React.useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside <AccountProvider>");
  return ctx;
}

function useKeyAccounts(): string[] {
  const cache = React.useRef<{ raw: string; list: string[] }>({ raw: "", list: [] });
  return React.useSyncExternalStore(
    subscribeKeys,
    () => {
      const list = listKeyAccounts();
      const raw = list.join(",");
      if (raw !== cache.current.raw) cache.current = { raw, list };
      return cache.current.list;
    },
    () => cache.current.list,
  );
}

async function pollAccessKey(accountId: string, publicKey: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const ak = await viewAccessKey(accountId, publicKey);
      if (ak) return ak;
    } catch {
      /* keep trying */
    }
    if (Date.now() > deadline) return null;
    await sleep(1500);
  }
}

function isCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /cancel|reject|denied|closed/i.test(msg);
}

function readSession(): string | null {
  const v = readLocal(SESSION_KEY);
  return v && isAccountId(v) ? v : null;
}

const accessKeyQueryKey = (accountId: string | null, publicKey: string | null) =>
  ["near", "access-key", accountId, publicKey] as const;

export function AccountProvider({
  initialViewer,
  children,
}: {
  initialViewer: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { resolvedTheme } = useTheme();
  const theme: "dark" | "light" = resolvedTheme === "light" ? "light" : "dark";

  // The browser session (localStorage) is the source of truth; the server renders with the
  // cookie hint, and hydration starts from it.
  const accountId = React.useSyncExternalStore(subscribeLocal, readSession, () => initialViewer);
  const ready = useHydrated();
  const [busy, setBusy] = React.useState<Busy>(null);
  const [prompt, setPrompt] = React.useState<Prompt>(null);
  const keyAccounts = useKeyAccounts();
  const publicKey = React.useSyncExternalStore(
    subscribeKeys,
    () => (accountId ? getPublicKey(accountId) : null),
    () => null,
  );
  const onboardChecked = React.useRef<string | null>(null);

  // Keep the cookie hint in sync (and refresh server components when it changes).
  React.useEffect(() => {
    if (!ready) return;
    if (readViewerCookie() !== accountId) {
      setViewerCookie(accountId);
      router.refresh();
    } else if (accountId) {
      setViewerCookie(accountId); // extend expiry
    }
  }, [ready, accountId, router]);

  const applySession = React.useCallback((next: string | null) => {
    writeLocal(SESSION_KEY, next);
  }, []);

  // On-chain status of the local posting key.
  const keyQuery = useQuery({
    queryKey: accessKeyQueryKey(accountId, publicKey),
    queryFn: () => viewAccessKey(accountId!, publicKey!),
    enabled: ready && !!accountId && !!publicKey,
    staleTime: 60_000,
    retry: 1,
  });
  const keyStatus: KeyStatus = !accountId || !publicKey
    ? "none"
    : keyQuery.isPending
      ? "checking"
      : keyQuery.isError
        ? "unknown"
        : keyQuery.data
          ? "active"
          : "missing";
  const accessKey = keyQuery.data ?? null;
  const setAccessKey = React.useCallback(
    (a: string, pk: string, ak: AccessKeyView | null) => qc.setQueryData(accessKeyQueryKey(a, pk), ak),
    [qc],
  );
  const refetchKey = keyQuery.refetch;
  const refreshKey = React.useCallback(async () => {
    await refetchKey();
  }, [refetchKey]);

  const maybeOnboard = React.useCallback(
    async (a: string) => {
      if (onboardChecked.current === a) return;
      onboardChecked.current = a;
      if (isOnboarded(a) || window.location.pathname.startsWith("/onboarding")) return;
      try {
        const profile = await qc.fetchQuery(profileQuery(a, a));
        if (!profile.has_profile && !isOnboarded(a)) router.push("/onboarding");
      } catch {
        /* API down: don't force onboarding */
      }
    },
    [qc, router],
  );

  React.useEffect(() => {
    if (ready && accountId && !pathname.startsWith("/onboarding")) void maybeOnboard(accountId);
  }, [ready, accountId, pathname, maybeOnboard]);

  const signIn = React.useCallback(async (): Promise<string | null> => {
    setBusy("sign-in");
    try {
      const w = await loadWallet();
      const a = await w.signInWithModal(theme);
      setPrompt(null);
      applySession(a);
      toast.success(`Signed in as @${a}`);
      return a;
    } catch (err) {
      if (!isCancel(err)) toast.error(errorMessage(err));
      return null;
    } finally {
      setBusy(null);
    }
  }, [applySession, theme]);

  const enablePosting = React.useCallback(async (): Promise<boolean> => {
    const a = accountId;
    if (!a) {
      setPrompt("sign-in");
      return false;
    }
    setBusy("enable");
    try {
      const publicKey = await getOrCreateKey(a);
      let walletError: unknown = null;
      try {
        const w = await loadWallet();
        await w.addPostingKey(a, publicKey, theme);
      } catch (err) {
        walletError = err;
      }
      // Verify on chain: some wallets throw after success, others resolve before finality.
      const ak = await pollAccessKey(
        a,
        publicKey,
        walletError ? (isCancel(walletError) ? 0 : 4000) : 30_000,
      );
      if (ak) {
        setAccessKey(a, publicKey, ak);
        setPrompt(null);
        toast.success("Posting enabled. No more wallet popups.");
        return true;
      }
      if (walletError) {
        if (!isCancel(walletError)) toast.error(errorMessage(walletError));
      } else {
        toast.error("The key was sent but isn't visible yet. Try again in a moment.");
      }
      void qc.invalidateQueries({ queryKey: accessKeyQueryKey(a, publicKey) });
      return false;
    } finally {
      setBusy(null);
    }
  }, [accountId, qc, setAccessKey, theme]);

  const rotateKey = React.useCallback(async (): Promise<boolean> => {
    const a = accountId;
    if (!a) return false;
    setBusy("rotate");
    try {
      const oldPk = getPublicKey(a);
      let oldOnChain = false;
      if (oldPk) {
        try {
          oldOnChain = (await viewAccessKey(a, oldPk)) !== null;
        } catch {
          oldOnChain = false;
        }
      }
      const newPk = await createNextKey(a);
      let walletError: unknown = null;
      try {
        const w = await loadWallet();
        await w.rotatePostingKey(a, oldOnChain ? oldPk : null, newPk, theme);
      } catch (err) {
        walletError = err;
      }
      const ak = await pollAccessKey(
        a,
        newPk,
        walletError ? (isCancel(walletError) ? 0 : 4000) : 30_000,
      );
      if (ak) {
        setAccessKey(a, newPk, ak);
        promoteNextKey(a);
        toast.success("Posting key rotated with a fresh allowance.");
        return true;
      }
      discardNextKey(a);
      if (walletError && !isCancel(walletError)) toast.error(errorMessage(walletError));
      else if (!walletError) toast.error("The new key isn't visible yet. Try again in a moment.");
      return false;
    } finally {
      setBusy(null);
    }
  }, [accountId, setAccessKey, theme]);

  const finishSignOut = React.useCallback(
    (a: string) => {
      removeKey(a);
      removeFeedKeys(a);
      const others = listKeyAccounts().filter((x) => x !== a);
      applySession(others[0] ?? null);
      void loadWallet()
        .then((w) => w.walletSignOut())
        .catch(() => undefined);
    },
    [applySession],
  );

  const signOut = React.useCallback(async () => {
    if (!accountId) return;
    finishSignOut(accountId);
    toast("Signed out");
  }, [accountId, finishSignOut]);

  const revokeAndSignOut = React.useCallback(async (): Promise<boolean> => {
    const a = accountId;
    if (!a) return false;
    setBusy("revoke");
    try {
      const pk = getPublicKey(a);
      if (pk) {
        let onChain = false;
        try {
          onChain = (await viewAccessKey(a, pk)) !== null;
        } catch {
          onChain = true;
        }
        if (onChain) {
          const w = await loadWallet();
          await w.revokePostingKey(a, pk, theme);
        }
      }
      finishSignOut(a);
      toast.success("Posting key revoked. Signed out.");
      return true;
    } catch (err) {
      if (!isCancel(err)) toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  }, [accountId, finishSignOut, theme]);

  const switchAccount = React.useCallback(
    (a: string) => {
      if (a !== accountId) applySession(a);
    },
    [accountId, applySession],
  );

  const hasKey = keyStatus === "active";
  const canWrite = publicKey !== null && keyStatus !== "missing" && keyStatus !== "none";

  const requireSignIn = React.useCallback(() => {
    if (accountId) return true;
    preloadWallet(theme);
    setPrompt("sign-in");
    return false;
  }, [accountId, theme]);

  const requireKey = React.useCallback(() => {
    if (!accountId) {
      preloadWallet(theme);
      setPrompt("sign-in");
      return false;
    }
    if (!canWrite) {
      preloadWallet(theme);
      setPrompt("enable-posting");
      return false;
    }
    return true;
  }, [accountId, canWrite, theme]);

  const value = React.useMemo<AccountContextValue>(
    () => ({
      accountId,
      ready,
      keyStatus,
      hasKey,
      canWrite,
      publicKey,
      accessKey,
      keyAccounts,
      busy,
      signIn,
      enablePosting,
      rotateKey,
      revokeAndSignOut,
      signOut,
      switchAccount,
      refreshKey,
      requireKey,
      requireSignIn,
    }),
    [
      accountId,
      ready,
      keyStatus,
      publicKey,
      accessKey,
      hasKey,
      canWrite,
      keyAccounts,
      busy,
      signIn,
      enablePosting,
      rotateKey,
      revokeAndSignOut,
      signOut,
      switchAccount,
      refreshKey,
      requireKey,
      requireSignIn,
    ],
  );

  return (
    <AccountContext.Provider value={value}>
      {children}
      <Dialog open={prompt !== null} onOpenChange={(o) => !o && setPrompt(null)}>
        <DialogContent className="max-w-md">
          {prompt === "sign-in" ? (
            <>
              <div className="grid size-12 place-items-center rounded-2xl bg-primary/15 text-link">
                <Wallet className="size-6" />
              </div>
              <DialogHeader>
                <DialogTitle>Join the conversation</DialogTitle>
                <DialogDescription>
                  Sign in with your NEAR account to post, reply, like and follow.
                </DialogDescription>
              </DialogHeader>
              <Button size="lg" onClick={() => void signIn()} disabled={busy === "sign-in"}>
                {busy === "sign-in" ? <Loader2 className="animate-spin" /> : <Wallet />}
                Connect wallet
              </Button>
            </>
          ) : prompt === "enable-posting" ? (
            <EnablePostingBody busy={busy === "enable"} onEnable={() => void enablePosting()} />
          ) : null}
        </DialogContent>
      </Dialog>
    </AccountContext.Provider>
  );
}

export function EnablePostingBody({
  busy,
  onEnable,
}: {
  busy: boolean;
  onEnable: () => void;
}) {
  return (
    <>
      <div className="grid size-12 place-items-center rounded-2xl bg-primary/15 text-link">
        <KeyRound className="size-6" />
      </div>
      <DialogHeader>
        <DialogTitle>Enable posting</DialogTitle>
        <DialogDescription>
          Approve once in your wallet. After that, posting, liking and following happen instantly,
          with no popups. <PostingKeyHelp />
        </DialogDescription>
      </DialogHeader>
      <Button size="lg" onClick={onEnable} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
        {busy ? "Waiting for your wallet…" : "Enable posting"}
      </Button>
    </>
  );
}

/** What "Enable posting" does, behind a (?) popover. */
export function PostingKeyHelp() {
  return (
    <HelpTip label="About posting">
      <p className="font-semibold text-foreground">How posting works</p>
      <ul className="mt-2 list-disc space-y-1.5 pl-4">
        <li>Your wallet adds a posting key that can only write to near.social. It can&apos;t move your funds.</li>
        <li>It comes with a {env.keyAllowanceNear} NEAR gas allowance, enough for thousands of posts.</li>
        <li>It stays in this browser. Rotate or revoke it any time in Settings.</li>
      </ul>
      <Link href="/docs" className="mt-2 inline-block font-medium text-link hover:underline">
        Learn more
      </Link>
    </HelpTip>
  );
}
