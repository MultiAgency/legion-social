"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { MessageCircleOff } from "lucide-react";
import { useAccount } from "@/components/providers/account-provider";
import { threadQuery } from "@/lib/api/queries";
import { isNotFound } from "@/lib/api/client";
import { PageHeader } from "@/components/shell/page-header";
import { FocusedPost, PostCard } from "@/components/post/post-card";
import { Composer } from "@/components/composer/composer";
import { Feed } from "@/components/feed/feed";
import { EmptyState, ErrorState } from "@/components/common/states";
import { FeedSkeleton } from "@/components/post/post-skeleton";
import { Button } from "@/components/ui/button";

export function ThreadView({ postKey }: { postKey: string }) {
  const { accountId, requireSignIn } = useAccount();
  const { data, isPending, isError, error, refetch } = useQuery(threadQuery(postKey, accountId));
  const focusRef = React.useRef<HTMLDivElement>(null);
  const hasAncestors = (data?.ancestors.length ?? 0) > 0;

  // Keep the focused post at the top when there are ancestors above it.
  React.useLayoutEffect(() => {
    if (hasAncestors && focusRef.current) {
      const top = focusRef.current.getBoundingClientRect().top + window.scrollY - 54;
      window.scrollTo({ top });
    }
  }, [hasAncestors, postKey]);

  return (
    <>
      <PageHeader back title="Post" />
      {isPending ? (
        <FeedSkeleton count={3} />
      ) : isError ? (
        isNotFound(error) ? (
          <EmptyState title="This post doesn't exist" icon={<MessageCircleOff className="size-8" />}>
            It may have been deleted.
          </EmptyState>
        ) : (
          <ErrorState onRetry={() => void refetch()} />
        )
      ) : data ? (
        <>
          {data.parent_missing && (
            <div className="border-b px-4 py-3 text-[15px] text-muted-foreground">
              This post is a reply to a post that isn&apos;t available.
            </div>
          )}
          {data.ancestors.map((p, i) => (
            <PostCard
              key={p.key}
              post={p}
              showReplyContext={false}
              connectTop={i > 0}
              connectBottom
            />
          ))}
          <div ref={focusRef} className="scroll-mt-14">
            <FocusedPost post={data.post} connectTop={hasAncestors} />
          </div>
          {accountId ? (
            <div className="border-b px-4 py-3">
              <Composer variant="reply" replyTo={data.post} placeholder="Post your reply" />
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <p className="text-[15px] text-muted-foreground">Sign in to join the conversation.</p>
              <Button size="sm" onClick={() => requireSignIn()}>
                Sign in
              </Button>
            </div>
          )}
          <Feed
            spec={{ kind: "replies", postKey }}
            showReplyContext={false}
            empty={{ title: "No replies yet", body: accountId ? "Be the first to reply." : undefined }}
          />
          <div className="min-h-[60vh]" aria-hidden />
        </>
      ) : null}
      {!isPending && !data && !isError && (
        <p className="p-6 text-center">
          <Link href="/">Back home</Link>
        </p>
      )}
    </>
  );
}
