/**
 * Optimistic cache surgery across every feed / thread / notification / profile / account-list
 * query. All helpers return the same object when nothing changed, so untouched queries don't
 * re-render.
 */
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { qk, type FeedSpec } from "@/lib/api/queries";
import {
  isFullPost,
  type AccountCard,
  type FeedItem,
  type Page,
  type Post,
  type Profile,
  type ThreadResponse,
} from "@/lib/api/types";

type PostFn = (p: Post) => Post;

function patchPost(p: Post, key: string, fn: PostFn): Post {
  let next = p.key === key ? fn(p) : p;
  if (next.quote && isFullPost(next.quote) && next.quote.key === key) {
    const q = fn(next.quote);
    if (q !== next.quote) next = { ...next, quote: q };
  }
  return next;
}

function isInfinite(data: unknown): data is InfiniteData<Page<unknown>> {
  return (
    typeof data === "object" &&
    data !== null &&
    Array.isArray((data as { pages?: unknown }).pages)
  );
}

function isThread(data: unknown): data is ThreadResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "post" in data &&
    Array.isArray((data as { ancestors?: unknown }).ancestors)
  );
}

type WithPost = { post: Post | null };

function hasPostField(item: unknown): item is WithPost {
  return typeof item === "object" && item !== null && "post" in item;
}

/** Maps every post (and quoted post) with `key` in any supported query data shape. */
export function mapPostsInData<T>(data: T, key: string, fn: PostFn): T {
  if (isInfinite(data)) {
    let changed = false;
    const pages = data.pages.map((page) => {
      let pageChanged = false;
      const items = page.items.map((item) => {
        if (!hasPostField(item) || !item.post) return item;
        const post = patchPost(item.post, key, fn);
        if (post === item.post) return item;
        pageChanged = true;
        return { ...item, post };
      });
      if (!pageChanged) return page;
      changed = true;
      return { ...page, items };
    });
    return (changed ? { ...data, pages } : data) as T;
  }
  if (isThread(data)) {
    const post = patchPost(data.post, key, fn);
    let ancestorsChanged = false;
    const ancestors = data.ancestors.map((a) => {
      const n = patchPost(a, key, fn);
      if (n !== a) ancestorsChanged = true;
      return n;
    });
    if (post === data.post && !ancestorsChanged) return data;
    return { ...data, post, ancestors: ancestorsChanged ? ancestors : data.ancestors } as T;
  }
  return data;
}

/** Applies `fn` to every cached copy of the post `key`. */
export function patchPostEverywhere(qc: QueryClient, key: string, fn: PostFn): void {
  qc.setQueriesData({ queryKey: qk.all }, (old: unknown) =>
    old === undefined ? old : mapPostsInData(old, key, fn),
  );
}

/** Removes feed items showing post `key` (posts and reposts of it); marks quotes unavailable. */
export function removePostEverywhere(qc: QueryClient, key: string): void {
  qc.setQueriesData({ queryKey: qk.feeds }, (old: unknown) => {
    if (!isInfinite(old)) return old;
    let changed = false;
    const pages = old.pages.map((page) => {
      const items = (page.items as FeedItem[]).filter((i) => i.post.key !== key);
      if (items.length === page.items.length) return page;
      changed = true;
      return { ...page, items };
    });
    return changed ? { ...old, pages } : old;
  });
  qc.setQueriesData({ queryKey: qk.all }, (old: unknown) => {
    if (old === undefined) return old;
    return mapQuotes(old, key);
  });
}

function mapQuotes<T>(data: T, key: string): T {
  const unquote = (p: Post): Post =>
    p.quote && p.quote.key === key && isFullPost(p.quote)
      ? { ...p, quote: { key, unavailable: true } }
      : p;
  if (isInfinite(data)) {
    let changed = false;
    const pages = data.pages.map((page) => {
      let pageChanged = false;
      const items = page.items.map((item) => {
        if (!hasPostField(item) || !item.post) return item;
        const post = unquote(item.post);
        if (post === item.post) return item;
        pageChanged = true;
        return { ...item, post };
      });
      if (!pageChanged) return page;
      changed = true;
      return { ...page, items };
    });
    return (changed ? { ...data, pages } : data) as T;
  }
  if (isThread(data)) {
    const post = unquote(data.post);
    return (post === data.post ? data : { ...data, post }) as T;
  }
  return data;
}

