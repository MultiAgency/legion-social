/** Where a channel's lists live on this site (docs/LEGION.md §3). */

/** A hashtag's page within one feed: `social` (`null`) or a channel. */
export function hashtagHref(tag: string, channel?: string | null): string {
  const path = `/hashtag/${encodeURIComponent(tag)}`;
  return channel ? `${path}?channel=${encodeURIComponent(channel)}` : path;
}

/** A channel's own feed page. */
export function channelHref(channel: string): string {
  return `/c/${encodeURIComponent(channel)}`;
}
