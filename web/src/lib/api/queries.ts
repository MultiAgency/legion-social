/**
 * Query key factories and query option builders shared by server prefetch (RSC) and client
 * hooks. Using the same builders on both sides guarantees hydration hits the same cache keys.
 */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api, type ListParams } from "./client";
import type { AccountCard, FeedItem, Notification, Page } from "./types";

export type AccountTab = "posts" | "replies" | "media" | "likes";

export type FeedSpec =
  | { kind: "global" }
  | { kind: "for_you" }
  | { kind: "following"; account: string }
  | { kind: "account"; tab: AccountTab; account: string }
  | { kind: "hashtag"; tag: string }
  | { kind: "search"; q: string }
  | { kind: "replies"; postKey: string }
  | { kind: "quotes"; postKey: string };

export type AccountListSpec =
  | { kind: "followers"; account: string }
  | { kind: "following"; account: string }
  | { kind: "search"; q: string }
  | { kind: "suggestions" }
  | { kind: "likers"; postKey: string }
  | { kind: "reposters"; postKey: string };

export const PAGE_SIZE = 20;
/** Matching accounts shown above post results in search. */
export const SEARCH_ACCOUNTS_PREVIEW = 3;

type Viewer = string | null | undefined;
const v = (viewer: Viewer) => viewer ?? null;

export type HomeTab = "for_you" | "following" | "latest";

/**
 * The home tab for `?feed=` and its feed: For you by default (`/`), Following
 * (`?feed=following`, signed in only) and Latest (`?feed=latest`). Shared by the RSC prefetch
 * and the client so both use the same query key.
 */
export function homeFeed(
  param: string | string[] | null | undefined,
  viewer: Viewer,
): { tab: HomeTab; spec: FeedSpec } {
  // Repeated params: use the first, like `URLSearchParams.get` on the client.
  const feed = Array.isArray(param) ? param[0] : param;
  if (feed === "latest") return { tab: "latest", spec: { kind: "global" } };
  if (feed === "following" && viewer) {
    return { tab: "following", spec: { kind: "following", account: viewer } };
  }
  return { tab: "for_you", spec: { kind: "for_you" } };
}

export const qk = {
  all: ["ns"] as const,
  feeds: ["ns", "feed"] as const,
  feed: (spec: FeedSpec, viewer: Viewer) => ["ns", "feed", spec, v(viewer)] as const,
  accountLists: ["ns", "accounts"] as const,
  accounts: (spec: AccountListSpec, viewer: Viewer, limit: number = PAGE_SIZE) =>
    ["ns", "accounts", spec, v(viewer), limit] as const,
  profiles: ["ns", "profile"] as const,
  profile: (account: string, viewer: Viewer) => ["ns", "profile", account, v(viewer)] as const,
  threads: ["ns", "thread"] as const,
  thread: (postKey: string, viewer: Viewer) => ["ns", "thread", postKey, v(viewer)] as const,
  notifications: (account: string) => ["ns", "notifications", account] as const,
  notificationCount: (account: string, since: number) =>
    ["ns", "notification-count", account, since] as const,
  trending: ["ns", "trending"] as const,
  legacy: (account: string) => ["ns", "legacy", account] as const,
  status: ["ns", "status"] as const,
};

export function splitPostKey(postKey: string): [string, string] {
  const i = postKey.lastIndexOf("/");
  return [postKey.slice(0, i), postKey.slice(i + 1)];
}

const ACCOUNT_TAB_FETCHERS: Record<
  AccountTab,
  (account: string, p: ListParams) => Promise<Page<FeedItem>>
> = {
  posts: api.accountPosts,
  replies: api.accountReplies,
  media: api.accountMedia,
  likes: api.accountLikes,
};

export function fetchFeedPage(spec: FeedSpec, p: ListParams): Promise<Page<FeedItem>> {
  const params = { limit: PAGE_SIZE, ...p };
  switch (spec.kind) {
    case "global":
      return api.globalFeed(params);
    case "for_you":
      return api.forYouFeed(params);
    case "following":
      return api.followingFeed(spec.account, params);
    case "account":
      return ACCOUNT_TAB_FETCHERS[spec.tab](spec.account, params);
    case "hashtag":
      return api.hashtagFeed(spec.tag, params);
    case "search":
      return api.searchPosts(spec.q, params);
    case "replies": {
      const [a, id] = splitPostKey(spec.postKey);
      return api.replies(a, id, params);
    }
    case "quotes": {
      const [a, id] = splitPostKey(spec.postKey);
      return api.quotes(a, id, params);
    }
  }
}

export function fetchAccountPage(spec: AccountListSpec, p: ListParams): Promise<Page<AccountCard>> {
  const params = { limit: PAGE_SIZE, ...p };
  switch (spec.kind) {
    case "followers":
      return api.followers(spec.account, params);
    case "following":
      return api.following(spec.account, params);
    case "search":
      return api.searchAccounts(spec.q, params);
    case "suggestions":
      return api.suggestions(params);
    case "likers": {
      const [a, id] = splitPostKey(spec.postKey);
      return api.likers(a, id, params);
    }
    case "reposters": {
      const [a, id] = splitPostKey(spec.postKey);
      return api.reposters(a, id, params);
    }
  }
}

const nextCursor = <T>(last: Page<T>) => last.next_cursor ?? null;

export function feedQuery(spec: FeedSpec, viewer: Viewer) {
  return infiniteQueryOptions({
    queryKey: qk.feed(spec, viewer),
    queryFn: ({ pageParam, signal }) =>
      fetchFeedPage(spec, { cursor: pageParam, viewer: v(viewer), signal }),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor<FeedItem>,
  });
}

export function accountListQuery(spec: AccountListSpec, viewer: Viewer, limit = PAGE_SIZE) {
  return infiniteQueryOptions({
    queryKey: qk.accounts(spec, viewer, limit),
    queryFn: ({ pageParam, signal }) =>
      fetchAccountPage(spec, { cursor: pageParam, viewer: v(viewer), signal, limit }),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor<AccountCard>,
  });
}

export function profileQuery(account: string, viewer: Viewer) {
  return queryOptions({
    queryKey: qk.profile(account, viewer),
    queryFn: ({ signal }) => api.profile(account, v(viewer), signal),
  });
}

export function threadQuery(postKey: string, viewer: Viewer) {
  const [a, id] = splitPostKey(postKey);
  return queryOptions({
    queryKey: qk.thread(postKey, viewer),
    queryFn: ({ signal }) => api.thread(a, id, v(viewer), signal),
  });
}

export function notificationsQuery(account: string) {
  return infiniteQueryOptions({
    queryKey: qk.notifications(account),
    queryFn: ({ pageParam, signal }) =>
      api.notifications(account, { cursor: pageParam, signal, limit: PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor<Notification>,
  });
}

export function trendingQuery() {
  return queryOptions({
    queryKey: qk.trending,
    queryFn: ({ signal }) => api.trending(signal),
    staleTime: 60_000,
  });
}

export function legacyQuery(account: string) {
  return queryOptions({
    queryKey: qk.legacy(account),
    queryFn: ({ signal }) => api.legacy(account, signal),
    staleTime: Infinity,
    retry: 1,
  });
}
