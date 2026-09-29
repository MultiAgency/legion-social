import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HydrationBoundary } from "@tanstack/react-query";
import { isNotFound } from "@/lib/api/client";
import { feedQuery, qk } from "@/lib/api/queries";
import { getThreadCached, getViewer, prefetch } from "@/lib/api/server";
import type { ThreadResponse } from "@/lib/api/types";
import { isAccountId, isPostId } from "@/lib/social/standard";
import { ThreadView } from "@/components/thread/thread-view";

type Params = Promise<{ account: string; id: string }>;

function truncate(s: string, n: number) {
  const chars = [...s];
  return chars.length > n ? `${chars.slice(0, n - 1).join("")}…` : s;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { account: raw, id } = await params;
  const account = decodeURIComponent(raw);
  if (!isAccountId(account) || !isPostId(id)) return {};
  const viewer = await getViewer();
  try {
    const { post } = await getThreadCached(account, id, viewer);
    const name = post.author.name?.trim() || account;
    const title = `${name} on near.social`;
    const description = post.text ? truncate(post.text.replace(/\s+/g, " ").trim(), 200) : `A post by @${account}`;
    const media = post.media[0];
    const image = media?.url
      ? { url: media.url, width: media.w ?? undefined, height: media.h ?? undefined, alt: media.alt ?? "" }
      : post.author.avatar_url
        ? { url: post.author.avatar_url, width: 400, height: 400, alt: name }
        : undefined;
    return {
      title: `${name}: “${truncate(description, 60)}”`,
      description,
      openGraph: {
        title,
        description,
        type: "article",
        publishedTime: new Date(post.created_at).toISOString(),
        images: image ? [image] : undefined,
      },
      twitter: {
        card: media ? "summary_large_image" : "summary",
        title,
        description,
        images: image ? [image.url] : undefined,
      },
    };
  } catch {
    return { title: "Post" };
  }
}

export default async function PostPage({ params }: { params: Params }) {
  const { account: raw, id } = await params;
  const account = decodeURIComponent(raw);
  if (!isAccountId(account) || !isPostId(id)) notFound();
  const viewer = await getViewer();
  const key = `${account}/${id}`;

  let thread: ThreadResponse | null = null;
  try {
    thread = await getThreadCached(account, id, viewer);
  } catch (err) {
    if (isNotFound(err)) notFound();
  }

  const state = await prefetch(async (qc) => {
    if (thread) qc.setQueryData(qk.thread(key, viewer), thread);
    await qc.prefetchInfiniteQuery(feedQuery({ kind: "replies", postKey: key }, viewer));
  });

  return (
    <HydrationBoundary state={state}>
      <ThreadView postKey={key} />
    </HydrationBoundary>
  );
}
