"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useAccount } from "@/components/providers/account-provider";
import { Composer } from "@/components/composer/composer";
import { Feed } from "@/components/feed/feed";
import { SignInHero } from "@/components/home/sign-in-hero";
import { HeaderTabs, PageHeader } from "@/components/shell/page-header";
import type { FeedSpec, HomeTab } from "@/lib/api/queries";
import { destinationFor, HOME_FEEDS, homeFeedId, type HomeFeedId } from "@/lib/legion/home-feeds";
import { FeedNote, useCanPost } from "./feed-note";

/**
 * Home with feeds (docs/LEGION.md §4): upstream's own tabs, For you / Following / Latest, are
 * Everyone, unchanged; Legion, .agency and Builders are pinned after them, each with one line on
 * who posts there. The post box shows only to those who can post in the current feed.
 */
export function HomeFeeds({ tab, spec, onActiveClick }: { tab: HomeTab; spec: FeedSpec; onActiveClick: () => void }) {
  const { accountId } = useAccount();
  const id: HomeFeedId = homeFeedId(tab);
  const canPost = useCanPost(id, accountId);
  const destination = destinationFor(id);
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
      {id !== "everyone" && <FeedNote id={id} signedIn={!!accountId} canPost={canPost} />}
      {!accountId ? (
        id === "everyone" && <SignInHero />
      ) : (
        canPost &&
        destination && (
          <Composer
            key={id}
            variant="inline"
            destination={destination}
            placeholder={id === "legion" ? "Say something to the Legion…" : undefined}
          />
        )
      )}
      <Feed
        key={`${tab}:${accountId ?? ""}`}
        spec={spec}
        // For you isn't chronological, so "N new posts" doesn't apply there.
        newPostsPill={tab !== "for_you"}
        empty={emptyState(id, tab, canPost)}
      />
    </>
  );
}

function emptyState(id: HomeFeedId, tab: HomeTab, canPost: boolean | undefined) {
  if (id === "legion") {
    return {
      title: "No Legion posts yet",
      body: canPost ? "Write the first one, for members only or in public." : "Members' posts will show here.",
    };
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
