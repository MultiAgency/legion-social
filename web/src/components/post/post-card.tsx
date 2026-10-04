"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Flame,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Repeat2,
  Trash2,
  VolumeX,
  Volume2,
} from "lucide-react";
import type { AccountSummary, FeedItem, Post } from "@/lib/api/types";
import { threadQuery } from "@/lib/api/queries";
import { useAccount } from "@/components/providers/account-provider";
import { useComposer } from "@/components/composer/composer-provider";
import { UserAvatar } from "@/components/account/user-avatar";
import { NameLine } from "@/components/account/names";
import { AccountHoverCard } from "@/components/account/account-hover-card";
import { PostLinkEmbed, usePostLink } from "@/components/embeds/post-link-embed";
import { RelativeTime } from "@/components/common/timestamp";
import { setMuted, useMutes } from "@/lib/local-store";
import { useDeletePost } from "@/lib/social/hooks";
import { fullTime } from "@/lib/time";
import { cn, formatCount, pluralize } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CollapsibleText, RichText } from "./post-text";
import { PostMediaGrid } from "./post-media";
import { QuotedPost, postHref } from "./quoted-post";
import { PostActions, copyPostLink } from "./post-actions";

function RepostHeader({ by }: { by: AccountSummary }) {
  const { accountId } = useAccount();
  return (
    <div className="-mb-1 flex items-center gap-2 pl-[34px] pt-2 text-[13px] font-semibold text-muted-foreground">
      <Repeat2 className="size-4" />
      <AccountHoverCard accountId={by.account_id}>
        <Link prefetch={false} href={`/${by.account_id}`} className="truncate hover:underline" onClick={(e) => e.stopPropagation()}>
          {by.account_id === accountId ? "You reposted" : `${by.name?.trim() || by.account_id} reposted`}
        </Link>
      </AccountHoverCard>
    </div>
  );
}

/** "For you" items picked from trending posts (`reason: "trending"`). */
function TrendingHeader() {
  return (
    <div className="-mb-1 flex items-center gap-2 pl-[34px] pt-2 text-[13px] font-semibold text-muted-foreground">
      <Flame className="size-4" />
      <span>Trending</span>
    </div>
  );
}

function ReplyContext({ post }: { post: Post }) {
  if (!post.reply_to) return null;
  const to = post.reply_to.author.account_id;
  return (
    <div className="text-[15px] text-muted-foreground">
      Replying to{" "}
      <AccountHoverCard accountId={to}>
        <Link prefetch={false} href={`/${to}`} className="text-link hover:underline" onClick={(e) => e.stopPropagation()}>
          @{to}
        </Link>
      </AccountHoverCard>
    </div>
  );
}

export function PostMenu({ post }: { post: Post }) {
  const { accountId } = useAccount();
  const composer = useComposer();
  const mutes = useMutes();
  const deletePost = useDeletePost();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const own = accountId === post.author.account_id;
  const muted = mutes.includes(post.author.account_id);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More"
            className="-mr-2 -mt-1 grid size-[34px] place-items-center rounded-full text-muted-foreground transition-colors hover:bg-link/10 hover:text-link"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-[18px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => copyPostLink(post.key)}>
            <Link2 />
            Copy link
          </DropdownMenuItem>
          {own ? (
            <>
              <DropdownMenuItem disabled={post._pending} onSelect={() => composer.open({ edit: post })}>
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={post._pending}
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => setMuted(post.author.account_id, !muted)}>
              {muted ? <Volume2 /> : <VolumeX />}
              {muted ? `Unmute @${post.author.account_id}` : `Mute @${post.author.account_id}`}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogTitle>Delete post?</AlertDialogTitle>
          <AlertDialogDescription>
            It will be removed from near.social. Earlier versions may still be visible in public
            blockchain history.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => void deletePost(post)}>Delete</AlertDialogAction>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function usePostNavigation(post: Post) {
  const router = useRouter();
  const qc = useQueryClient();
  const { accountId } = useAccount();
  const href = postHref(post.key);
  const prefetched = React.useRef(false);
  const prefetch = React.useCallback(() => {
    if (prefetched.current || post._pending) return;
    prefetched.current = true;
    router.prefetch(href);
    void qc.prefetchQuery(threadQuery(post.key, accountId));
  }, [router, qc, href, post.key, post._pending, accountId]);
  const onClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (post._pending) return;
      const target = e.target as HTMLElement;
      if (target.closest("a,button,[role=menuitem],[role=dialog],input,textarea,video")) return;
      if (window.getSelection()?.toString()) return;
      if (e.metaKey || e.ctrlKey) {
        window.open(href, "_blank", "noopener");
        return;
      }
      router.push(href);
    },
    [router, href, post._pending],
  );
  return { href, prefetch, onClick };
}

