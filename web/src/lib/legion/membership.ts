import { queryOptions } from "@tanstack/react-query";
import { apiFetch, isNotFound } from "@/lib/api/client";
import type { Rank } from "./rank";

/** `GET /v1/legion/{account}` (docs/LEGION.md §1). `rank` is null for a non-member. */
export interface Membership {
  account_id: string;
  rank: Rank | null;
  checked_at: number;
}

/** The account's membership, or null when the server runs without Legion (404). */
export async function fetchMembership(account: string, signal?: AbortSignal): Promise<Membership | null> {
  try {
    return await apiFetch<Membership>(`/v1/legion/${encodeURIComponent(account)}`, { signal });
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export function membershipQuery(account: string) {
  return queryOptions({
    queryKey: ["ns", "legion", account] as const,
    queryFn: ({ signal }) => fetchMembership(account, signal),
    staleTime: 5 * 60_000,
  });
}

/** `GET /v1/builders/{account}` (docs/LEGION.md §4.3). */
export interface BuilderStatus {
  account_id: string;
  builder: boolean;
}

/** Whether the account is a NearBuilders member; null when the server runs without Legion (404). */
export async function fetchBuilder(account: string, signal?: AbortSignal): Promise<BuilderStatus | null> {
  try {
    return await apiFetch<BuilderStatus>(`/v1/builders/${encodeURIComponent(account)}`, { signal });
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export function builderQuery(account: string) {
  return queryOptions({
    queryKey: ["ns", "builder", account] as const,
    queryFn: ({ signal }) => fetchBuilder(account, signal),
    staleTime: 5 * 60_000,
  });
}
