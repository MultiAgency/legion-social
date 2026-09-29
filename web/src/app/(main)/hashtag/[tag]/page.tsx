import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { HydrationBoundary } from "@tanstack/react-query";
import { feedQuery } from "@/lib/api/queries";
import { getViewer, prefetch } from "@/lib/api/server";
import { normalizeHashtag } from "@/lib/social/text";
import { HashtagView } from "@/components/search/hashtag-view";

type Params = Promise<{ tag: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const tag = normalizeHashtag(decodeURIComponent((await params).tag));
  return tag ? { title: `#${tag}`, description: `Posts tagged #${tag} on near.social` } : {};
}

export default async function HashtagPage({ params }: { params: Params }) {
  const raw = decodeURIComponent((await params).tag).replace(/^#/, "");
  const tag = normalizeHashtag(raw);
  if (!tag) notFound();
  if (tag !== raw) redirect(`/hashtag/${encodeURIComponent(tag)}`);
  const viewer = await getViewer();
  const state = await prefetch((qc) => qc.prefetchInfiniteQuery(feedQuery({ kind: "hashtag", tag }, viewer)));
  return (
    <HydrationBoundary state={state}>
      <HashtagView tag={tag} />
    </HydrationBoundary>
  );
}
