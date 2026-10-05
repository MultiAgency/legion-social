"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useAccount } from "@/components/providers/account-provider";
import { Composer } from "@/components/composer/composer";
import { Feed } from "@/components/feed/feed";
import { SignInHero } from "@/components/home/sign-in-hero";
import { HeaderTabs, PageHeader } from "@/components/shell/page-header";
import type { FeedSpec, HomeTab } from "@/lib/api/queries";
import { destinationFor, HOME_FEEDS, homeFeedId, type HomeFeedId, type PickedFeedId } from "@/lib/legion/home-feeds";
import { FeedNote, useEligible } from "./feed-note";
import { HashtagTab } from "./hashtag-tab";

/**
 * Home with feeds (docs/LEGION.md §4): upstream's own tabs, For you / Following / Latest, are
 * Everyone, unchanged; Multi, Legion, .agency and Builders are pinned after them, each with one line
 * on who posts there. Each tab has one destination: Everyone and Legion post to `social`, Multi to
 * the Multi feed account, and .agency and Builders have no post box.
 */
export function HomeFeeds({ tab, spec, onActiveClick }: { tab: HomeTab; spec: FeedSpec; onActiveClick: () => void }) {
  const { accountId } = useAccount();
  const id: HomeFeedId = homeFeedId(tab);
  const pinned: PickedFeedId | null = id === "everyone" ? null : id;
  const eligible = useEligible(pinned ?? "legion", pinned ? accountId : null);
  const destination = pinned && destinationFor(pinned);
  const tabsRef = useRef<HTMLDivElement>(null);
  // Six tabs scroll sideways on a phone, starting at the left: keep the current one in view.
  useEffect(() => {
    tabsRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  return (
    <>
      <PageHeader title="Home" brandOnMobile>
        <div ref={tabsRef}>
          <HeaderTabs
            replace
            onActiveClick={onActiveClick}
            tabs={[
              { href: "/", label: "For you", active: tab === "for_you" },
              ...(accountId ? [{ href: "/?feed=following", label: "Following", active: tab === "following" }] : []),
              { href: "/?feed=latest", label: "Latest", active: tab === "latest" },
              ...HOME_FEEDS.map((f) => ({ href: `/?feed=${f.id}`, label: f.label, active: f.id === id })),
            ]}
          />
        </div>
      </PageHeader>
      {pinned && <FeedNote id={pinned} signedIn={!!accountId} eligible={eligible} />}
      {!accountId ? (
        !pinned && <SignInHero />
      ) : !pinned ? (
        <Composer variant="inline" />
      ) : (
        eligible &&
        destination && (
          <Composer
            key={id}
            variant="inline"
            destination={destination}
            placeholder={pinned === "legion" ? "Say something to the Legion…" : undefined}
          />
        )
      )}
      <HashtagTab.Provider value={pinned}>
        <Feed
          key={`${tab}:${accountId ?? ""}`}
          spec={spec}
          // For you isn't chronological, so "N new posts" doesn't apply there.
          newPostsPill={tab !== "for_you"}
          empty={emptyState(id, tab, eligible)}
        />
      </HashtagTab.Provider>
    </>
  );
}

function emptyState(id: HomeFeedId, tab: HomeTab, canPost: boolean | undefined) {
  if (id === "multi") {
    return { title: "Nothing in Multi yet", body: canPost ? "Write the first post. It stays off near.social." : undefined };
  }
  if (id === "legion") {
    return { title: "No Legion posts yet", body: canPost ? "Write the first one." : "Members' posts will show here." };
  }
  if (tab === "following") {
    return {
      title: "Nothing from the people you follow yet",
      body: (
        <>
          <Link href="/?feed=latest" className="text-link hover:underline">
            Browse the latest posts
          </Link>{" "}
          or{" "}
          <Link href="/search" className="text-link hover:underline">
            find people to follow
          </Link>
          .
        </>
      ),
    };
  }
  return { title: "No posts yet", body: canPost ? "Be the first to post something." : undefined };
}
