"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";
import { useAccount } from "@/components/providers/account-provider";
import { UserAvatar } from "@/components/account/user-avatar";
import { BrandMark } from "@/components/brand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { preloadWallet } from "@/lib/near/wallet-loader";
import { cn } from "@/lib/utils";
import { AccountMenuItems, SignOutDialog, useOwnProfile } from "./account-menu";

function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Back"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/");
      }}
      className="-ml-2 grid size-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-accent"
    >
      <ArrowLeft className="size-5" />
    </button>
  );
}

/** Mobile-only avatar button that opens the account menu (or signs in). */
function MobileAccountButton() {
  const { accountId, signIn } = useAccount();
  const { data: profile } = useOwnProfile();
  const [signOutOpen, setSignOutOpen] = React.useState(false);
  if (!accountId) {
    return (
      <button
        type="button"
        onClick={() => void signIn()}
        onTouchStart={() => preloadWallet()}
        className="flex h-8 items-center gap-1.5 rounded-full bg-foreground px-3 text-sm font-semibold text-background"
      >
        <Wallet className="size-4" />
        Sign in
      </button>
    );
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Account menu" className="rounded-full">
            <UserAvatar accountId={accountId} src={profile?.avatar_url} size={32} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <AccountMenuItems onSignOut={() => setSignOutOpen(true)} />
        </DropdownMenuContent>
      </DropdownMenu>
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </>
  );
}

/**
 * Sticky page header. Top-level pages show the account button + brand on mobile; nested pages
 * show a back button.
 */
export function PageHeader({
  title,
  subtitle,
  back = false,
  brandOnMobile = false,
  children,
  className,
  right,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  back?: boolean;
  brandOnMobile?: boolean;
  children?: React.ReactNode;
  className?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className={cn("sticky top-0 z-20 border-b bg-background/80 backdrop-blur-xl", className)}>
      {(title || back || brandOnMobile) && (
        <div className="flex h-[53px] items-center gap-4 px-4">
          {back ? (
            <BackButton />
          ) : (
            <span className="sm:hidden">
              <MobileAccountButton />
            </span>
          )}
          {brandOnMobile && (
            <span className="absolute left-1/2 -translate-x-1/2 sm:hidden">
              <BrandMark className="size-7" />
            </span>
          )}
          <div className={cn("min-w-0 flex-1", brandOnMobile && "max-sm:invisible")}>
            {title && <h1 className="truncate text-xl font-bold leading-6 tracking-tight">{title}</h1>}
            {subtitle && <p className="truncate text-[13px] text-muted-foreground">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Link-based tabs for headers (server-navigable, keyboard accessible). `onActiveClick` runs
 * instead of navigating when the current tab is clicked again (e.g. to refresh a feed).
 */
export function HeaderTabs({
  tabs,
  replace = false,
  onActiveClick,
}: {
  tabs: { href: string; label: string; active: boolean }[];
  replace?: boolean;
  onActiveClick?: () => void;
}) {
  return (
    <nav className="scrollbar-none flex overflow-x-auto" aria-label="Tabs">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          replace={replace}
          scroll={false}
          onClick={(e) => {
            if (!t.active || !onActiveClick || e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            onActiveClick();
          }}
          aria-current={t.active ? "page" : undefined}
          className="relative flex h-[53px] min-w-fit flex-1 items-center justify-center px-4 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-accent aria-[current=page]:font-bold aria-[current=page]:text-foreground"
        >
          {t.label}
          {t.active && <span className="absolute bottom-0 h-1 w-14 rounded-full bg-primary" />}
        </Link>
      ))}
    </nav>
  );
}
