import type { Rank } from "@/lib/legion/rank";

/**
 * Response shapes of the read API (`/v1`), mirroring docs/API.md.
 * Fields prefixed with `_` are client-only annotations and never come from the server.
 */

export interface AccountSummary {
  account_id: string;
  name: string | null;
  avatar_url: string | null;
  /** NEAR Legion rank; absent for non-members and when the server runs without Legion. */
  rank?: Rank;
}

export interface ViewerFollowFlags {
  following: boolean;
  followed_by: boolean;
}

export interface AccountCard extends AccountSummary {
  /** Cut to 300 characters by the server. */
  about: string | null;
  followers: number;
  /** Present only when `viewer` was given. */
  viewer?: ViewerFollowFlags;
  cursor: string;
}

export interface ProfileCounts {
  followers: number;
  following: number;
  posts: number;
}

export interface Profile {
  account_id: string;
  has_profile: boolean;
  name: string | null;
  about: string | null;
  avatar: string | null;
  avatar_url: string | null;
  banner: string | null;
  banner_url: string | null;
  location: string | null;
  links: Record<string, string>;
  counts: ProfileCounts;
  joined_at: number | null;
  /** NEAR Legion rank; absent for non-members and when the server runs without Legion. */
  rank?: Rank;
  viewer?: ViewerFollowFlags;
}

export interface PostMedia {
  src: string;
  url: string;
  mime: string;
  w: number | null;
  h: number | null;
  alt: string | null;
}

export interface PostParentRef {
  key: string;
  author: AccountSummary;
}

export interface UnavailablePost {
  key: string;
  unavailable: true;
}

export interface PostCounts {
  replies: number;
  reposts: number;
  likes: number;
  quotes: number;
}

export interface PostViewerFlags {
  liked: boolean;
  reposted: boolean;
}

/** An Open Graph card. `image` is the page's original image URL (shown via `proxiedImage`). */
export interface CardPreview {
  kind: "card";
  title: string;
  description?: string | null;
  site_name?: string | null;
  image?: string | null;
  /** Wide image above the text; otherwise a small square image on the left. */
  large: boolean;
}

export interface YoutubePreview {
  kind: "youtube";
  video_id: string;
  /** Start time in seconds. */
  start?: number | null;
  shorts: boolean;
}

/** A near.fm song. `cover` and `audio` are FastFS gateway URLs. */
export interface NearFmPreview {
  kind: "near_fm";
  uuid: string;
  title: string;
  artist: string;
  artist_url?: string | null;
  cover?: string | null;
  audio: string;
  mime?: string | null;
  /** Seconds. */
  duration?: number | null;
}

/**
 * The unfurled target of a post's link. `unavailable`: the target is gone (e.g. a hidden or
 * deleted near.fm song); `none`: fetched, nothing to show.
 */
export type LinkPreview =
  | CardPreview
  | YoutubePreview
  | NearFmPreview
  | { kind: "unavailable" }
  | { kind: "none" };

/** The one link the server picked from a post's text (docs/API.md). */
export interface PostLink {
  /** The URL exactly as it appears in `text`. */
  url: string;
  /** A linked near.social post, shown as a quote. */
  post?: Post | null;
  /** Absent or null: not unfurled yet, fetch it from `/v1/posts/{account}/{id}/preview`. */
  preview?: LinkPreview | null;
}

export interface PostPreviewResponse {
  url: string;
  preview: LinkPreview;
}

export interface Post {
  key: string;
  id: string;
  author: AccountSummary;
  text: string;
  media: PostMedia[];
  created_at: number;
  block_height: number;
  edited_at: number | null;
  reply_to: PostParentRef | null;
  root: string | null;
  /** A nested Post (whose own `quote` is always null), an unavailable marker, or null. */
  quote: Post | UnavailablePost | null;
  mentions: string[];
  hashtags: string[];
  /** The channel account the post was written to; null on `social` (docs/LEGION.md §3). */
  channel?: string | null;
  counts: PostCounts;
  viewer?: PostViewerFlags;
  /** A link preview or linked post. Always null on nested posts; absent on optimistic ones. */
  link?: PostLink | null;
  /** Client-only: optimistic post not yet confirmed by the indexer. */
  _pending?: boolean;
}

export type FeedItemType = "post" | "repost";

/**
 * Why a "For you" item was picked: from people you follow (or yourself), trending, or recent
 * posts that keep the feed going. Only `/v1/feed/for_you` sets it.
 */
export type FeedReason = "following" | "trending" | "new";

export interface FeedItem {
  type: FeedItemType;
  post: Post;
  reposted_by: AccountSummary | null;
  reposted_at: number | null;
  cursor: string;
  reason?: FeedReason;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export type NotificationKind = "like" | "repost" | "reply" | "quote" | "mention" | "follow";

export interface Notification {
  kind: NotificationKind;
  actors: AccountSummary[];
  actor_count: number;
  post: Post | null;
  created_at: number;
  cursor: string;
}

export interface ThreadResponse {
  post: Post;
  /** From the root down to the direct parent, up to 20. */
  ancestors: Post[];
  parent_missing: boolean;
}

export interface TrendingTag {
  tag: string;
  count: number;
}

export interface Status {
  standard: string;
  chain_id: string;
  social_account_id: string;
  last_block_height: number;
  last_block_ts: number;
  lag_ms: number;
  counts: { accounts: number; posts: number; likes: number; follows: number };
}

export type TxActionStatus = "ok" | "invalid_json" | "too_many_keys" | "invalid_borsh";
export type TxKeyStatus =
  | "ok"
  | "ignored"
  | "invalid"
  | "key_too_long"
  | "value_too_large"
  | "rate_limited";

export interface TxKeyOutcome {
  key: string;
  status: TxKeyStatus;
  reason?: string;
}

export interface TxActionOutcome {
  /** `kv` for `__fastdata_kv`, `fastfs` for file uploads. */
  kind?: "kv" | "fastfs";
  status: TxActionStatus;
  keys: TxKeyOutcome[];
  /** FastFS uploads only. */
  file?: { path: string; offset?: number; full_size?: number; deleted: boolean };
}

export interface TxOutcome {
  tx_hash: string;
  indexed: boolean;
  block_height?: number;
  block_ts?: number;
  predecessor_id?: string;
  actions?: TxActionOutcome[];
}

export interface StreamBlockEvent {
  block_height: number;
  block_ts: number;
  tx_hashes: string[];
  posts: string[];
  accounts: string[];
}

export interface LegacyImageSource {
  kind: string;
  /** Path relative to the API base, e.g. `/v1/legacy/alice.near/image/avatar`. */
  proxy_url: string;
}

export interface LegacyProfileFields {
  name: string | null;
  about: string | null;
  location: string | null;
  links: Record<string, string>;
}

export interface LegacyAccount {
  account_id: string;
  exists: boolean;
  profile: LegacyProfileFields | null;
  avatar: LegacyImageSource | null;
  banner: LegacyImageSource | null;
  follows: string[];
  follows_on_network: number;
  already_following: number;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
}

export function isFullPost(q: Post["quote"]): q is Post {
  return q !== null && !("unavailable" in q && q.unavailable === true);
}
