"use client";

import { Feed } from "@/components/feed/feed";
import { PageHeader } from "@/components/shell/page-header";
import { feedName } from "./channel-label";

export function ChannelView({ channel }: { channel: string }) {
  return (
    <>
      <PageHeader back title={feedName(channel)} subtitle="Feed" />
      <Feed
        spec={{ kind: "channel", channel }}
        empty={{
          title: `Nothing in ${feedName(channel)} yet`,
          body: "Posts written to this feed show up here.",
        }}
      />
    </>
  );
}
