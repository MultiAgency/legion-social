import { api } from "@/lib/api/client";
import { getProfileCached } from "@/lib/api/server";
import { legionFeed } from "@/lib/legion/feed";

/**
 * Whether `/{account}` should open on its Feed tab: the account has no profile of its own and posts
 * were sent to it, so it reads as a feed (for example `legion`, docs/LEGION.md §3).
 */
export async function leadsWithFeed(account: string, viewer: string | null): Promise<boolean> {
  if (!legionFeed) return false;
  try {
    const [profile, feed] = await Promise.all([
      getProfileCached(account, viewer),
      api.channelFeed(account, { limit: 1 }),
    ]);
    return !profile.has_profile && feed.items.length > 0;
  } catch {
    return false;
  }
}
