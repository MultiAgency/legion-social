import { isAccountId } from "@/lib/social/standard";
import type { PickedFeedId } from "./home-feeds";

/**
 * The Multi feed account (docs/LEGION.md §3), from `NEXT_PUBLIC_MULTI_FEED` (inlined at build
 * time). It also turns the pinned feeds on; unset or invalid, the web is upstream's.
 */
export const multiFeed: string | null = configured(process.env.NEXT_PUBLIC_MULTI_FEED);

export function configured(value: string | undefined): string | null {
  const account = value?.trim().toLowerCase();
  return account && isAccountId(account) ? account : null;
}

/**
 * The feed a new post or reply goes to: the configured Multi feed, and nothing else. A reply to a
 * post in some other feed goes to `social`, so it never lands on an account this site didn't
 * choose. (Edits and deletes: `ownFeed`.)
 */
export function writeFeed(channel: string | null | undefined, account: string | null = multiFeed): string | null {
  return channel && channel === account ? channel : null;
}

/**
 * The feed an edit or delete of a post goes to: its own. Only `social` and the configured Multi
 * feed are written here; a post in any other feed is refused, never rewritten somewhere else.
 */
export function ownFeed(channel: string | null | undefined, account: string | null = multiFeed): string | null {
  if (!channel) return null;
  if (channel === account) return channel;
  throw new Error(`This post was written to @${channel}, which this site doesn't write to.`);
}

/** A hashtag's page: within a pinned feed (`?feed=`), or upstream's `/hashtag/{tag}` without one. */
export function hashtagHref(tag: string, feed?: PickedFeedId | null): string {
  const path = `/hashtag/${encodeURIComponent(tag)}`;
  return feed ? `${path}?feed=${feed}` : path;
}

/** A feed's page: the Feed tab of the account that receives it. */
export function feedHref(account: string): string {
  return `/${encodeURIComponent(account)}/feed`;
}

