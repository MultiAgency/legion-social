import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HydrationBoundary } from "@tanstack/react-query";
import { feedQuery } from "@/lib/api/queries";
import { getViewer, prefetch } from "@/lib/api/server";
import { isAccountId } from "@/lib/social/standard";
import { siteName } from "@/lib/brand";
import { ChannelView } from "@/components/channels/channel-view";

type Params = Promise<{ channel: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const channel = decodeURIComponent((await params).channel);
  return isAccountId(channel) ? { title: `@${channel}`, description: `The @${channel} channel on ${siteName}` } : {};
}

export default async function ChannelPage({ params }: { params: Params }) {
  const channel = decodeURIComponent((await params).channel).toLowerCase();
  if (!isAccountId(channel)) notFound();
  const viewer = await getViewer();
  const state = await prefetch((qc) => qc.prefetchInfiniteQuery(feedQuery({ kind: "channel", channel }, viewer)));
  return (
    <HydrationBoundary state={state}>
      <ChannelView channel={channel} />
    </HydrationBoundary>
  );
}
