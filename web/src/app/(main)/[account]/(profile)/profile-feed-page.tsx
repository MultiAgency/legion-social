import { HydrationBoundary } from "@tanstack/react-query";
import { feedQuery, accountListQuery, type AccountTab } from "@/lib/api/queries";
import { getViewer, prefetch } from "@/lib/api/server";
import { ProfileFeed, ProfileAccountList } from "@/components/profile/profile-feed";

export async function renderProfileFeed(paramsP: Promise<{ account: string }>, tab: AccountTab) {
  const account = decodeURIComponent((await paramsP).account);
  const viewer = await getViewer();
  const state = await prefetch((qc) =>
    qc.prefetchInfiniteQuery(feedQuery({ kind: "account", tab, account }, viewer)),
  );
  return (
    <HydrationBoundary state={state}>
      <ProfileFeed account={account} tab={tab} />
    </HydrationBoundary>
  );
}

export async function renderProfileList(
  paramsP: Promise<{ account: string }>,
  kind: "followers" | "following",
) {
  const account = decodeURIComponent((await paramsP).account);
  const viewer = await getViewer();
  const state = await prefetch((qc) =>
    qc.prefetchInfiniteQuery(accountListQuery({ kind, account }, viewer)),
  );
  return (
    <HydrationBoundary state={state}>
      <ProfileAccountList account={account} kind={kind} />
    </HydrationBoundary>
  );
}
