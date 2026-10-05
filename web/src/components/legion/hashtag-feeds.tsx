"use client";

import { useAccount } from "@/components/providers/account-provider";
import { Feed } from "@/components/feed/feed";
import { HeaderTabs, PageHeader } from "@/components/shell/page-header";
import type { FeedSpec } from "@/lib/api/queries";
import { hashtagHref } from "@/lib/legion/feed";
import { HOME_FEEDS, type HomeFeedId } from "@/lib/legion/home-feeds";
import { FeedNote, useEligible } from "./feed-note";
import { HashtagTab } from "./hashtag-tab";

/**
 * A hashtag's page with feeds (docs/LEGION.md §4.4): Everyone is upstream's hashtag feed; each
 * pinned feed shows the tag within it (`?feed=`).
 */
export function HashtagFeeds({ tag, id, spec }: { tag: string; id: HomeFeedId; spec: FeedSpec }) {
  const { accountId } = useAccount();
  const pinned = id === "everyone" ? null : id;
  const eligible = useEligible(pinned ?? "legion", pinned ? accountId : null);
  return (
    <>
      <PageHeader back title={`#${tag}`} subtitle="Hashtag">
        <HeaderTabs
          replace
          tabs={[
            { href: hashtagHref(tag), label: "Everyone", active: id === "everyone" },
            ...HOME_FEEDS.map((f) => ({ href: hashtagHref(tag, f.id), label: f.label, active: f.id === id })),
          ]}
        />
      </PageHeader>
      {pinned && <FeedNote id={pinned} signedIn={!!accountId} eligible={eligible} />}
      <HashtagTab.Provider value={pinned}>
        <Feed
          key={id}
          spec={spec}
          empty={{ title: `No posts with #${tag} yet`, body: "Posts using this hashtag will show up here." }}
        />
      </HashtagTab.Provider>
    </>
  );
}
