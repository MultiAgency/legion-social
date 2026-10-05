"use client";

import { useQuery } from "@tanstack/react-query";
import { builderQuery, membershipQuery } from "@/lib/legion/membership";
import { HOME_FEEDS, NAME_SUFFIX, type HomeFeedId } from "@/lib/legion/home-feeds";
import { FeedIcon } from "./feed-icon";

/**
 * Whether the signed-in account may post in a home feed: Everyone, anyone signed in; Legion, a
 * rank; .agency, an account named `*.agency`; Builders, a NearBuilders member. `undefined` while
 * it's being checked.
 */
export function useCanPost(id: HomeFeedId, accountId: string | null): boolean | undefined {
  const member = useQuery({ ...membershipQuery(accountId ?? ""), enabled: !!accountId && id === "legion" });
  const builder = useQuery({ ...builderQuery(accountId ?? ""), enabled: !!accountId && id === "builders" });
  if (!accountId) return false;
  switch (id) {
    case "everyone":
      return true;
    case "legion":
      return member.isPending ? undefined : member.data?.rank != null;
    case "agency":
      return accountId.endsWith(`.${NAME_SUFFIX}`);
    case "builders":
      return builder.isPending ? undefined : builder.data?.builder === true;
  }
}

/** What a home feed is, who posts there, where it shows, and whether you can post. */
export function FeedAbout({ id, canPost }: { id: HomeFeedId; canPost: boolean | undefined }) {
  const feed = HOME_FEEDS.find((f) => f.id === id)!;
  return (
    <section aria-live="polite" className="border-b px-4 py-3.5">
      <p className="mb-2 mt-0.5 text-[17px] font-semibold tracking-tight">{feed.purpose}</p>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Who posts</dt>
        <dd>{feed.who}</dd>
        <dt className="text-muted-foreground">Where it shows</dt>
        <dd>{feed.shows}</dd>
      </dl>
      <p className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-link">
        <FeedIcon id={id} className="size-[15px] rounded-[4px]" />
        Demo: {feed.demo}
      </p>
      {canPost !== undefined && (
        <p className="mt-2.5 flex flex-wrap items-baseline gap-2 text-sm">
          {canPost ? (
            <span className="font-semibold text-link">You can post here.</span>
          ) : (
            <>
              <span className="font-semibold">You can read, not post.</span>
              {feed.howTo && (
                <span>
                  {feed.howTo.text}
                  {feed.howTo.href && (
                    <>
                      {" "}
                      <a href={feed.howTo.href} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
                        {feed.howTo.link}
                      </a>
                      .
                    </>
                  )}
                </span>
              )}
            </>
          )}
        </p>
      )}
    </section>
  );
}