/** Prepends a feed item to the first page of a feed query, if that query is cached. */
export function prependToFeed(
  qc: QueryClient,
  spec: FeedSpec,
  viewer: string | null,
  item: FeedItem,
): void {
  qc.setQueryData<InfiniteData<Page<FeedItem>>>(qk.feed(spec, viewer), (old) => {
    if (!old || old.pages.length === 0) return old;
    const [first, ...rest] = old.pages;
    if (first.items.some((i) => i.type === item.type && i.post.key === item.post.key)) return old;
    return { ...old, pages: [{ ...first, items: [item, ...first.items] }, ...rest] };
  });
}

/** Replaces (or drops, with `null`) the feed items showing post `key` in every feed. */
export function replaceFeedPost(qc: QueryClient, key: string, post: Post | null): void {
  qc.setQueriesData({ queryKey: qk.feeds }, (old: unknown) => {
    if (!isInfinite(old)) return old;
    let changed = false;
    const pages = old.pages.map((page) => {
      let pageChanged = false;
      const items = (page.items as FeedItem[]).flatMap((i) => {
        if (i.post.key !== key) return [i];
        pageChanged = true;
        return post ? [{ ...i, post }] : [];
      });
      if (!pageChanged) return page;
      changed = true;
      return { ...page, items };
    });
    return changed ? { ...old, pages } : old;
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Accounts                                                                                   */
/* ------------------------------------------------------------------------------------------ */

/** Sets `viewer.following` for `target` in profiles and account lists, adjusting counts. */
export function patchFollowEverywhere(
  qc: QueryClient,
  viewer: string,
  target: string,
  following: boolean,
): void {
  const delta = following ? 1 : -1;
  qc.setQueriesData<Profile>({ queryKey: qk.profiles }, (old) => {
    if (!old || typeof old !== "object" || !("account_id" in old)) return old;
    if (old.account_id === target) {
      if (old.viewer?.following === following) return old;
      return {
        ...old,
        viewer: { following, followed_by: old.viewer?.followed_by ?? false },
        counts: { ...old.counts, followers: Math.max(0, old.counts.followers + delta) },
      };
    }
    if (old.account_id === viewer) {
      return {
        ...old,
        counts: { ...old.counts, following: Math.max(0, old.counts.following + delta) },
      };
    }
    return old;
  });
  qc.setQueriesData<InfiniteData<Page<AccountCard>>>({ queryKey: qk.accountLists }, (old) => {
    if (!isInfinite(old)) return old;
    let changed = false;
    const pages = old.pages.map((page) => {
      let pageChanged = false;
      const items = page.items.map((c) => {
        if (c.account_id !== target || c.viewer?.following === following) return c;
        pageChanged = true;
        return {
          ...c,
          followers: Math.max(0, c.followers + delta),
          viewer: { following, followed_by: c.viewer?.followed_by ?? false },
        };
      });
      if (!pageChanged) return page;
      changed = true;
      return { ...page, items };
    });
    return changed ? { ...old, pages } : old;
  });
}

/** Reads the viewer's follow state for `target` from any cached profile or account card. */
export function cachedFollowing(qc: QueryClient, viewer: string, target: string): boolean | null {
  const p = qc.getQueryData<Profile>(qk.profile(target, viewer));
  if (p?.viewer) return p.viewer.following;
  for (const [, data] of qc.getQueriesData<InfiniteData<Page<AccountCard>>>({
    queryKey: qk.accountLists,
  })) {
    if (!isInfinite(data)) continue;
    for (const page of data.pages) {
      const c = page.items.find((i) => i.account_id === target && i.viewer);
      if (c?.viewer) return c.viewer.following;
    }
  }
  return null;
}
