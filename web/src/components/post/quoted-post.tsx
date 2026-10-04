"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { isFullPost, type Post } from "@/lib/api/types";
import { UserAvatar } from "@/components/account/user-avatar";
import { NameLine } from "@/components/account/names";
import { RelativeTime } from "@/components/common/timestamp";
import { RichText } from "./post-text";
import { PostMediaGrid } from "./post-media";
import { cn } from "@/lib/utils";

export function postHref(key: string): string {
  const i = key.lastIndexOf("/");
  return `/${key.slice(0, i)}/post/${key.slice(i + 1)}`;
}

/** Embedded quoted post (compact). Never renders link previews: nested posts have `link: null`. */
export function QuotedPost({
  quote,
  className,
  interactive = true,
}: {
  quote: Post["quote"];
  className?: string;
  interactive?: boolean;
}) {
  const router = useRouter();
  if (!quote) return null;
  if (!isFullPost(quote)) {
    return (
      <div className={cn("rounded-2xl border bg-muted/40 px-4 py-3 text-[15px] text-muted-foreground", className)}>
        This post is unavailable.
      </div>
    );
  }
  const href = postHref(quote.key);
  return (
    <div
      role={interactive ? "link" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={(e) => {
        if (!interactive) return;
        e.stopPropagation();
        if ((e.target as HTMLElement).closest("a,button")) return;
        router.push(href);
      }}
      onKeyDown={(e) => {
        if (interactive && e.key === "Enter") {
          e.stopPropagation();
          router.push(href);
        }
      }}
      className={cn(
        "overflow-hidden rounded-2xl border transition-colors",
        interactive && "cursor-pointer hover:bg-accent/40",
        className,
      )}
    >
      <div className="px-3 pt-2.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[15px]">
          <UserAvatar accountId={quote.author.account_id} src={quote.author.avatar_url} size={20} />
          <NameLine accountId={quote.author.account_id} name={quote.author.name} rank={quote.author.rank} className="min-w-0" />
          <span className="text-muted-foreground">·</span>
          <Link prefetch={false} href={href} className="shrink-0 text-muted-foreground hover:underline" onClick={(e) => e.stopPropagation()}>
            <RelativeTime ms={quote.created_at} />
          </Link>
        </div>
        {quote.text && (
          <div className="mt-1 pb-2.5 text-[15px] leading-snug">
            <div className="line-clamp-6">
              <RichText text={quote.text} />
            </div>
          </div>
        )}
      </div>
      {quote.media.length > 0 && (
        <PostMediaGrid media={quote.media.slice(0, 4)} className={cn("rounded-none border-0 border-t", !quote.text && "mt-2")} />
      )}
      {!quote.text && quote.media.length === 0 && <div className="pb-2.5" />}
    </div>
  );
}
