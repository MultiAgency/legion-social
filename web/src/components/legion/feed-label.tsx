import Link from "next/link";
import { Hash, ShieldCheck } from "lucide-react";
import { feedHref, legionFeed } from "@/lib/legion/feed";

/** A feed's name: "Members only" for the Legion feed, else "@account". */
export function feedName(channel: string): string {
  return channel === legionFeed ? "Members only" : `@${channel}`;
}

/** The small line on a feed post: "Members only" for the Legion feed, else "in @account". */
export function FeedLabel({ channel }: { channel: string | null | undefined }) {
  if (!channel || !legionFeed) return null;
  const legion = channel === legionFeed;
  return (
    <Link
      href={feedHref(channel)}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-link hover:underline"
    >
      {legion ? <ShieldCheck className="size-3" aria-hidden /> : <Hash className="size-3" aria-hidden />}
      {legion ? feedName(channel) : `in ${feedName(channel)}`}
    </Link>
  );
}
