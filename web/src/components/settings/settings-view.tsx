"use client";

import * as React from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  Copy,
  Download,
  KeyRound,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  RotateCw,
  Sun,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { useAccount, PostingKeyHelp } from "@/components/providers/account-provider";
import { HelpTip } from "@/components/common/help-tip";
import { allowanceOf } from "@/lib/near/rpc";
import { setMuted, useHydrated, useMutes } from "@/lib/local-store";
import { env } from "@/lib/env";
import { PageHeader } from "@/components/shell/page-header";
import { SignOutDialog } from "@/components/shell/account-menu";
import { UserAvatar } from "@/components/account/user-avatar";
import { EmptyState, Spinner } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const YOCTO_PER_WRITE = BigInt(10) ** BigInt(21); // ≈0.001 NEAR per small write

function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-16 border-b px-4 py-6">
      <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
      {description && <p className="mt-1 text-[15px] text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SettingsView() {
  const { accountId, ready, requireSignIn } = useAccount();
  if (!accountId) {
    return (
      <>
        <PageHeader title="Settings" />
        {ready ? (
          <EmptyState title="Sign in to manage your settings">
            <Button className="mt-4" onClick={() => requireSignIn()}>
              Sign in
            </Button>
          </EmptyState>
        ) : (
          <Spinner />
        )}
        <AppearanceSection />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Settings" subtitle={`@${accountId}`} />
      <PostingKeySection />
      <MutesSection />
      <AppearanceSection />
      <Section
        title="Import from near.social"
        description="Bring over your near.social profile and the accounts you followed."
      >
        <Button variant="outline" asChild>
          <Link href="/onboarding?rerun=1">
            <Download />
            Re-run import from near.social
          </Link>
        </Button>
      </Section>
      <AccountSection />
    </>
  );
}

function PostingKeySection() {
  const { keyStatus, publicKey, accessKey, enablePosting, rotateKey, refreshKey, busy } = useAccount();
  const allowance = allowanceOf(accessKey);
  const initial = BigInt(Math.round(env.keyAllowanceNear * 1_000_000)) * BigInt(10) ** BigInt(18);
  const writesLeft = allowance !== null ? allowance / YOCTO_PER_WRITE : null;
  const pct = allowance !== null && initial > BigInt(0) ? Number((allowance * BigInt(1000)) / initial) / 10 : 0;
  const nearLeft = allowance !== null ? Number(allowance / BigInt(10) ** BigInt(18)) / 1_000_000 : null;

  const status: Record<typeof keyStatus, { label: string; variant: "primary" | "destructive" | "default" }> = {
    active: { label: "On", variant: "primary" },
    checking: { label: "Checking…", variant: "default" },
    missing: { label: "Needs setup", variant: "destructive" },
    none: { label: "Off", variant: "default" },
    unknown: { label: "Can't check right now", variant: "default" },
  };

  return (
    <Section
      id="posting-key"
      title="Posting"
      description={
        <>
          Post, like and follow without wallet popups. <PostingKeyHelp />
        </>
      }
    >
      <div className="rounded-2xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="size-5 text-link" />
            <span className="font-semibold">Posting key</span>
          </div>
          <Badge variant={status[keyStatus].variant}>{status[keyStatus].label}</Badge>
        </div>
        {keyStatus === "active" && writesLeft !== null && (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold">≈{Number(writesLeft).toLocaleString()} posts & likes left</span>
              <HelpTip label="About the allowance">
                <p>
                  {nearLeft?.toFixed(4)} of {env.keyAllowanceNear} NEAR gas allowance left. A post or
                  like uses about 0.001 NEAR; images use more. Rotate the key to get a fresh
                  allowance.
                </p>
                {publicKey && (
                  <div className="mt-3 flex items-center gap-1">
                    <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
                      {publicKey}
                    </code>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Copy public key"
                      onClick={() => void navigator.clipboard?.writeText(publicKey).then(() => toast.success("Copied"))}
                    >
                      <Copy />
                    </Button>
                  </div>
                )}
              </HelpTip>
            </div>
            <Progress
              value={pct}
              className="mt-2"
              indicatorClassName={cn(pct < 10 ? "bg-destructive" : pct < 30 ? "bg-amber-500" : "bg-primary")}
            />
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {keyStatus === "none" || keyStatus === "missing" ? (
            <Button onClick={() => void enablePosting()} disabled={busy === "enable"}>
              {busy === "enable" ? <Loader2 className="animate-spin" /> : <KeyRound />}
              Enable posting
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void rotateKey()} disabled={busy === "rotate"}>
              {busy === "rotate" ? <Loader2 className="animate-spin" /> : <RotateCw />}
              Rotate key
            </Button>
          )}
          <Button variant="ghost" onClick={() => void refreshKey()}>
            <RefreshCw />
            Refresh
          </Button>
        </div>
      </div>
    </Section>
  );
}

function MutesSection() {
  const mutes = useMutes();
  return (
    <Section
      title="Muted accounts"
      description="Muted accounts are hidden from your feeds on this device only."
    >
      {mutes.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">You haven&apos;t muted anyone.</p>
      ) : (
        <ul className="divide-y rounded-2xl border">
          {mutes.map((a) => (
            <li key={a} className="flex items-center gap-3 px-4 py-3">
              <UserAvatar accountId={a} size={32} />
              <Link href={`/${a}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                @{a}
              </Link>
              <Button size="sm" variant="outline" onClick={() => setMuted(a, false)}>
                <VolumeX />
                Unmute
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const mounted = useHydrated();
  const options = [
    { value: "dark", label: "Dark", icon: Moon },
    { value: "light", label: "Light", icon: Sun },
    { value: "system", label: "System", icon: Monitor },
  ];
  return (
    <Section title="Appearance">
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
        {options.map((o) => {
          const active = mounted && theme === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(o.value)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-2xl border p-4 text-sm font-semibold transition-colors hover:bg-accent",
                active && "border-primary bg-primary/10",
              )}
            >
              <o.icon className="size-5" />
              {o.label}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function AccountSection() {
  const [open, setOpen] = React.useState(false);
  return (
    <Section title="Account">
      <Button variant="destructive-outline" onClick={() => setOpen(true)}>
        <LogOut />
        Sign out or revoke key
      </Button>
      <SignOutDialog open={open} onOpenChange={setOpen} />
    </Section>
  );
}
