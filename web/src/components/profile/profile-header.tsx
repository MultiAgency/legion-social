"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Link2, MapPin } from "lucide-react";
import { useAccount } from "@/components/providers/account-provider";
import { profileQuery } from "@/lib/api/queries";
import { useFeedTab } from "@/components/channels/feed-tab";
import { isNotFound } from "@/lib/api/client";
import { isGatewayUrl, UserAvatar } from "@/components/account/user-avatar";
import { FollowButton } from "@/components/account/follow-button";
import { CollapsibleText } from "@/components/post/post-text";
import { HeaderTabs, PageHeader } from "@/components/shell/page-header";
import { ErrorState } from "@/components/common/states";
import { RankBadge } from "@/components/legion/rank-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { joinedDate } from "@/lib/time";
import { formatCount, pluralize } from "@/lib/utils";
import { EditProfileDialog } from "./edit-profile-dialog";
import { resolveLinks } from "./profile-links";

export function ProfileHeader({ account }: { account: string }) {
  const { accountId: viewer, requireSignIn } = useAccount();
  const { data: profile, isPending, isError, error, refetch } = useQuery(profileQuery(account, viewer));
  const [editing, setEditing] = React.useState(false);
  const own = viewer === account;

  const title = profile?.name?.trim() || account;
  const subtitle = profile ? `${formatCount(profile.counts.posts)} ${pluralize(profile.counts.posts, "post")}` : undefined;

  return (
    <>
      <PageHeader back title={title} subtitle={subtitle} />
      <div className="relative aspect-[3/1] w-full overflow-hidden bg-muted">
        {isGatewayUrl(profile?.banner_url) && (
          <Image
            src={profile.banner_url}
            alt=""
            fill
            preload
            sizes="(max-width: 640px) 100vw, 600px"
            className="object-cover"
          />
        )}
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-start justify-between">
          <div className="-mt-[12%] rounded-full bg-background p-1 sm:-mt-[68px]">
            <UserAvatar
              accountId={account}
              src={profile?.avatar_url}
              size={134}
              priority
              className="size-[84px]! sm:size-[134px]!"
            />
          </div>
          <div className="flex min-h-[68px] items-start gap-2 pt-3">
            {own && profile ? (
              <Button variant="outline" size="default" onClick={() => setEditing(true)}>
                Edit profile
              </Button>
            ) : viewer && profile?.viewer ? (
              <FollowButton accountId={account} following={profile.viewer.following} size="default" />
            ) : !viewer ? (
              <Button variant="inverted" onClick={() => requireSignIn()}>
                Follow
              </Button>
            ) : null}
          </div>
        </div>

        {isPending ? (
          <div className="mt-2 space-y-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : isError && !isNotFound(error) ? (
          <ErrorState onRetry={() => void refetch()} className="py-6" />
        ) : (
          <div className="mt-2">
            <h2 className="break-words text-xl font-extrabold leading-tight tracking-tight">{title}</h2>
            <div className="flex flex-wrap items-center gap-2 text-[15px] text-muted-foreground">
              <span className="break-all">@{account}</span>
              <RankBadge rank={profile?.rank} />
              {profile?.viewer?.followed_by && <Badge>Follows you</Badge>}
            </div>
            {profile?.about && (
              <CollapsibleText text={profile.about} lines={6} className="mt-3 text-[15px] leading-[1.4]" />
            )}
            {profile && !profile.has_profile && (
              <p className="mt-3 text-[15px] text-muted-foreground">
                {own ? "You haven't set up your profile yet." : "This account hasn't set up a profile yet."}
              </p>
            )}
            <ProfileMeta
              location={profile?.location ?? null}
              links={profile?.links ?? {}}
              joinedAt={profile?.joined_at ?? null}
            />
            {profile && (
              <div className="mt-3 flex gap-5 text-[15px]">
                <Link href={`/${account}/following`} className="hover:underline">
                  <span className="font-bold tabular-nums">{formatCount(profile.counts.following)}</span>{" "}
                  <span className="text-muted-foreground">Following</span>
                </Link>
                <Link href={`/${account}/followers`} className="hover:underline">
                  <span className="font-bold tabular-nums">{formatCount(profile.counts.followers)}</span>{" "}
                  <span className="text-muted-foreground">
                    {pluralize(profile.counts.followers, "Follower")}
                  </span>
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
      {profile && own && <EditProfileDialog profile={profile} open={editing} onOpenChange={setEditing} />}
    </>
  );
}

function ProfileMeta({
  location,
  links,
  joinedAt,
}: {
  location: string | null;
  links: Record<string, string>;
  joinedAt: number | null;
}) {
  const resolved = resolveLinks(links);
  if (!location && resolved.length === 0 && !joinedAt) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[15px] text-muted-foreground">
      {location && (
        <span className="flex min-w-0 items-center gap-1">
          <MapPin className="size-[18px] shrink-0" />
          <span className="truncate">{location}</span>
        </span>
      )}
      {resolved.map((l) => (
        <span key={l.service} className="flex min-w-0 items-center gap-1" title={l.label}>
          <Link2 className="size-[18px] shrink-0" />
          {l.href ? (
            <a
              href={l.href}
              target="_blank"
              rel="nofollow ugc noopener noreferrer me"
              className="truncate text-link hover:underline"
            >
              {l.service === "website" ? l.text : `${l.label} ${l.text}`}
            </a>
          ) : (
            <span className="truncate">
              {l.label}: {l.text}
            </span>
          )}
        </span>
      ))}
      {joinedAt && (
        <span className="flex items-center gap-1" suppressHydrationWarning>
          <CalendarDays className="size-[18px] shrink-0" />
          Joined {joinedDate(joinedAt)}
        </span>
      )}
    </div>
  );
}

export function ProfileTabs({ account }: { account: string }) {
  const pathname = usePathname();
  const base = `/${account}`;
  const isList = pathname === `${base}/followers` || pathname === `${base}/following`;
  const feedTab = useFeedTab(account, pathname);
  const tabs = isList
    ? [
        { href: `${base}/followers`, label: "Followers" },
        { href: `${base}/following`, label: "Following" },
      ]
    : [
        ...(feedTab ? [feedTab] : []),
        { href: base, label: "Posts" },
        { href: `${base}/replies`, label: "Replies" },
        { href: `${base}/media`, label: "Media" },
        { href: `${base}/likes`, label: "Likes" },
      ];
  return (
    <div className="border-b">
      <HeaderTabs tabs={tabs.map((t) => ({ ...t, active: pathname === t.href }))} />
    </div>
  );
}
