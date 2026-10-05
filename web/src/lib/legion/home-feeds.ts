/**
 * The home feeds (docs/LEGION.md §4): Everyone is upstream's own tabs; Legion, .agency and Builders
 * are pinned after them, each with one line on who posts there. Only with a Legion feed configured.
 */
import type { FeedSpec } from "@/lib/api/queries";
import { legionFeed } from "./feed";

export type HomeFeedId = "everyone" | "legion" | "agency" | "builders";
/** The feeds served by `GET /v1/feed/{…}` (Everyone is upstream's own). */
export type PickedFeedId = Exclude<HomeFeedId, "everyone">;

export const LEGION_TAG = "legion";
export const NAME_SUFFIX = "agency";

export interface HomeFeedInfo {
  id: PickedFeedId;
  label: string;
  /** One line under the tabs: who posts here, and where it shows. */
  note: string;
  /** How to become able to post here, for a signed-in account that can't. */
  howTo: { text: string; href?: string; link?: string };
}

/** The feeds pinned after upstream's own tabs (For you, Following, Latest), which are Everyone. */
export const HOME_FEEDS: HomeFeedInfo[] = [
  {
    id: "legion",
    label: "Legion",
    note: "Posts by Legion token holders. Legion-only posts don't appear on near.social.",
    howTo: { text: "To post, mint an Initiate token at", href: "https://nearlegion.com/mint", link: "nearlegion.com/mint" },
  },
  {
    id: "agency",
    label: ".agency",
    note: "Posts by .agency names, people and agents.",
    howTo: { text: "Only .agency names can post here." },
  },
  {
    id: "builders",
    label: "Builders",
    note: "Posts by NearBuilders members.",
    howTo: { text: "To post, create a builder profile at", href: "https://nearbuilders.org", link: "nearbuilders.org" },
  },
];

/** The home feed `?feed=` picks; anything else (For you, Following, Latest) is Everyone. */
export function homeFeedId(feed: string | null | undefined, account: string | null = legionFeed): HomeFeedId {
  return account && (feed === "legion" || feed === "agency" || feed === "builders") ? feed : "everyone";
}

/** The API path of a picked home feed. */
export function pickedFeedPath(id: PickedFeedId): string {
  switch (id) {
    case "legion":
      return "/v1/feed/legion";
    case "agency":
      return `/v1/feed/names/${NAME_SUFFIX}`;
    case "builders":
      return "/v1/feed/builders";
  }
}

/** The home tab and feed for a picked home feed, or null for Everyone's tabs. */
export function pickedHomeFeed(
  feed: string | null | undefined,
  account: string | null = legionFeed,
): { tab: PickedFeedId; spec: FeedSpec } | null {
  const id = homeFeedId(feed, account);
  return id === "everyone" ? null : { tab: id, spec: { kind: "picked", feed: id } };
}

/** Whether `text` already carries `#tag` (case-insensitive, as hashtags are). */
export function hasTag(text: string, tag: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}_])#${tag}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

/** `text` with ` #tag` appended unless it already has it. */
export function withTag(text: string, tag: string): string {
  return hasTag(text, tag) ? text : `${text.trimEnd()} #${tag}`;
}

/**
 * Where a composer posts: the feed account it starts on (`null` is `social`), whether it offers
 * the Legion only / Also on near.social choice, the tag a near.social post gets, and what its button says.
 */
export interface Destination {
  channel: string | null;
  audience: boolean;
  publicTag?: string;
  label: (channel: string | null) => string;
}

/** The composer destination of a home feed, or null where this site doesn't post (.agency). */
export function destinationFor(id: HomeFeedId, account: string | null = legionFeed): Destination | null {
  switch (id) {
    case "everyone":
      return { channel: null, audience: false, label: () => "Post to Everyone" };
    case "legion":
      return {
        channel: account,
        audience: true,
        publicTag: LEGION_TAG,
        label: (channel) => (channel ? "Post to Legion" : "Post to Legion and near.social"),
      };
    case "builders":
      return { channel: null, audience: false, label: () => "Post to Builders" };
    case "agency":
      return null;
  }
}

/**
 * Extra feeds a new post belongs on right away, by the server's rule (docs/LEGION.md §4.1): the
 * Legion feed, for a top-level post by a member that's Legion-only or tagged #legion.
 */
export function pickedFeedsFor(
  post: { channel: string | null; text: string; reply: boolean; member: boolean },
  account: string | null = legionFeed,
): FeedSpec[] {
  if (!account || post.reply || !post.member) return [];
  const belongs = post.channel === account || (!post.channel && hasTag(post.text, LEGION_TAG));
  return belongs ? [{ kind: "picked", feed: "legion" }] : [];
}
