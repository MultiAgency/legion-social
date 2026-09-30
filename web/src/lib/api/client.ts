/**
 * Typed client for the read API (`/v1`, see docs/API.md).
 * On the server it uses `API_INTERNAL_URL` and `cache: "no-store"`; in the browser it uses
 * `NEXT_PUBLIC_API_URL`.
 */
import { apiBase } from "@/lib/env";
import type {
  AccountCard,
  ApiErrorBody,
  FeedItem,
  LegacyAccount,
  Notification,
  Page,
  Post,
  PostPreviewResponse,
  Profile,
  Status,
  ThreadResponse,
  TrendingTag,
  TxOutcome,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message || `${code} (HTTP ${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

type QueryValue = string | number | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  /** Server-side request timeout (ms). */
  timeoutMs?: number;
}

const isServer = typeof window === "undefined";

export function apiUrl(path: string, query?: Record<string, QueryValue>): string {
  // Keep any path prefix of the base URL (e.g. `https://host/api`).
  const url = new URL(apiBase());
  url.pathname = url.pathname.replace(/\/$/, "") + path.replace(/^\/?/, "/");
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { query, method = "GET", body, signal, timeoutMs = 8000 } = opts;
  const signals: AbortSignal[] = [];
  if (signal) signals.push(signal);
  if (isServer) signals.push(AbortSignal.timeout(timeoutMs));
  const init: RequestInit = {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
  };
  if (isServer) init.cache = "no-store";

  const res = await fetch(apiUrl(path, query), init);
  if (!res.ok) {
    let code = "http_error";
    let message: string | undefined;
    try {
      const data = (await res.json()) as Partial<ApiErrorBody>;
      if (typeof data.error === "string") code = data.error;
      if (typeof data.message === "string") message = data.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------------------------------ */

const enc = encodeURIComponent;

export interface ListParams {
  cursor?: string | null;
  limit?: number;
  viewer?: string | null;
  signal?: AbortSignal;
}

function list<T>(path: string, p: ListParams = {}, extra?: Record<string, QueryValue>) {
  return apiFetch<Page<T>>(path, {
    query: { cursor: p.cursor, limit: p.limit, viewer: p.viewer, ...extra },
    signal: p.signal,
  });
}

export const api = {
  status: (signal?: AbortSignal) => apiFetch<Status>("/v1/status", { signal }),

  /* Feeds */
  globalFeed: (p?: ListParams) => list<FeedItem>("/v1/feed/global", p),
  /** Following + trending mix; works without a viewer. The cursor is opaque. */
  forYouFeed: (p?: ListParams) => list<FeedItem>("/v1/feed/for_you", p),
  followingFeed: (account: string, p?: ListParams) =>
    list<FeedItem>(`/v1/feed/following/${enc(account)}`, p),
  hashtagFeed: (tag: string, p?: ListParams) => list<FeedItem>(`/v1/hashtags/${enc(tag)}`, p),
  searchPosts: (q: string, p?: ListParams) => list<FeedItem>("/v1/search/posts", p, { q }),

  /* Accounts */
  profile: (account: string, viewer?: string | null, signal?: AbortSignal) =>
    apiFetch<Profile>(`/v1/accounts/${enc(account)}`, { query: { viewer }, signal }),
  accountPosts: (account: string, p?: ListParams) =>
    list<FeedItem>(`/v1/accounts/${enc(account)}/posts`, p),
  accountReplies: (account: string, p?: ListParams) =>
    list<FeedItem>(`/v1/accounts/${enc(account)}/replies`, p),
  accountMedia: (account: string, p?: ListParams) =>
    list<FeedItem>(`/v1/accounts/${enc(account)}/media`, p),
  accountLikes: (account: string, p?: ListParams) =>
    list<FeedItem>(`/v1/accounts/${enc(account)}/likes`, p),
  followers: (account: string, p?: ListParams) =>
    list<AccountCard>(`/v1/accounts/${enc(account)}/followers`, p),
  following: (account: string, p?: ListParams) =>
    list<AccountCard>(`/v1/accounts/${enc(account)}/following`, p),
  searchAccounts: (q: string, p?: ListParams) =>
    list<AccountCard>("/v1/search/accounts", p, { q }),
  suggestions: (p?: ListParams) => list<AccountCard>("/v1/suggestions", p),

  /* Posts */
  thread: (account: string, postId: string, viewer?: string | null, signal?: AbortSignal) =>
    apiFetch<ThreadResponse>(`/v1/posts/${enc(account)}/${enc(postId)}`, {
      query: { viewer },
      signal,
    }),
  replies: (account: string, postId: string, p?: ListParams) =>
    list<FeedItem>(`/v1/posts/${enc(account)}/${enc(postId)}/replies`, p),
  quotes: (account: string, postId: string, p?: ListParams) =>
    list<FeedItem>(`/v1/posts/${enc(account)}/${enc(postId)}/quotes`, p),
  likers: (account: string, postId: string, p?: ListParams) =>
    list<AccountCard>(`/v1/posts/${enc(account)}/${enc(postId)}/likes`, p),
  reposters: (account: string, postId: string, p?: ListParams) =>
    list<AccountCard>(`/v1/posts/${enc(account)}/${enc(postId)}/reposts`, p),
  /** Unfurls the post's `link` when the server hadn't cached its preview yet. */
  postPreview: (account: string, postId: string, signal?: AbortSignal) =>
    apiFetch<PostPreviewResponse>(`/v1/posts/${enc(account)}/${enc(postId)}/preview`, { signal }),
  postsBatch: (keys: string[], viewer?: string | null, signal?: AbortSignal) =>
    apiFetch<{ items: (Post | null)[] }>("/v1/posts/batch", {
      method: "POST",
      body: viewer ? { keys, viewer } : { keys },
      signal,
    }),

  /* Hashtags */
  trending: (signal?: AbortSignal) =>
    apiFetch<{ items: TrendingTag[] }>("/v1/hashtags/trending", { signal }),

  /* Notifications */
  notifications: (account: string, p?: ListParams) =>
    list<Notification>(`/v1/notifications/${enc(account)}`, p),
  notificationCount: (account: string, since: number, signal?: AbortSignal) =>
    apiFetch<{ count: number }>(`/v1/notifications/${enc(account)}/count`, {
      query: { since },
      signal,
    }),

  /* Transactions */
  tx: (hash: string, signal?: AbortSignal) =>
    apiFetch<TxOutcome>(`/v1/tx/${enc(hash)}`, { signal }),

  /* Migration */
  legacy: (account: string, signal?: AbortSignal) =>
    apiFetch<LegacyAccount>(`/v1/legacy/${enc(account)}`, { signal, timeoutMs: 20000 }),
  /** Absolute URL of a legacy image proxy path (`proxy_url` is relative to the API base). */
  legacyImageUrl: (proxyPath: string) => apiUrl(proxyPath),

  /* Docs (raw markdown) */
  markdown: async (name: "standard.md" | "skill.md" | "api.md"): Promise<string> => {
    const res = await fetch(apiUrl(`/${name}`), {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new ApiError(res.status, "http_error");
    return res.text();
  },
};

export function streamUrl(): string {
  return apiUrl("/v1/stream");
}
