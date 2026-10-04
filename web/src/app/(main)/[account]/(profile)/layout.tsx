import type { Metadata } from "next";
import { HydrationBoundary } from "@tanstack/react-query";
import { qk } from "@/lib/api/queries";
import { getProfileCached, getViewer, prefetch } from "@/lib/api/server";
import { isAccountId } from "@/lib/social/standard";
import { siteName } from "@/lib/brand";
import { ProfileHeader, ProfileTabs } from "@/components/profile/profile-header";

type Params = Promise<{ account: string }>;

function truncate(s: string, n: number) {
  const chars = [...s];
  return chars.length > n ? `${chars.slice(0, n - 1).join("")}…` : s;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const account = decodeURIComponent((await params).account);
  if (!isAccountId(account)) return {};
  const viewer = await getViewer();
  try {
    const p = await getProfileCached(account, viewer);
    const name = p.name?.trim() || account;
    const title = `${name} (@${account})`;
    const description = p.about ? truncate(p.about, 200) : `@${account} on ${siteName}`;
    const images = p.avatar_url ? [{ url: p.avatar_url, width: 400, height: 400, alt: name }] : undefined;
    return {
      title,
      description,
      openGraph: { title, description, type: "profile", images },
      twitter: { card: "summary", title, description, images: p.avatar_url ? [p.avatar_url] : undefined },
    };
  } catch {
    return { title: `@${account}` };
  }
}

export default async function ProfileLayout({
  params,
  children,
}: {
  params: Params;
  children: React.ReactNode;
}) {
  const account = decodeURIComponent((await params).account);
  const viewer = await getViewer();
  const state = await prefetch(async (qc) => {
    qc.setQueryData(qk.profile(account, viewer), await getProfileCached(account, viewer));
  });
  return (
    <HydrationBoundary state={state}>
      <ProfileHeader account={account} />
      <ProfileTabs account={account} />
      {children}
    </HydrationBoundary>
  );
}
