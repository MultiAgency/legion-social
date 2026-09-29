"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  KeyRound,
  Loader2,
  PartyPopper,
  Wallet,
} from "lucide-react";
import { useAccount, PostingKeyHelp } from "@/components/providers/account-provider";
import { api } from "@/lib/api/client";
import { accountListQuery, legacyQuery, profileQuery, qk } from "@/lib/api/queries";
import type { LegacyAccount, Profile } from "@/lib/api/types";
import { confirmTx } from "@/lib/near/confirm";
import { errorMessage, isSigningError } from "@/lib/near/errors";
import type { KvData } from "@/lib/near/kv";
import { preloadWallet } from "@/lib/near/wallet-loader";
import { setOnboarded } from "@/lib/local-store";
import {
  buildProfileWrite,
  draftFromProfile,
  type ProfileDraft,
  type SaveStep,
} from "@/lib/social/profile-draft";
import { isAccountId, isService, keys, LIMITS, validateProfileLink } from "@/lib/social/standard";
import { BrandMark, Wordmark } from "@/components/brand";
import { UserAvatar } from "@/components/account/user-avatar";
import { draftIsValid, ProfileFields, useObjectUrls } from "@/components/profile/profile-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const STEPS = ["Connect", "Enable posting", "Profile", "Import"] as const;
const FOLLOWS_PER_TX = 250;

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center justify-center gap-2" aria-label="Progress">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-7 place-items-center rounded-full border text-xs font-bold transition-colors",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary text-link",
                !done && !active && "text-muted-foreground",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("hidden text-sm sm:inline", active ? "font-semibold" : "text-muted-foreground")}>
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-4 bg-border sm:w-6" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

function clamp(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const chars = [...value];
  return chars.length > max ? chars.slice(0, max).join("") : value;
}

/** Legacy linktree values: keep valid service names, upgrade http:// to https://. */
function sanitizeLegacyLinks(links: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [service, raw] of Object.entries(links ?? {})) {
    if (!isService(service) || typeof raw !== "string" || !raw.trim()) continue;
    const value = raw.trim().replace(/^http:\/\//i, "https://");
    if (validateProfileLink(value) === null) out[service] = value;
  }
  return out;
}

