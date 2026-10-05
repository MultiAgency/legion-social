/** Where a channel's lists live on this site (docs/LEGION.md §3). */

/** A hashtag's page within one feed: `social` (`null`) or a channel. */
export function hashtagHref(tag: string, channel?: string | null): string {
  const path = `/hashtag/${encodeURIComponent(tag)}`;
  return channel ? `${path}?channel=${encodeURIComponent(channel)}` : path;
}

/** A feed's page: the Feed tab of the account that receives it. */
export function channelHref(channel: string): string {
  return `/${encodeURIComponent(channel)}/feed`;
}
