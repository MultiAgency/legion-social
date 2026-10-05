import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { HydrationBoundary } from "@tanstack/react-query";
import { feedQuery } from "@/lib/api/queries";
import { getViewer, prefetch } from "@/lib/api/server";
import { hashtagChannel } from "@/lib/legion/feed";
import { normalizeHashtag } from "@/lib/social/text";
import { siteName } from "@/lib/brand";
import { HashtagView } from "@/components/search/hashtag-view";

type Params = Promise<{ tag: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const tag = normalizeHashtag(decodeURIComponent((await params).tag));
  return tag ? { title: `#${tag}`, description: `Posts tagged #${tag} on ${siteName}` } : {};
}

export default async function HashtagPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const raw = decodeURIComponent((await params).tag).replace(/^#/, "");
  const tag = normalizeHashtag(raw);
  if (!tag) notFound();
  if (tag !== raw) redirect(`/hashtag/${encodeURIComponent(tag)}`);
  // `?channel=`: the tag within one feed (docs/LEGION.md §3).
  const channel = hashtagChannel((await searchParams).channel);
  const viewer = await getViewer();
  const state = await prefetch((qc) => qc.prefetchInfiniteQuery(feedQuery({ kind: "hashtag", tag, channel }, viewer)));
  return (
    <HydrationBoundary state={state}>
      <HashtagView tag={tag} channel={channel} />
    </HydrationBoundary>
  );
}
