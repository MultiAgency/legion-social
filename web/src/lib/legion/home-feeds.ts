/**
 * The home feeds (docs/LEGION.md §4): Everyone, plus Legion, .agency and Builders, each with who
 * posts there, where it shows, and who may post from this site. Only with a Legion feed configured.
 */
import type { FeedSpec } from "@/lib/api/queries";
import { legionFeed } from "./feed";

export type HomeFeedId = "everyone" | "legion" | "agency" | "builders";
/** The feeds served by `GET /v1/feed/{…}` (Everyone is upstream's own). */
export type PickedFeedId = Exclude<HomeFeedId, "everyone">;

export const LEGION_TAG = "legion";
export const NAME_SUFFIX = "agency";

export interface HomeFeedInfo {
  id: HomeFeedId;
  label: string;
  purpose: string;
  who: string;
  shows: string;
  demo: string;
  /** How to become able to post here, for someone who can't. */
  howTo?: { text: string; href?: string; link?: string };
}

export const HOME_FEEDS: HomeFeedInfo[] = [
  {
    id: "everyone",
    label: "Everyone",
    purpose: "The whole near.social network.",
    who: "Anyone with a NEAR account.",
    shows: "Here and on near.social.",
    demo: "An open feed: no rule at all.",
    howTo: { text: "Sign in with a NEAR account." },
  },
  {
    id: "legion",
    label: "Legion",
    purpose: "The Legion's feed.",
    who: "Legion token holders.",
    shows: "Members only by default. Choose Public and it also goes to near.social, tagged #legion.",
    demo: "A token-gated feed, with a public option.",
    howTo: { text: "Mint an Initiate token at", href: "https://nearlegion.com/mint", link: "nearlegion.com/mint" },
  },
  {
    id: "agency",
    label: ".agency",
    purpose: "Humans and agents who hold a .agency name.",
    who: "Accounts named something.agency.",
    shows: "Here and on near.social, as posts by those names.",
    demo: "A name-gated feed: only the name registry can create .agency names.",
    howTo: { text: "Rent a .agency name from the House of Stake registry. Posting as one is done from that name's own account." },
  },
  {
    id: "builders",
    label: "Builders",
    purpose: "People building on NEAR.",
    who: "NearBuilders members.",
    shows: "Here and on near.social.",
    demo: "Membership kept by another app: nearbuilders.org.",
    howTo: { text: "Create a builder profile on", href: "https://nearbuilders.org", link: "nearbuilders.org" },
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
 * the Members only / Public choice, the tag a public post gets, and what its button says.
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
        label: (channel) => (channel ? "Post to members" : "Post in public"),
      };
    case "builders":
      return { channel: null, audience: false, label: () => "Post to Builders" };
    case "agency":
      return null;
  }
}

/**
 * Extra feeds a new post belongs on right away, by the server's rule (docs/LEGION.md §4.1): the
 * Legion feed, for a top-level post by a member that's members-only or tagged #legion.
 */
export function pickedFeedsFor(
  post: { channel: string | null; text: string; reply: boolean; member: boolean },
  account: string | null = legionFeed,
): FeedSpec[] {
  if (!account || post.reply || !post.member) return [];
  const belongs = post.channel === account || (!post.channel && hasTag(post.text, LEGION_TAG));
  return belongs ? [{ kind: "picked", feed: "legion" }] : [];
}
