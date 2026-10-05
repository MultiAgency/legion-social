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
 * choose. (Edits and deletes: `ownFeed`.)
 */
export function writeFeed(channel: string | null | undefined, account: string | null = legionFeed): string | null {
  return channel && channel === account ? channel : null;
}

/**
 * The feed an edit or delete of a post goes to: its own. Only `social` and the configured Legion
 * feed are written here; a post in any other feed is refused, never rewritten somewhere else.
 */
export function ownFeed(channel: string | null | undefined, account: string | null = legionFeed): string | null {
  if (!channel) return null;
  if (channel === account) return channel;
  throw new Error(`This post was written to @${channel}, which this site doesn't write to.`);
}

/** A hashtag's page within one feed: `social` (`null`) or a feed account (only with feeds on). */
export function hashtagHref(tag: string, channel?: string | null, account: string | null = legionFeed): string {
  const path = `/hashtag/${encodeURIComponent(tag)}`;
  return channel && account ? `${path}?channel=${encodeURIComponent(channel)}` : path;
}

/** The feed a hashtag page's `?channel=` names: a valid account, and only with feeds on. */
export function hashtagChannel(param: string | string[] | undefined, account: string | null = legionFeed): string | null {
  return account && typeof param === "string" && isAccountId(param) ? param : null;
}

/** A feed's page: the Feed tab of the account that receives it. */
export function feedHref(account: string): string {
  return `/${encodeURIComponent(account)}/feed`;
}
