import { getProfileCached } from "@/lib/api/server";
import { legionFeed } from "@/lib/legion/feed";

/**
 * Whether `/{account}` should open on its Feed tab: the account has no profile of its own and posts
 * were sent to it, so it reads as a feed (for example `legion`, docs/LEGION.md §3).
 */
export async function leadsWithFeed(account: string, viewer: string | null): Promise<boolean> {
  if (!legionFeed) return false;
  try {
    const profile = await getProfileCached(account, viewer);
    return !profile.has_profile && !!profile.has_feed;
  } catch {
    return false;
  }
}
