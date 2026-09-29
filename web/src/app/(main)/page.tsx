import { HydrationBoundary } from "@tanstack/react-query";
import { feedQuery, homeFeed } from "@/lib/api/queries";
import { getViewer, prefetch } from "@/lib/api/server";
import { HomeFeed } from "@/components/home/home-feed";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()]);
  // The active tab (For you by default) is prefetched so it's in the first paint.
  const { spec } = homeFeed(params.feed, viewer);
  const state = await prefetch((qc) => qc.prefetchInfiniteQuery(feedQuery(spec, viewer)));
  return (
    <HydrationBoundary state={state}>
      <HomeFeed />
    </HydrationBoundary>
  );
}
