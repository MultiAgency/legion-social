"use client";

import * as React from "react";
import {
  Heart,
  Link2,
  MessageCircle,
  PenLine,
  Repeat2,
  Share,
} from "lucide-react";
import { toast } from "sonner";
import type { Post } from "@/lib/api/types";
import { useAccount } from "@/components/providers/account-provider";
import { useComposer } from "@/components/composer/composer-provider";
import { useLikeToggle, useRepostToggle } from "@/lib/social/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatCount } from "@/lib/utils";
import { postHref } from "./quoted-post";

export function copyPostLink(key: string) {
  const url = `${window.location.origin}${postHref(key)}`;
  void navigator.clipboard?.writeText(url).then(
    () => toast.success("Link copied"),
    () => toast.error("Couldn't copy the link"),
  );
}

function Count({ value, className }: { value: number; className?: string }) {
  if (value <= 0) return <span className={cn("min-w-[1ch]", className)} />;
  return (
    <span key={value} className={cn("min-w-[1ch] animate-count-up tabular-nums", className)}>
      {formatCount(value)}
    </span>
  );
}

const actionBtn =
  "group/action flex items-center gap-1 rounded-full text-[13px] text-muted-foreground transition-colors disabled:opacity-50";
const iconWrap = "grid size-[34px] place-items-center rounded-full transition-colors";

export function PostActions({
  post,
  size = "default",
  className,
}: {
  post: Post;
  size?: "default" | "large";
  className?: string;
}) {
  const { requireKey } = useAccount();
  const composer = useComposer();
  const toggleLike = useLikeToggle();
  const toggleRepost = useRepostToggle();
  const liked = post.viewer?.liked ?? false;
  const reposted = post.viewer?.reposted ?? false;
  // Like X, the repost count includes quote posts.
  const repostCount = post.counts.reposts + post.counts.quotes;
  const disabled = !!post._pending;
  const [likeBurst, setLikeBurst] = React.useState(0);
  const iconSize = size === "large" ? "size-[22px]" : "size-[18px]";

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className={cn("flex items-center justify-between", size === "large" ? "px-1" : "-ml-2 max-w-[440px] pr-2", className)}
      onClick={stop}
    >
      <button
        type="button"
        disabled={disabled}
        className={cn(actionBtn, "hover:text-link")}
        aria-label={`Reply${post.counts.replies ? `, ${post.counts.replies} replies` : ""}`}
        onClick={() => {
          if (requireKey()) composer.open({ replyTo: post });
        }}
      >
        <span className={cn(iconWrap, "group-hover/action:bg-link/10")}>
          <MessageCircle className={iconSize} />
        </span>
        {size === "default" && <Count value={post.counts.replies} />}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(actionBtn, "hover:text-repost", reposted && "text-repost")}
            aria-label={`${reposted ? "Undo repost" : "Repost"}${repostCount ? `, ${repostCount} reposts and quotes` : ""}`}
          >
            <span className={cn(iconWrap, "group-hover/action:bg-repost/10")}>
              <Repeat2 className={iconSize} strokeWidth={reposted ? 2.6 : 2} />
            </span>
            {size === "default" && <Count value={repostCount} />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={stop}>
          <DropdownMenuItem onSelect={() => toggleRepost(post)}>
            <Repeat2 />
            {reposted ? "Undo repost" : "Repost"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              if (requireKey()) composer.open({ quote: post });
            }}
          >
            <PenLine />
            Quote
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        disabled={disabled}
        className={cn(actionBtn, "hover:text-like", liked && "text-like")}
        aria-pressed={liked}
        aria-label={`${liked ? "Unlike" : "Like"}${post.counts.likes ? `, ${post.counts.likes} likes` : ""}`}
        onClick={() => {
          if (!liked) setLikeBurst((n) => n + 1);
          toggleLike(post);
        }}
      >
        <span className={cn(iconWrap, "group-hover/action:bg-like/10")}>
          <Heart
            key={likeBurst}
            className={cn(iconSize, liked && "fill-current", likeBurst > 0 && liked && "animate-heart-pop")}
          />
        </span>
        {size === "default" && <Count value={post.counts.likes} />}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button type="button" className={cn(actionBtn, "hover:text-link")} aria-label="Share">
            <span className={cn(iconWrap, "group-hover/action:bg-link/10")}>
              <Share className={iconSize} />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={stop}>
          <DropdownMenuItem onSelect={() => copyPostLink(post.key)}>
            <Link2 />
            Copy link
          </DropdownMenuItem>
          {typeof navigator !== "undefined" && "share" in navigator && (
            <DropdownMenuItem
              onSelect={() => {
                void navigator
                  .share({ url: `${window.location.origin}${postHref(post.key)}` })
                  .catch(() => undefined);
              }}
            >
              <Share />
              Share via…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
