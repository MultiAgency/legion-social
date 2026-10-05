import Link from "next/link";
import { Hash, ShieldCheck } from "lucide-react";
import { channelHref } from "@/lib/channels/links";
import { legionFeed } from "@/lib/legion/feed";

/** A feed's name: "Legion only" for the Legion feed, else "@channel". */
export function feedName(channel: string): string {
  return channel === legionFeed ? "Legion only" : `@${channel}`;
}

/** The small line on a channel post: "Legion only" for the Legion feed, else "in @channel". */
export function ChannelLabel({ channel }: { channel: string | null | undefined }) {
  if (!channel) return null;
  const legion = channel === legionFeed;
  return (
    <Link
      href={channelHref(channel)}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-link hover:underline"
    >
      {legion ? <ShieldCheck className="size-3" aria-hidden /> : <Hash className="size-3" aria-hidden />}
      {legion ? feedName(channel) : `in ${feedName(channel)}`}
    </Link>
  );
}
