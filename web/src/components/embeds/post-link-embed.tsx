"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { Post } from "@/lib/api/types";
import { previewQuery } from "@/lib/api/queries";
import { needsPreviewFetch, resolvePostLink, type PostLinkView } from "@/lib/social/links";
import { LinkCard } from "./link-card";
import { YoutubeEmbed } from "./youtube-embed";
import { NearFmPlayer, UnavailableEmbed } from "./near-fm-player";

/**
 * What a post shows for its link (text without the trailing URL, quote, embed). Fetches the
 * preview lazily when the server hadn't unfurled the link yet.
 */
export function usePostLink(post: Post): PostLinkView {
  const { data } = useQuery({
    ...previewQuery(post.key, post.link?.url ?? ""),
    enabled: needsPreviewFetch(post),
  });
  return React.useMemo(() => resolvePostLink(post, data), [post, data]);
}

/** The card, YouTube embed or near.fm player for a post's link. */
export function PostLinkEmbed({
  embed,
  className,
}: {
  embed: NonNullable<PostLinkView["embed"]>;
  className?: string;
}) {
  const { url, preview } = embed;
  switch (preview.kind) {
    case "card":
      return <LinkCard key={url} url={url} preview={preview} className={className} />;
    case "youtube":
      return <YoutubeEmbed key={url} preview={preview} className={className} />;
    case "near_fm":
      return <NearFmPlayer key={url} url={url} song={preview} className={className} />;
    case "unavailable":
      return <UnavailableEmbed url={url} className={className} />;
  }
}
