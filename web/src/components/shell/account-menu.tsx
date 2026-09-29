"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, LogOut, MoreHorizontal, Plus, Settings, Wallet } from "lucide-react";
import { useAccount } from "@/components/providers/account-provider";
import { UserAvatar } from "@/components/account/user-avatar";
import { profileQuery } from "@/lib/api/queries";
import { preloadWallet } from "@/lib/near/wallet-loader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export function useOwnProfile() {
  const { accountId } = useAccount();
  return useQuery({
    ...profileQuery(accountId ?? "", accountId),
    enabled: !!accountId,
    staleTime: 5 * 60_000,
  });
}

export function SignOutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { accountId, signOut, revokeAndSignOut, busy } = useAccount();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>Sign out of @{accountId}?</AlertDialogTitle>
        <AlertDialogDescription>
          Signing out removes the posting key from this browser. Revoking also deletes it from
          your account (one wallet approval), which is recommended on shared devices.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void revokeAndSignOut().then((ok) => ok && onOpenChange(false));
            }}
            disabled={busy === "revoke"}
          >
            {busy === "revoke" && <Loader2 className="animate-spin" />}
            Revoke key & sign out
          </AlertDialogAction>
          <AlertDialogAction
            variant="inverted"
            onClick={() => {
              void signOut();
            }}
          >
            Just sign out
          </AlertDialogAction>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function AccountMenuItems({ onSignOut }: { onSignOut: () => void }) {
  const { accountId, keyAccounts, switchAccount, signIn } = useAccount();
  const others = keyAccounts.filter((a) => a !== accountId);
  return (
    <>
      {accountId && (
        <DropdownMenuLabel className="flex items-center gap-2">
          <Check className="size-3.5 text-link" />
          <span className="truncate">@{accountId}</span>
        </DropdownMenuLabel>
      )}
      {others.map((a) => (
        <DropdownMenuItem key={a} onSelect={() => switchAccount(a)}>
          <UserAvatar accountId={a} size={24} />
          <span className="truncate">Switch to @{a}</span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem onSelect={() => void signIn()} onMouseEnter={() => preloadWallet()}>
        <Plus />
        Add another account
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href="/settings">
          <Settings />
          Settings
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onSelect={onSignOut}>
        <LogOut />
        Sign out @{accountId}
      </DropdownMenuItem>
    </>
  );
}

/** Bottom of the left nav: account switcher, or sign-in when signed out. */
export function AccountMenu() {
  const { accountId, signIn, busy, ready } = useAccount();
  const { data: profile } = useOwnProfile();
  const [signOutOpen, setSignOutOpen] = React.useState(false);

  if (!accountId) {
    return (
      <Button
        size="lg"
        variant="outline"
        className={cn("w-full xl:justify-center", !ready && "invisible")}
        onMouseEnter={() => preloadWallet()}
        onClick={() => void signIn()}
        disabled={busy === "sign-in"}
        aria-label="Sign in"
      >
        {busy === "sign-in" ? <Loader2 className="animate-spin" /> : <Wallet />}
        <span className="hidden xl:inline">Sign in</span>
      </Button>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-full p-2 text-left transition-colors hover:bg-accent xl:p-3"
            aria-label="Account menu"
          >
            <UserAvatar accountId={accountId} src={profile?.avatar_url} size={40} />
            <span className="hidden min-w-0 flex-1 xl:block">
              <span className="block truncate text-[15px] font-bold leading-5">
                {profile?.name?.trim() || accountId}
              </span>
              <span className="block truncate text-[15px] leading-5 text-muted-foreground">@{accountId}</span>
            </span>
            <MoreHorizontal className="hidden size-5 xl:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-72">
          <AccountMenuItems onSignOut={() => setSignOutOpen(true)} />
        </DropdownMenuContent>
      </DropdownMenu>
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </>
  );
}
