"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/components/providers/account-provider";
import { Composer } from "@/components/composer/composer";
import { Feed } from "@/components/feed/feed";
import { NonMemberNotice } from "@/components/legion/non-member-notice";
import { HeaderTabs, PageHeader } from "@/components/shell/page-header";
import { homeFeed, qk } from "@/lib/api/queries";
import { siteName } from "@/lib/brand";
import { SignInHero } from "./sign-in-hero";

export function HomeFeed() {
  const { accountId } = useAccount();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { tab, spec } = homeFeed(params.get("feed"), accountId);

  // Clicking the current tab again: back to the top with a fresh first page.
  const refresh = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    void qc.resetQueries({ queryKey: qk.feed(spec, accountId), exact: true });
  };

  return (
    <>
      <PageHeader title="Home" brandOnMobile>
        <HeaderTabs
          replace
          onActiveClick={refresh}
          tabs={[
            { href: "/", label: "For you", active: tab === "for_you" },
            ...(accountId
              ? [{ href: "/?feed=following", label: "Following", active: tab === "following" }]
              : []),
            { href: "/?feed=latest", label: "Latest", active: tab === "latest" },
          ]}
        />
      </PageHeader>
      {accountId ? (
        <>
          <NonMemberNotice accountId={accountId} />
          <Composer variant="inline" />
        </>
      ) : (
        <SignInHero />
      )}
      <Feed
        key={`${tab}:${accountId ?? ""}`}
        spec={spec}
        // For you isn't chronological, so "N new posts" doesn't apply there.
        newPostsPill={tab !== "for_you"}
        empty={
          tab === "following"
            ? {
                title: `Welcome to ${siteName}`,
                body: (
                  <>
                    Your timeline shows posts from you and the people you follow.{" "}
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
              }
            : { title: "No posts yet", body: "Be the first to post something." }
        }
      />
    </>
  );
}
