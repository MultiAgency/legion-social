import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { dehydrate, type DehydratedState, type QueryClient } from "@tanstack/react-query";
import { isAccountId } from "@/lib/social/standard";
import { VIEWER_COOKIE } from "@/lib/viewer-cookie";
import { api } from "./client";
import { makeQueryClient } from "./query-client";

/**
 * The signed-in account hint from the `ns_viewer` cookie. It is only used to personalise reads
 * (viewer flags, following feed); it is not a credential.
 */
export const getViewer = cache(async (): Promise<string | null> => {
  try {
    const store = await cookies();
    const raw = store.get(VIEWER_COOKIE)?.value;
    return raw && isAccountId(raw) ? raw : null;
  } catch {
    return null;
  }
});

/** Request-deduplicated fetches shared by `generateMetadata` and the page body. */
export const getProfileCached = cache((account: string, viewer: string | null) =>
  api.profile(account, viewer),
);

export const getThreadCached = cache((account: string, postId: string, viewer: string | null) =>
  api.thread(account, postId, viewer),
);

/**
 * Runs prefetches against a fresh QueryClient and returns its dehydrated state. Failed
 * prefetches are simply left out; the client refetches and renders its own error state.
 */
export async function prefetch(
  fn: (qc: QueryClient) => Promise<unknown>,
): Promise<DehydratedState> {
  const qc = makeQueryClient();
  try {
    await fn(qc);
  } catch {
    /* never fail the render because the API is down */
  }
  return dehydrate(qc);
}