/** A post in a feed (with optional repost header, reply context and thread connector lines). */
export function PostCard({
  item,
  post: postProp,
  showReplyContext = true,
  connectTop = false,
  connectBottom = false,
  className,
}: {
  item?: FeedItem;
  post?: Post;
  showReplyContext?: boolean;
  connectTop?: boolean;
  connectBottom?: boolean;
  className?: string;
}) {
  const post = (item?.post ?? postProp) as Post;
  const { href, prefetch, onClick } = usePostNavigation(post);
  const { text, quote, embed } = usePostLink(post);
  const author = post.author;

  return (
    <article
      className={cn(
        "cv-auto relative cursor-pointer px-4 transition-colors hover:bg-accent/40",
        !connectBottom && "border-b",
        post._pending && "opacity-60",
        className,
      )}
      onClick={onClick}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      aria-busy={post._pending || undefined}
    >
      {item?.type === "repost" && item.reposted_by ? (
        <RepostHeader by={item.reposted_by} />
      ) : (
        item?.reason === "trending" && <TrendingHeader />
      )}
      <div className="flex gap-3 pt-3">
        <div className="relative flex flex-col items-center">
          {connectTop && <span className="absolute -top-3 h-3 w-0.5 bg-border" aria-hidden />}
          <AccountHoverCard accountId={author.account_id}>
            <Link prefetch={false} href={`/${author.account_id}`} onClick={(e) => e.stopPropagation()} className="rounded-full">
              <UserAvatar accountId={author.account_id} src={author.avatar_url} size={40} />
            </Link>
          </AccountHoverCard>
          {connectBottom && <span className="mt-1 w-0.5 flex-1 bg-border" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1 pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-1 text-[15px] leading-5">
              <NameLine accountId={author.account_id} name={author.name} rank={author.rank} className="min-w-0" />
              <span className="shrink-0 text-muted-foreground">·</span>
              <Link prefetch={false}
                href={href}
                className="shrink-0 text-muted-foreground hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <RelativeTime ms={post.created_at} />
              </Link>
              {post.edited_at && (
                <span
                  className="shrink-0 text-[13px] text-muted-foreground"
                  title={`Edited ${fullTime(post.edited_at)}`}
                  suppressHydrationWarning
                >
                  · Edited
                </span>
              )}
              {post._pending && (
                <Loader2 className="ml-1 size-3.5 shrink-0 animate-spin self-center text-muted-foreground" aria-label="Posting" />
              )}
            </div>
            {!post._pending && <PostMenu post={post} />}
          </div>
          {showReplyContext && <ReplyContext post={post} />}
          {text && <CollapsibleText text={text} className="mt-0.5 text-[15px] leading-[1.4]" />}
          {post.media.length > 0 && <PostMediaGrid media={post.media} className="mt-3" />}
          {quote && <QuotedPost quote={quote} className="mt-3" />}
          {embed && <PostLinkEmbed embed={embed} className="mt-3" />}
          <PostActions post={post} className="mt-1.5" />
        </div>
      </div>
    </article>
  );
}

/** The focused post on a thread page: large text, full timestamp, counts row. */
export function FocusedPost({ post, connectTop }: { post: Post; connectTop?: boolean }) {
  const { text, quote, embed } = usePostLink(post);
  const author = post.author;
  const counts: [number, string, string][] = [
    [post.counts.reposts, "Repost", "Reposts"],
    [post.counts.quotes, "Quote", "Quotes"],
    [post.counts.likes, "Like", "Likes"],
  ];
  return (
    <article className="relative border-b px-4 pt-3">
      {connectTop && <span className="absolute left-[35px] top-0 h-3 w-0.5 bg-border" aria-hidden />}
      <div className="flex items-center gap-3">
        <Link prefetch={false} href={`/${author.account_id}`} className="rounded-full">
          <UserAvatar accountId={author.account_id} src={author.avatar_url} size={44} priority />
        </Link>
        <div className="min-w-0 flex-1 text-[15px] leading-5">
          <Link prefetch={false} href={`/${author.account_id}`} className="block truncate font-bold hover:underline">
            {author.name?.trim() || author.account_id}
          </Link>
          <div className="truncate text-muted-foreground">@{author.account_id}</div>
        </div>
        {!post._pending && <PostMenu post={post} />}
      </div>
      {post.reply_to && (
        <div className="mt-3">
          <ReplyContext post={post} />
        </div>
      )}
      {text && (
        <div className="mt-3 text-[17px] leading-[1.45]">
          <RichText text={text} />
        </div>
      )}
      {post.media.length > 0 && <PostMediaGrid media={post.media} className="mt-3" />}
      {quote && <QuotedPost quote={quote} className="mt-3" />}
      {embed && <PostLinkEmbed embed={embed} className="mt-3" />}
      <div className="mt-4 flex flex-wrap items-center gap-x-1 text-[15px] text-muted-foreground">
        <time dateTime={new Date(post.created_at).toISOString()} suppressHydrationWarning>
          {fullTime(post.created_at)}
        </time>
        {post.edited_at && <span suppressHydrationWarning>· Edited {fullTime(post.edited_at)}</span>}
      </div>
      {counts.some(([n]) => n > 0) && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t py-3 text-[15px]">
          {counts
            .filter(([n]) => n > 0)
            .map(([n, one, many]) => (
              <span key={one}>
                <span className="font-bold tabular-nums">{formatCount(n)}</span>{" "}
                <span className="text-muted-foreground">{pluralize(n, one, many)}</span>
              </span>
            ))}
        </div>
      )}
      <div className="border-t py-1">
        <PostActions post={post} size="large" className="justify-around" />
      </div>
    </article>
  );
}
