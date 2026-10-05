import Link from "next/link";
import { Hash } from "lucide-react";
import { feedHref, multiFeed } from "@/lib/legion/feed";
import { LegionMark } from "./legion-mark";

/** A feed's name: "Multi" for the Multi feed, else "@account". */
export function feedName(channel: string): string {
  return channel === multiFeed ? "Multi" : `@${channel}`;
}

/** The small line on a feed post: "Multi" for the Multi feed, else "in @account". */
export function FeedLabel({ channel }: { channel: string | null | undefined }) {
  if (!channel || !multiFeed) return null;
  const legion = channel === multiFeed;
  return (
    <Link
      href={feedHref(channel)}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-link hover:underline"
    >
      {legion ? <LegionMark className="size-3 rounded-[2px]" /> : <Hash className="size-3" aria-hidden />}
      {legion ? feedName(channel) : `in ${feedName(channel)}`}
    </Link>
  );
}
