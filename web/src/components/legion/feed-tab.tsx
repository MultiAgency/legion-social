"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useAccount } from "@/components/providers/account-provider";
import { Feed } from "@/components/feed/feed";
import { feedQuery } from "@/lib/api/queries";
import { feedHref } from "@/lib/legion/feed";
import { feedName } from "./feed-label";

/**
 * The profile's Feed tab (docs/LEGION.md §3): posts other accounts sent to this one. Shown when the
 * feed has posts, or while it's open.
 */
export function useFeedTab(account: string, pathname: string): { href: string; label: string } | null {
  const { accountId } = useAccount();
  const href = feedHref(account);
  const { data } = useInfiniteQuery(feedQuery({ kind: "channel", channel: account }, accountId));
  const hasPosts = (data?.pages[0]?.items.length ?? 0) > 0;
  return hasPosts || pathname === href ? { href, label: "Feed" } : null;
}

/** The posts sent to `account`. */
export function ChannelFeed({ account }: { account: string }) {
  return (
    <Feed
      spec={{ kind: "channel", channel: account }}
      empty={{
        title: `Nothing in ${feedName(account)} yet`,
        body: "Posts written to this account's feed show up here.",
      }}
    />
  );
}