async function fetchAllFollowing(account: string): Promise<Set<string>> {
  const out = new Set<string>();
  let cursor: string | null = null;
  for (let i = 0; i < 100; i++) {
    const page = await api.following(account, { cursor, limit: 100 });
    for (const c of page.items) out.add(c.account_id);
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return out;
}

async function fetchLegacyImage(proxyPath: string): Promise<Blob | null> {
  try {
    const res = await fetch(api.legacyImageUrl(proxyPath), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

export function OnboardingView() {
  const { accountId, hasKey, keyStatus, signIn, enablePosting, busy, ready } = useAccount();
  const router = useRouter();

  const finish = React.useCallback(() => {
    if (accountId) setOnboarded(accountId);
    router.push("/");
  }, [accountId, router]);

  const step = !accountId ? 0 : !hasKey ? 1 : 2;

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center justify-between px-5 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <Wordmark className="text-lg" />
        </Link>
        {accountId && (
          <button type="button" onClick={finish} className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline">
            Skip for now
          </button>
        )}
      </header>
      <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-2">
        <Stepper current={step} />
        <div className="mt-8">
          {!ready ? (
            <Skeleton className="h-64 w-full rounded-2xl" />
          ) : step === 0 ? (
            <Card>
              <Icon><Wallet className="size-6" /></Icon>
              <h1 className="mt-4 text-2xl font-extrabold tracking-tight">Welcome to near.social</h1>
              <p className="mt-2 text-muted-foreground">
                Connect your NEAR account. If you used the original near.social, we&apos;ll bring
                your profile and follows over.
              </p>
              <Button size="lg" className="mt-6 w-full" onMouseEnter={() => preloadWallet()} onClick={() => void signIn()} disabled={busy === "sign-in"}>
                {busy === "sign-in" ? <Loader2 className="animate-spin" /> : <Wallet />}
                Connect wallet
              </Button>
            </Card>
          ) : step === 1 ? (
            <Card>
              <div className="flex items-center gap-3">
                <UserAvatar accountId={accountId!} size={40} />
                <div>
                  <p className="text-sm text-muted-foreground">Connected as</p>
                  <p className="font-bold">@{accountId}</p>
                </div>
              </div>
              <Icon className="mt-6"><KeyRound className="size-6" /></Icon>
              <h1 className="mt-4 text-2xl font-extrabold tracking-tight">Enable posting</h1>
              <p className="mt-2 text-muted-foreground">
                Approve once in your wallet. After that, posting, liking and following happen
                instantly, with no popups. <PostingKeyHelp />
              </p>
              <Button
                size="lg"
                className="mt-6 w-full"
                onMouseEnter={() => preloadWallet()}
                onClick={() => void enablePosting()}
                disabled={busy === "enable" || keyStatus === "checking"}
              >
                {busy === "enable" || keyStatus === "checking" ? <Loader2 className="animate-spin" /> : <KeyRound />}
                {busy === "enable" ? "Waiting for your wallet…" : "Enable posting"}
              </Button>
            </Card>
          ) : (
            <ProfileAndImport key={accountId} accountId={accountId!} onFinish={finish} />
          )}
        </div>
      </main>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-3xl border bg-card p-6 shadow-sm sm:p-8", className)}>{children}</section>;
}

function Icon({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid size-12 place-items-center rounded-2xl bg-primary/15 text-link", className)}>{children}</div>
  );
}

type ImportState =
  | { phase: "form" }
  | { phase: "importing"; label: string; done: number; total: number }
  | { phase: "error"; message: string }
  | { phase: "done"; follows: number };

function ProfileAndImport({ accountId, onFinish }: { accountId: string; onFinish: () => void }) {
  const qc = useQueryClient();
  const params = useSearchParams();
  const rerun = params.get("rerun") === "1";
  const legacy = useQuery(legacyQuery(accountId));
  const profile = useQuery(profileQuery(accountId, accountId));

  if (legacy.isPending || profile.isPending) {
    return (
      <Card>
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Looking for your near.social profile…
        </div>
        <Skeleton className="mt-6 h-40 w-full rounded-xl" />
      </Card>
    );
  }

  return (
    <ImportForm
      accountId={accountId}
      legacy={legacy.data ?? null}
      legacyError={legacy.isError}
      profile={profile.data ?? null}
      rerun={rerun}
      onFinish={onFinish}
      onImported={() => {
        void qc.invalidateQueries({ queryKey: qk.profiles });
        void qc.invalidateQueries({ queryKey: qk.accountLists });
        void qc.invalidateQueries({ queryKey: qk.feeds });
      }}
    />
  );
}

function ImportForm({
  accountId,
  legacy,
  legacyError,
  profile,
  rerun,
  onFinish,
  onImported,
}: {
  accountId: string;
  legacy: LegacyAccount | null;
  legacyError: boolean;
  profile: Profile | null;
  rerun: boolean;
  onFinish: () => void;
  onImported: () => void;
}) {
  const makeUrl = useObjectUrls();
  const hasLegacy = !!legacy?.exists;
  const original = React.useMemo(() => draftFromProfile(profile), [profile]);
  const [draft, setDraft] = React.useState<ProfileDraft>(() => {
    if (!hasLegacy || !legacy?.profile || (profile?.has_profile && !rerun)) return original;
    const lp = legacy.profile;
    return {
      ...original,
      name: clamp(lp.name, LIMITS.profileName) ?? original.name,
      about: clamp(lp.about, LIMITS.profileAbout) ?? original.about,
      location: clamp(lp.location, LIMITS.profileLocation) ?? original.location,
      links: { ...original.links, ...sanitizeLegacyLinks(lp.links) },
    };
  });
  const [imagesLoading, setImagesLoading] = React.useState(hasLegacy && !!(legacy?.avatar || legacy?.banner));

  // Load legacy avatar/banner through the API proxy (blob: previews; re-uploaded on import).
  React.useEffect(() => {
    if (!hasLegacy || !legacy) return;
    let cancelled = false;
    const tasks: Promise<void>[] = [];
    for (const field of ["avatar", "banner"] as const) {
      const src = legacy[field];
      if (!src) continue;
      tasks.push(
        fetchLegacyImage(src.proxy_url).then((blob) => {
          if (cancelled || !blob) return;
          setDraft((d) =>
            d[field].kind === "existing" && !rerun
              ? d
              : { ...d, [field]: { kind: "new", blob, previewUrl: makeUrl(blob) } },
          );
        }),
      );
    }
    void Promise.all(tasks).finally(() => {
      if (!cancelled) setImagesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [hasLegacy, legacy, makeUrl, rerun]);

  // Follow candidates.
  const legacyFollows = React.useMemo(
    () =>
      Array.from(new Set((legacy?.follows ?? []).filter((a) => isAccountId(a) && a !== accountId))),
    [legacy, accountId],
  );
  const suggestions = useInfiniteQuery({
    ...accountListQuery({ kind: "suggestions" }, accountId, 12),
    enabled: !hasLegacy,
  });
  const suggestionIds = React.useMemo(
    () => (suggestions.data?.pages[0]?.items ?? []).map((a) => a.account_id).filter((a) => a !== accountId),
    [suggestions.data, accountId],
  );
  const candidates = hasLegacy ? legacyFollows : suggestionIds;
  const [unchecked, setUnchecked] = React.useState<Set<string>>(new Set());
  const [checkedSuggestions, setCheckedSuggestions] = React.useState<Set<string>>(new Set());
  const [expanded, setExpanded] = React.useState(false);
  const selected = hasLegacy
    ? candidates.filter((a) => !unchecked.has(a))
    : candidates.filter((a) => checkedSuggestions.has(a));
  const capped = selected.slice(0, LIMITS.maxFollows);

  const [state, setState] = React.useState<ImportState>({ phase: "form" });
  const running = state.phase === "importing";

  const runImport = async () => {
    try {
      setState({ phase: "importing", label: "Preparing…", done: 0, total: 1 });
      const stepLabel: Record<SaveStep, string> = {
        avatar: "Uploading avatar…",
        banner: "Uploading banner…",
        saving: "Preparing…",
      };
      const profileData = await buildProfileWrite(accountId, draft, original, (s) =>
        setState({ phase: "importing", label: stepLabel[s], done: 0, total: 1 }),
      );

      // Resume without local state: only follows that aren't active yet.
      setState({ phase: "importing", label: "Checking who you already follow…", done: 0, total: 1 });
      const already = await fetchAllFollowing(accountId);
      const remaining = capped.filter((a) => !already.has(a));

      // Tx 1: all profile keys + as many follows as fit in 256 keys; then 250 follows per tx.
      const txs: KvData[] = [];
      const first: KvData = { ...profileData };
      let i = 0;
      while (i < remaining.length && Object.keys(first).length < LIMITS.maxKeys) {
        first[keys.follow(remaining[i++])] = {};
      }
      if (Object.keys(first).length > 0) txs.push(first);
      while (i < remaining.length) {
        const batch: KvData = {};
        for (const a of remaining.slice(i, i + FOLLOWS_PER_TX)) batch[keys.follow(a)] = {};
        i += FOLLOWS_PER_TX;
        txs.push(batch);
      }

      const { writeKv } = await import("@/lib/near/kv");
      const total = txs.length;
      let confirmed = 0;
      const confirmations: Promise<void>[] = [];
      for (let t = 0; t < txs.length; t++) {
        setState({
          phase: "importing",
          label: total > 1 ? `Sending ${t + 1} of ${total}…` : "Saving…",
          done: confirmed,
          total,
        });
        const hash = await writeKv(accountId, txs[t]);
        confirmations.push(
          confirmTx(hash)
            .catch((err) => {
              if (!isSigningError(err, "confirm_timeout")) throw err;
            })
            .then(() => {
              confirmed++;
              setState((s) => (s.phase === "importing" ? { ...s, done: confirmed } : s));
            }),
        );
      }
      setState({ phase: "importing", label: "Waiting for confirmations…", done: confirmed, total });
      await Promise.all(confirmations);
      onImported();
      setState({ phase: "done", follows: remaining.length });
    } catch (err) {
      setState({ phase: "error", message: errorMessage(err) });
    }
  };

  if (state.phase === "done") {
    return (
      <Card className="text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/15 text-link">
          <PartyPopper className="size-7" />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight">You&apos;re all set</h1>
        <p className="mt-2 text-muted-foreground">
          {state.follows > 0
            ? `Your profile is live and you now follow ${state.follows.toLocaleString()} accounts.`
            : "Your profile is live."}
        </p>
        <Button size="lg" className="mt-6 w-full" onClick={onFinish}>
          Go to your timeline
        </Button>
      </Card>
    );
  }

  const shownCandidates = expanded ? candidates : candidates.slice(0, 8);

  return (
    <Card>
      <h1 className="text-2xl font-extrabold tracking-tight">
        {hasLegacy ? "Welcome back from near.social" : "Set up your profile"}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {hasLegacy
          ? "We found your near.social profile. Review it, then import it along with the accounts you followed."
          : legacyError
            ? "We couldn't check the original near.social right now. You can set up a fresh profile."
            : "Add a name and a photo so people recognise you."}
      </p>
      {rerun && profile?.has_profile && hasLegacy && (
        <p className="mt-3 flex gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
          <AlertTriangle className="size-4 shrink-0 translate-y-0.5" />
          Importing overwrites the profile fields you change below.
        </p>
      )}

      <div className="mt-6">
        <ProfileFields accountId={accountId} draft={draft} onChange={setDraft} disabled={running} compact={!hasLegacy} />
        {imagesLoading && (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Fetching your near.social images…
          </p>
        )}
      </div>

      {candidates.length > 0 && (
        <div className="mt-8">
          <h2 className="font-bold">
            {hasLegacy
              ? `Follow the ${legacyFollows.length.toLocaleString()} accounts you followed on near.social`
              : "Suggested accounts"}
          </h2>
          {hasLegacy && legacy && (
            <p className="text-sm text-muted-foreground">
              {legacy.follows_on_network.toLocaleString()} already here
              {legacy.already_following > 0 && ` · you already follow ${legacy.already_following.toLocaleString()}`}
            </p>
          )}
          {selected.length > LIMITS.maxFollows && (
            <p className="mt-2 flex gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
              <AlertTriangle className="size-4 shrink-0 translate-y-0.5" />
              Only the first {LIMITS.maxFollows.toLocaleString()} follows are imported (the network&apos;s limit).
            </p>
          )}
          <ul className="mt-3 divide-y rounded-2xl border">
            {shownCandidates.map((a) => {
              const checked = hasLegacy ? !unchecked.has(a) : checkedSuggestions.has(a);
              return (
                <li key={a}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-accent/50">
                    <Checkbox
                      checked={checked}
                      disabled={running}
                      onCheckedChange={(v) => {
                        const on = v === true;
                        if (hasLegacy) {
                          setUnchecked((s) => {
                            const n = new Set(s);
                            if (on) n.delete(a);
                            else n.add(a);
                            return n;
                          });
                        } else {
                          setCheckedSuggestions((s) => {
                            const n = new Set(s);
                            if (on) n.add(a);
                            else n.delete(a);
                            return n;
                          });
                        }
                      }}
                    />
                    <UserAvatar accountId={a} size={28} />
                    <span className="min-w-0 truncate text-[15px]">@{a}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {candidates.length > 8 && (
            <button
              type="button"
              className="mt-2 flex items-center gap-1 text-sm font-medium text-link hover:underline"
              onClick={() => setExpanded((e) => !e)}
            >
              <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Show fewer" : `Show all ${candidates.length.toLocaleString()}`}
            </button>
          )}
          {hasLegacy && (
            <div className="mt-2 flex gap-3 text-sm">
              <button type="button" className="text-link hover:underline" onClick={() => setUnchecked(new Set())}>
                Select all
              </button>
              <button type="button" className="text-link hover:underline" onClick={() => setUnchecked(new Set(candidates))}>
                Select none
              </button>
            </div>
          )}
        </div>
      )}

      {state.phase === "importing" && (
        <div className="mt-8" aria-live="polite">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium">
              <Loader2 className="size-4 animate-spin" />
              {state.label}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {state.done}/{state.total}
            </span>
          </div>
          <Progress value={(state.done / Math.max(1, state.total)) * 100} className="mt-2" />
        </div>
      )}
      {state.phase === "error" && (
        <p className="mt-6 flex gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <AlertTriangle className="size-4 shrink-0 translate-y-0.5" />
          {state.message} Retrying picks up where it left off.
        </p>
      )}

      <div className="mt-8 flex flex-col gap-2 sm:flex-row-reverse">
        <Button
          size="lg"
          className="sm:flex-1"
          disabled={running || !draftIsValid(draft) || imagesLoading}
          onClick={() => void runImport()}
        >
          {running && <Loader2 className="animate-spin" />}
          {state.phase === "error"
            ? "Retry"
            : hasLegacy
              ? capped.length > 0
                ? `Import profile & ${capped.length.toLocaleString()} follows`
                : "Import profile"
              : capped.length > 0
                ? `Save & follow ${capped.length}`
                : "Save profile"}
        </Button>
        <Button size="lg" variant="ghost" disabled={running} onClick={onFinish}>
          Skip
        </Button>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">Your profile is public.</p>
    </Card>
  );
}
