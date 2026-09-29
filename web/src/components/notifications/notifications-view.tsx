"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Bell, Heart, Repeat2, UserPlus } from "lucide-react";
import { useAccount } from "@/components/providers/account-provider";
import { notificationsQuery } from "@/lib/api/queries";
import type { Notification } from "@/lib/api/types";
import { markNotifSeen, notifSeenKey, readLocal, useMutes } from "@/lib/local-store";
import { PageHeader } from "@/components/shell/page-header";
import { UserAvatar } from "@/components/account/user-avatar";
import { PostCard } from "@/components/post/post-card";
import { postHref } from "@/components/post/quoted-post";
import { RichText } from "@/components/post/post-text";
import { RelativeTime } from "@/components/common/timestamp";
import { EmptyState, ErrorState } from "@/components/common/states";
import { InfiniteSentinel } from "@/components/common/infinite-sentinel";
import { FeedSkeleton } from "@/components/post/post-skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const VERB: Record<"like" | "repost" | "follow", string> = {
  like: "liked your post",
  repost: "reposted your post",
  follow: "followed you",
};

function actorsText(n: Notification) {
  const first = n.actors[0];
  const name = first ? first.name?.trim() || first.account_id : "Someone";
  const others = Math.max(0, n.actor_count - 1);
  return (
    <>
      <span className="font-bold">{name}</span>
      {others > 0 && (
        <>
          {" "}
          and {others} {others === 1 ? "other" : "others"}
        </>
      )}
    </>
  );
}

function GroupedNotification({ n, unread }: { n: Notification; unread: boolean }) {
  const router = useRouter();
  const kind = n.kind as "like" | "repost" | "follow";
  const Icon = kind === "like" ? Heart : kind === "repost" ? Repeat2 : UserPlus;
  const href = n.post ? postHref(n.post.key) : n.actors[0] ? `/${n.actors[0].account_id}` : "#";
  return (
    <article
      className={cn(
        "cv-auto relative flex cursor-pointer gap-3 border-b px-4 py-3 transition-colors hover:bg-accent/40",
        unread && "bg-primary/[0.06]",
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        router.push(href);
      }}
    >
      <div className="flex w-10 justify-end pt-0.5">
        <Icon
          className={cn(
            "size-7",
            kind === "like" && "fill-like text-like",
            kind === "repost" && "text-repost",
            kind === "follow" && "text-link",
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-1">
          {n.actors.slice(0, 5).map((a) => (
            <Link prefetch={false} key={a.account_id} href={`/${a.account_id}`} aria-label={`@${a.account_id}`} className="rounded-full">
              <UserAvatar accountId={a.account_id} src={a.avatar_url} size={32} />
            </Link>
          ))}
        </div>
        <p className="mt-2 text-[15px]">
          {actorsText(n)} {VERB[kind]}{" "}
          <span className="text-muted-foreground">
            · <RelativeTime ms={n.created_at} />
          </span>
        </p>
        {n.post?.text && (
          <div className="mt-1 line-clamp-3 text-[15px] text-muted-foreground">
            <RichText text={n.post.text} />
          </div>
        )}
      </div>
      {unread && <span className="absolute right-4 top-4 size-2 rounded-full bg-primary" aria-label="Unread" />}
    </article>
  );
}

export function NotificationsView() {
  const { accountId, requireSignIn, ready } = useAccount();
  return (
    <>
      <PageHeader title="Notifications" />
      {accountId ? (
        <NotificationsList key={accountId} accountId={accountId} />
      ) : ready ? (
        <EmptyState title="Sign in to see notifications" icon={<Bell className="size-8" />}>
          <p>Likes, replies, mentions, reposts and new followers show up here.</p>
          <Button className="mt-4" onClick={() => requireSignIn()}>
            Sign in
          </Button>
        </EmptyState>
      ) : (
        <FeedSkeleton />
      )}
    </>
  );
}

function NotificationsList({ accountId }: { accountId: string }) {
  const mutes = useMutes();
  const q = useInfiniteQuery(notificationsQuery(accountId));
  // Last-seen time as of opening the page, to highlight what's new.
  const [seenBefore] = React.useState(() => Number(readLocal(notifSeenKey(accountId)) ?? 0));

  const items = React.useMemo(
    () =>
      (q.data?.pages.flatMap((p) => p.items) ?? []).filter(
        (n) => !n.actors.every((a) => mutes.includes(a.account_id)),
      ),
    [q.data, mutes],
  );

  React.useEffect(() => {
    if (!q.data) return;
    const newest = q.data.pages[0]?.items[0]?.created_at;
    markNotifSeen(accountId, newest ?? Date.now());
  }, [accountId, q.data]);

  if (q.isPending) return <FeedSkeleton />;
  if (q.isError && items.length === 0) return <ErrorState onRetry={() => void q.refetch()} />;
  if (items.length === 0) {
    return (
      <EmptyState title="Nothing to see here yet" icon={<Bell className="size-8" />}>
        When someone likes, reposts, replies to, quotes or mentions your posts, or follows you,
        you&apos;ll see it here.
      </EmptyState>
    );
  }
  return (
    <div>
      {items.map((n) => {
        const unread = seenBefore > 0 && n.created_at > seenBefore;
        const id = `${n.kind}:${n.cursor}`;
        if ((n.kind === "reply" || n.kind === "quote" || n.kind === "mention") && n.post) {
          return (
            <div key={id} className={cn("relative", unread && "bg-primary/[0.06]")}>
              {n.kind !== "reply" && (
                <p className="px-4 pt-2 text-[13px] font-semibold text-muted-foreground">
                  {n.kind === "quote" ? "Quoted your post" : "Mentioned you"}
                </p>
              )}
              <PostCard post={n.post} />
            </div>
          );
        }
        if (n.kind === "like" || n.kind === "repost" || n.kind === "follow") {
          return <GroupedNotification key={id} n={n} unread={unread} />;
        }
        return null;
      })}
      <InfiniteSentinel
        hasMore={!!q.hasNextPage}
        loading={q.isFetchingNextPage}
        onVisible={() => {
          if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
        }}
      />
    </div>
  );
}
