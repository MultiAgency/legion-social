"use client";

import Link from "next/link";
import { useAccount } from "@/components/providers/account-provider";
import { Composer } from "@/components/composer/composer";
import { Feed } from "@/components/feed/feed";
import { SignInHero } from "@/components/home/sign-in-hero";
import { HeaderTabs, PageHeader } from "@/components/shell/page-header";
import type { FeedSpec, HomeTab } from "@/lib/api/queries";
import { destinationFor, homeFeedId, type HomeFeedId } from "@/lib/legion/home-feeds";
import { FeedAbout, useCanPost } from "./feed-about";
import { FeedSwitcher } from "./feed-switcher";

/**
 * Home with feeds to switch between (docs/LEGION.md §4): Everyone keeps upstream's For you /
 * Following / Latest; Legion, .agency and Builders are newest first. Each feed says who posts
 * there, and the post box shows only to those who can.
 */
export function HomeFeeds({ tab, spec, onActiveClick }: { tab: HomeTab; spec: FeedSpec; onActiveClick: () => void }) {
  const { accountId } = useAccount();
  const id: HomeFeedId = homeFeedId(tab);
  const canPost = useCanPost(id, accountId);
  const destination = destinationFor(id);

  return (
    <>
      <PageHeader title="Home" brandOnMobile>
        {id === "everyone" && (
          <HeaderTabs
            replace
            onActiveClick={onActiveClick}
            tabs={[
              { href: "/", label: "For you", active: tab === "for_you" },
              ...(accountId ? [{ href: "/?feed=following", label: "Following", active: tab === "following" }] : []),
              { href: "/?feed=latest", label: "Latest", active: tab === "latest" },
            ]}
          />
        )}
        <FeedSwitcher current={id} />
      </PageHeader>
      <FeedAbout id={id} canPost={canPost} />
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
      title: "No members-only posts yet",
      body: canPost ? "Write the first post. It stays off near.social." : "Members' posts will show here.",
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
