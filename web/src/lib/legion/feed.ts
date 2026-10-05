import { isAccountId } from "@/lib/social/standard";
import type { FeedSpec } from "@/lib/api/queries";

/**
 * The Legion feed account (docs/LEGION.md §3), from `NEXT_PUBLIC_LEGION_FEED` (inlined at build
 * time). Unset or invalid, there's no Legion-only feed: no choice in the composer and no tab.
 */
export const legionFeed: string | null = configured(process.env.NEXT_PUBLIC_LEGION_FEED);

export function configured(value: string | undefined): string | null {
  const account = value?.trim().toLowerCase();
  return account && isAccountId(account) ? account : null;
}

/** The home tab for `?feed=legion`, when a Legion feed is configured. */
export function legionTab(
  feed: string | null | undefined,
  account: string | null = legionFeed,
): { tab: "legion"; spec: FeedSpec } | null {
  return feed === "legion" && account ? { tab: "legion", spec: { kind: "channel", channel: account } } : null;
}

/**
 * The feed a new post or reply goes to: the configured Legion feed, and nothing else. A reply to a
 * post in some other feed goes to `social`, so it never lands on an account this site didn't
 * choose. (Edits and deletes go to the post's own feed.)
 */
export function writeFeed(channel: string | null | undefined, account: string | null = legionFeed): string | null {
  return channel && channel === account ? channel : null;
}

/** A hashtag's page within one feed: `social` (`null`) or a feed account. */
export function hashtagHref(tag: string, channel?: string | null): string {
  const path = `/hashtag/${encodeURIComponent(tag)}`;
  return channel ? `${path}?channel=${encodeURIComponent(channel)}` : path;
}

/** A feed's page: the Feed tab of the account that receives it. */
export function feedHref(account: string): string {
  return `/${encodeURIComponent(account)}/feed`;
}
