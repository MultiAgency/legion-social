import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { HydrationBoundary } from "@tanstack/react-query";
import { feedQuery } from "@/lib/api/queries";
import { getViewer, prefetch } from "@/lib/api/server";
import { multiFeed } from "@/lib/legion/feed";
import { hashtagFeed } from "@/lib/legion/home-feeds";
import { normalizeHashtag } from "@/lib/social/text";
import { siteName } from "@/lib/brand";
import { HashtagView } from "@/components/search/hashtag-view";
import { HashtagFeeds } from "@/components/legion/hashtag-feeds";

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
  // `?feed=`: the tag within one pinned feed (docs/LEGION.md §4.4); without it, upstream's.
  const { id, spec } = hashtagFeed(tag, (await searchParams).feed);
  if (tag !== raw) redirect(`/hashtag/${encodeURIComponent(tag)}${id === "everyone" ? "" : `?feed=${id}`}`);
  const viewer = await getViewer();
  const state = await prefetch((qc) => qc.prefetchInfiniteQuery(feedQuery(spec, viewer)));
  return (
    <HydrationBoundary state={state}>
      {multiFeed ? <HashtagFeeds tag={tag} id={id} spec={spec} /> : <HashtagView tag={tag} />}
    </HydrationBoundary>
  );
}
