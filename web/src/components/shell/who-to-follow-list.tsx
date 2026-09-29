"use client";

import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useAccount } from "@/components/providers/account-provider";
import { accountListQuery } from "@/lib/api/queries";
import { UserAvatar } from "@/components/account/user-avatar";
import { FollowButton } from "@/components/account/follow-button";
import { AccountRowSkeleton } from "@/components/post/post-skeleton";

export function WhoToFollowList({ limit }: { limit: number }) {
  const { accountId } = useAccount();
  const { data, isPending, isError } = useInfiniteQuery(
    accountListQuery({ kind: "suggestions" }, accountId, limit),
  );
  if (isPending) {
    return (
      <div className="pb-2">
        {Array.from({ length: limit }).map((_, i) => (
          <AccountRowSkeleton key={i} />
        ))}
      </div>
    );
  }
  const items = data?.pages[0]?.items ?? [];
  if (isError || items.length === 0) {
    return (
      <p className="px-4 pb-4 pt-2 text-[15px] text-muted-foreground">
        {isError ? "Suggestions are unavailable right now." : "No suggestions yet."}
      </p>
    );
  }
  return (
    <ul className="pb-1">
      {items.slice(0, limit).map((a) => (
        <li key={a.account_id} className="relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60">
          <Link prefetch={false} href={`/${a.account_id}`} className="absolute inset-0" aria-label={`@${a.account_id}`} />
          <UserAvatar accountId={a.account_id} src={a.avatar_url} size={40} />
          <div className="pointer-events-none min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold leading-5">{a.name?.trim() || a.account_id}</div>
            <div className="truncate text-[15px] leading-5 text-muted-foreground">@{a.account_id}</div>
          </div>
          {accountId && (
            <div className="relative">
              <FollowButton accountId={a.account_id} following={a.viewer?.following ?? false} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
