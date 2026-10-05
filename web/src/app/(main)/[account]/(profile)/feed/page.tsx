import { HydrationBoundary } from "@tanstack/react-query";
import { feedQuery } from "@/lib/api/queries";
import { getViewer, prefetch } from "@/lib/api/server";
import { ChannelFeed } from "@/components/channels/feed-tab";

/** `/{account}/feed`: posts sent to the account (docs/LEGION.md §3). */
export default async function Page({ params }: { params: Promise<{ account: string }> }) {
  const account = decodeURIComponent((await params).account);
  const viewer = await getViewer();
  const state = await prefetch((qc) =>
    qc.prefetchInfiniteQuery(feedQuery({ kind: "channel", channel: account }, viewer)),
  );
  return (
    <HydrationBoundary state={state}>
      <ChannelFeed account={account} />
    </HydrationBoundary>
  );
}
