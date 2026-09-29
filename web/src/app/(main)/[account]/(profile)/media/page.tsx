import { renderProfileFeed } from "../profile-feed-page";

export default function Page({ params }: { params: Promise<{ account: string }> }) {
  return renderProfileFeed(params, "media");
}
