"use client";

import { Feed } from "@/components/feed/feed";
import { PageHeader } from "@/components/shell/page-header";
import { feedName } from "@/components/legion/feed-label";

export function HashtagView({ tag, channel = null }: { tag: string; channel?: string | null }) {
  return (
    <>
      <PageHeader back title={`#${tag}`} subtitle={channel ? `Hashtag · ${feedName(channel)}` : "Hashtag"} />
      <Feed
        spec={{ kind: "hashtag", tag, channel }}
        empty={{ title: `No posts with #${tag} yet`, body: "Posts using this hashtag will show up here." }}
      />
    </>
  );
}
