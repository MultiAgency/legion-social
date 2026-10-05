"use client";

import { useQuery } from "@tanstack/react-query";
import { builderQuery, membershipQuery } from "@/lib/legion/membership";
import { HOME_FEEDS, NAME_SUFFIX, type HomeFeedId, type PickedFeedId } from "@/lib/legion/home-feeds";

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

/**
 * One quiet line under the tabs on a pinned feed: who posts there and where it shows, plus how to
 * post for a signed-in account that can't. Everyone (upstream's tabs) has none.
 */
export function FeedNote({ id, signedIn, canPost }: { id: PickedFeedId; signedIn: boolean; canPost: boolean | undefined }) {
  const feed = HOME_FEEDS.find((f) => f.id === id)!;
  return (
    <p aria-live="polite" className="border-b px-4 py-3 text-[15px] leading-snug text-muted-foreground">
      {feed.note}
      {signedIn && canPost === false && (
        <>
          {" "}
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
        </>
      )}
    </p>
  );
}
