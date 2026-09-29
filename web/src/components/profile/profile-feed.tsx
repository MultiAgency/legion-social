"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useAccount } from "@/components/providers/account-provider";
import { Feed } from "@/components/feed/feed";
import { AccountRow } from "@/components/account/account-row";
import { EmptyState, ErrorState } from "@/components/common/states";
import { InfiniteSentinel } from "@/components/common/infinite-sentinel";
import { AccountRowSkeleton } from "@/components/post/post-skeleton";
import { accountListQuery, type AccountListSpec, type AccountTab } from "@/lib/api/queries";

const EMPTY: Record<AccountTab, (own: boolean, account: string) => string> = {
  posts: (own, a) => (own ? "You haven't posted yet" : `@${a} hasn't posted yet`),
  replies: (own, a) => (own ? "You haven't replied to anyone yet" : `@${a} hasn't replied yet`),
  media: (own, a) => (own ? "You haven't posted photos yet" : `@${a} hasn't posted photos yet`),
  likes: (own, a) => (own ? "You haven't liked any posts yet" : `@${a} hasn't liked any posts yet`),
};

export function ProfileFeed({ account, tab }: { account: string; tab: AccountTab }) {
  const { accountId } = useAccount();
  return (
    <Feed
      spec={{ kind: "account", tab, account }}
      layout={tab === "media" ? "media-grid" : "list"}
      empty={{ title: EMPTY[tab](accountId === account, account) }}
    />
  );
}

export function AccountList({
  spec,
  empty,
}: {
  spec: AccountListSpec;
  empty: { title: string; body?: React.ReactNode };
}) {
  const { accountId } = useAccount();
  const q = useInfiniteQuery(accountListQuery(spec, accountId));
  if (q.isPending) {
    return (
      <div>
        {Array.from({ length: 6 }).map((_, i) => (
          <AccountRowSkeleton key={i} />
        ))}
      </div>
    );
  }
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.isError && items.length === 0) return <ErrorState onRetry={() => void q.refetch()} />;
  if (items.length === 0) {
    return (
      <EmptyState title={empty.title} icon={<Users className="size-8" />}>
        {empty.body}
      </EmptyState>
    );
  }
  return (
    <div>
      {items.map((c) => (
        <AccountRow key={c.account_id} card={c} />
      ))}
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

export function ProfileAccountList({
  account,
  kind,
}: {
  account: string;
  kind: "followers" | "following";
}) {
  const { accountId } = useAccount();
  const own = accountId === account;
  const title =
    kind === "followers"
      ? own
        ? "You don't have any followers yet"
        : `@${account} doesn't have any followers yet`
      : own
        ? "You aren't following anyone yet"
        : `@${account} isn't following anyone yet`;
  return <AccountList spec={{ kind, account }} empty={{ title }} />;
}
