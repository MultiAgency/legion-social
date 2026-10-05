"use client";

import { Feed } from "@/components/feed/feed";
import { PageHeader } from "@/components/shell/page-header";

export function HashtagView({ tag }: { tag: string }) {
  return (
    <>
      <PageHeader back title={`#${tag}`} subtitle="Hashtag" />
      <Feed
        spec={{ kind: "hashtag", tag }}
        empty={{ title: `No posts with #${tag} yet`, body: "Posts using this hashtag will show up here." }}
      />
    </>
  );
}
