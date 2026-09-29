"use client";

import Link from "next/link";
import type { AccountCard } from "@/lib/api/types";
import { useAccount } from "@/components/providers/account-provider";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "./user-avatar";
import { NameLine } from "./names";
import { FollowButton } from "./follow-button";

export function AccountRow({ card, showAbout = true }: { card: AccountCard; showAbout?: boolean }) {
  const { accountId } = useAccount();
  return (
    <div className="relative flex gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
      <Link prefetch={false} href={`/${card.account_id}`} className="absolute inset-0" aria-label={`@${card.account_id}`} />
      <UserAvatar accountId={card.account_id} src={card.avatar_url} size={44} className="relative" />
      <div className="relative min-w-0 flex-1 pointer-events-none">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <NameLine accountId={card.account_id} name={card.name} link={false} handle={false} />
            <div className="flex items-center gap-1.5 text-[15px] text-muted-foreground">
              <span className="truncate">@{card.account_id}</span>
              {card.viewer?.followed_by && <Badge>Follows you</Badge>}
            </div>
          </div>
          {accountId && card.viewer && (
            <div className="pointer-events-auto">
              <FollowButton accountId={card.account_id} following={card.viewer.following} />
            </div>
          )}
        </div>
        {showAbout && card.about && (
          <p className="mt-1 line-clamp-2 whitespace-pre-line break-words text-[15px] text-foreground/90">
            {card.about}
          </p>
        )}
      </div>
    </div>
  );
}
