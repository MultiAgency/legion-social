/**
 * The home feeds (docs/LEGION.md §4): Everyone is upstream's own tabs; Multi, Legion, .agency and
 * Builders are pinned after them, each with one line on who posts there. Only with a Multi feed
 * configured.
 */
import type { FeedSpec } from "@/lib/api/queries";
import { multiFeed } from "./feed";

export type HomeFeedId = "everyone" | "multi" | "legion" | "agency" | "builders";
/** The feeds pinned after upstream's own tabs (Everyone). */
export type PickedFeedId = Exclude<HomeFeedId, "everyone">;

export const NAME_SUFFIX = "agency";

export interface HomeFeedInfo {
  id: PickedFeedId;
  label: string;
  /** One line under the tabs: who posts here, and where it shows. */
  note: string;
  /** For a signed-in account that isn't eligible: how to become so (none where nobody can). */
  howTo?: { text: string; href?: string; link?: string };
}

/** The feeds pinned after upstream's own tabs (For you, Following, Latest), which are Everyone. */
export const HOME_FEEDS: HomeFeedInfo[] = [
  {
    id: "multi",
    label: "Multi",
    note: "An experiment: MultiSocial's own feed, open to everyone. Posts here are public, but stay off near.social.",
  },
  {
    id: "legion",
    label: "Legion",
    note: "Posts by Legion token holders. They also show on near.social.",
    howTo: { text: "To post, mint an Initiate token at", href: "https://nearlegion.com/mint", link: "nearlegion.com/mint" },
  },
  {
    id: "agency",
    label: ".agency",
    // .agency names hold no keys, so nobody posts here from this site: their owners post as them.
    note: "Posts by .agency names, people and agents. They post from their owner's account, not from this site.",
  },
  {
    id: "builders",
    label: "Builders",
    note: "Posts by NearBuilders members.",
    howTo: { text: "To appear here, create a builder profile at", href: "https://nearbuilders.org", link: "nearbuilders.org" },
  },
];

const PICKED: readonly string[] = HOME_FEEDS.map((f) => f.id);

/** The pinned feed `?feed=` picks; anything else (For you, Following, Latest, none) is Everyone. */
export function homeFeedId(feed: string | null | undefined, account: string | null = multiFeed): HomeFeedId {
  return account && feed && PICKED.includes(feed) ? (feed as PickedFeedId) : "everyone";
}

/**
 * The API path and query of a pinned feed, within one hashtag if `tag` is given. Multi is the
 * Multi feed account's own feed (`/v1/feed/channel/…`, or its hashtag list with `?channel=`).
 */
export function pickedFeedRequest(
  id: PickedFeedId,
  tag?: string | null,
  account: string | null = multiFeed,
): { path: string; query: Record<string, string> } {
  const scope: Record<string, string> = tag ? { tag } : {};
  switch (id) {
    case "multi": {
      const feed = account ?? "";
      return tag
        ? { path: `/v1/hashtags/${encodeURIComponent(tag)}`, query: { channel: feed } }
        : { path: `/v1/feed/channel/${encodeURIComponent(feed)}`, query: {} };
    }
    case "legion":
      return { path: "/v1/feed/legion", query: scope };
    case "agency":
      return { path: `/v1/feed/names/${NAME_SUFFIX}`, query: scope };
    case "builders":
      return { path: "/v1/feed/builders", query: scope };
  }
}

/** The home tab and feed for a pinned feed, or null for Everyone's tabs. */
export function pickedHomeFeed(
  feed: string | null | undefined,
  account: string | null = multiFeed,
): { tab: PickedFeedId; spec: FeedSpec } | null {
  const id = homeFeedId(feed, account);
  return id === "everyone" ? null : { tab: id, spec: { kind: "picked", feed: id } };
}

/** A hashtag page's feed: `?feed=` picks a pinned feed; without it, upstream's hashtag feed. */
export function hashtagFeed(
  tag: string,
  feed: string | string[] | null | undefined,
  account: string | null = multiFeed,
): { id: HomeFeedId; spec: FeedSpec } {
  const id = homeFeedId(typeof feed === "string" ? feed : null, account);
  return { id, spec: id === "everyone" ? { kind: "hashtag", tag } : { kind: "picked", feed: id, tag } };
}

/** Where a home feed's post box posts (`channel` null is `social`) and what its button says. */
export interface Destination {
  channel: string | null;
  label: string;
}

/**
 * The post box of a pinned feed: Multi posts to the Multi feed account, Legion to `social`. .agency
 * and Builders have none (null): they only show posts made elsewhere.
 */
export function destinationFor(id: PickedFeedId, account: string | null = multiFeed): Destination | null {
  switch (id) {
    case "multi":
      return account ? { channel: account, label: "Post to Multi" } : null;
    case "legion":
      return { channel: null, label: "Post to Legion" };
    case "agency":
    case "builders":
      return null;
  }
}

/**
 * Extra feeds a new post belongs on right away, by the server's rules (docs/LEGION.md §4): Multi
 * for anything sent to the Multi feed account (its feed lists replies too), Legion for a member's
 * top-level `social` post.
 */
export function pickedFeedsFor(
  post: { channel: string | null; reply: boolean; member: boolean },
  account: string | null = multiFeed,
): FeedSpec[] {
  if (!account) return [];
  if (post.channel === account) return [{ kind: "picked", feed: "multi" }];
  return !post.channel && !post.reply && post.member ? [{ kind: "picked", feed: "legion" }] : [];
}

/**
 * The pinned feed a post's #hashtags link within: Multi for a post sent to the Multi feed account,
 * wherever it shows; otherwise the pinned tab showing it, if any; else none (upstream's link).
 */
export function hashtagFeedFor(
  channel: string | null | undefined,
  tab: PickedFeedId | null,
  account: string | null = multiFeed,
): PickedFeedId | null {
  if (!account) return null;
  if (channel && channel === account) return "multi";
  return tab;
}
