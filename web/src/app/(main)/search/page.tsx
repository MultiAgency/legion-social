import type { Metadata } from "next";
import { HydrationBoundary } from "@tanstack/react-query";
import { accountListQuery, feedQuery, SEARCH_ACCOUNTS_PREVIEW } from "@/lib/api/queries";
import { getViewer, prefetch } from "@/lib/api/server";
import { SearchView } from "@/components/search/search-view";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const q = first((await searchParams).q).trim();
  return { title: q ? `${q} - Search` : "Search" };
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const [sp, viewer] = await Promise.all([searchParams, getViewer()]);
  const q = first(sp.q).trim().slice(0, 200);
  // Posts by default (with the top matching accounts above them).
  const type = first(sp.type) === "accounts" ? "accounts" : "posts";
  const state = await prefetch(async (qc) => {
    if (q) {
      if (type === "posts") {
        await Promise.all([
          qc.prefetchInfiniteQuery(feedQuery({ kind: "search", q }, viewer)),
          qc.prefetchInfiniteQuery(accountListQuery({ kind: "search", q }, viewer, SEARCH_ACCOUNTS_PREVIEW)),
        ]);
      } else {
        await qc.prefetchInfiniteQuery(accountListQuery({ kind: "search", q }, viewer));
      }
    } else {
      await qc.prefetchInfiniteQuery(accountListQuery({ kind: "suggestions" }, viewer));
    }
  });
  return (
    <HydrationBoundary state={state}>
      <SearchView q={q} type={type} />
    </HydrationBoundary>
  );
}
