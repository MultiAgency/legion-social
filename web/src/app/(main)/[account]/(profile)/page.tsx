import { redirect } from "next/navigation";
import { getViewer } from "@/lib/api/server";
import { channelHref } from "@/lib/channels/links";
import { leadsWithFeed } from "@/components/channels/feed-route";
import { renderProfileFeed } from "./profile-feed-page";

export default async function Page({ params }: { params: Promise<{ account: string }> }) {
  const account = decodeURIComponent((await params).account);
  // An account that is only a feed (no profile, posts sent to it) opens on its Feed tab.
  if (await leadsWithFeed(account, await getViewer())) redirect(channelHref(account));
  return renderProfileFeed(params, "posts");
}
