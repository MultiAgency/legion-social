import type { Metadata } from "next";
import { renderProfileList } from "../profile-feed-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ account: string }>;
}): Promise<Metadata> {
  const account = decodeURIComponent((await params).account);
  return { title: "People following @" + account };
}

export default function Page({ params }: { params: Promise<{ account: string }> }) {
  return renderProfileList(params, "followers");
}
