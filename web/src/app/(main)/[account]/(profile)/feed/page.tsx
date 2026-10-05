import { notFound } from "next/navigation";
import { HydrationBoundary } from "@tanstack/react-query";
import { multiFeed } from "@/lib/legion/feed";
import { feedQuery } from "@/lib/api/queries";
import { getViewer, prefetch } from "@/lib/api/server";
import { ChannelFeed } from "@/components/legion/feed-tab";

/** `/{account}/feed`: posts sent to the account (docs/LEGION.md §3). Only with a Legion feed. */
export default async function Page({ params }: { params: Promise<{ account: string }> }) {
  if (!multiFeed) notFound();
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
