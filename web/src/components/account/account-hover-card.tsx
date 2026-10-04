"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "@/components/providers/account-provider";
import { FollowButton } from "@/components/account/follow-button";
import { UserAvatar } from "@/components/account/user-avatar";
import { RankBadge } from "@/components/legion/rank-badge";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { profileQuery } from "@/lib/api/queries";
import { formatCount } from "@/lib/utils";

/**
 * Shows a profile preview with a Follow button when hovering (or focusing) an account link.
 * The profile is only fetched once the card opens. Touch devices don't open it; tapping follows
 * the link as usual.
 */
export function AccountHoverCard({ accountId, children }: { accountId: string; children: React.ReactElement }) {
  const [open, setOpen] = React.useState(false);
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={450} closeDelay={150}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      {/* The card renders in a portal, but React events still bubble to the post it's in. */}
      <HoverCardContent onClick={(e) => e.stopPropagation()}>
        {open && <AccountPreview accountId={accountId} />}
      </HoverCardContent>
    </HoverCard>
  );
}

function AccountPreview({ accountId }: { accountId: string }) {
  const { accountId: viewer } = useAccount();
  const { data: profile, isPending, isError } = useQuery(profileQuery(accountId, viewer));
  const href = `/${accountId}`;

  if (isPending) {
    return (
      <div aria-busy className="space-y-3">
        <div className="flex items-start justify-between">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-8 w-[92px] rounded-full" />
        </div>
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }
  if (isError || !profile) {
    return (
      <Link href={href} className="font-bold hover:underline">
        @{accountId}
      </Link>
    );
  }
  const name = profile.name?.trim() || accountId;
  return (
    <div className="text-[15px]">
      <div className="flex items-start justify-between gap-3">
        <Link href={href} className="rounded-full">
          <UserAvatar accountId={accountId} src={profile.avatar_url} size={56} />
        </Link>
        <FollowButton accountId={accountId} following={profile.viewer?.following ?? false} />
      </div>
      <div className="mt-2">
        <Link href={href} className="block truncate font-extrabold leading-tight hover:underline">
          {name}
        </Link>
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span className="break-all">@{accountId}</span>
          <RankBadge rank={profile.rank} />
          {profile.viewer?.followed_by && <Badge>Follows you</Badge>}
        </div>
      </div>
      {profile.about && (
        <p className="mt-2 line-clamp-3 whitespace-pre-line break-words leading-snug">{profile.about}</p>
      )}
      <div className="mt-3 flex gap-4">
        <Link href={`${href}/following`} className="hover:underline">
          <span className="font-bold tabular-nums">{formatCount(profile.counts.following)}</span>{" "}
          <span className="text-muted-foreground">Following</span>
        </Link>
        <Link href={`${href}/followers`} className="hover:underline">
          <span className="font-bold tabular-nums">{formatCount(profile.counts.followers)}</span>{" "}
          <span className="text-muted-foreground">Followers</span>
        </Link>
      </div>
    </div>
  );
}
