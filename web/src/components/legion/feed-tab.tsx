"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "@/components/providers/account-provider";
import { Feed } from "@/components/feed/feed";
import { profileQuery } from "@/lib/api/queries";
import { feedHref, multiFeed } from "@/lib/legion/feed";
import { feedName } from "./feed-label";

/**
 * The profile's Feed tab (docs/LEGION.md §3): posts sent to this account as a feed. Shown when the
 * feed has posts, or while it's open, and only when this site has a Legion feed configured.
 */
export function useFeedTab(account: string, pathname: string): { href: string; label: string } | null {
  const { accountId } = useAccount();
  const href = feedHref(account);
  // The profile the header already loaded says whether the account has a feed.
  const { data: profile } = useQuery({ ...profileQuery(account, accountId), enabled: !!multiFeed });
  if (!multiFeed) return null;
  return profile?.has_feed || pathname === href ? { href, label: "Feed" } : null;
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
