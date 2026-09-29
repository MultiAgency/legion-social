import { HydrationBoundary } from "@tanstack/react-query";
import { accountListQuery } from "@/lib/api/queries";
import { getViewer, prefetch } from "@/lib/api/server";
import { SidebarCard } from "./sidebar-card";
import { WhoToFollowList } from "./who-to-follow-list";

export const SUGGESTIONS_LIMIT = 3;

export async function WhoToFollow() {
  const viewer = await getViewer();
  const state = await prefetch((qc) =>
    qc.prefetchInfiniteQuery(accountListQuery({ kind: "suggestions" }, viewer, SUGGESTIONS_LIMIT)),
  );
  return (
    <SidebarCard title="Who to follow">
      <HydrationBoundary state={state}>
        <WhoToFollowList limit={SUGGESTIONS_LIMIT} />
      </HydrationBoundary>
    </SidebarCard>
  );
}
