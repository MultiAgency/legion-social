"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ArrowUp, Images, Layers } from "lucide-react";
import { useAccount } from "@/components/providers/account-provider";
import { feedQuery, fetchFeedPage, type FeedSpec } from "@/lib/api/queries";
import type { FeedItem, Page } from "@/lib/api/types";
import { useMutes } from "@/lib/local-store";
import { subscribeStream } from "@/lib/stream";
import { isGatewayUrl } from "@/components/account/user-avatar";
import { EmptyState, ErrorState } from "@/components/common/states";
import { InfiniteSentinel } from "@/components/common/infinite-sentinel";
import { FeedSkeleton } from "@/components/post/post-skeleton";
import { PostCard } from "@/components/post/post-card";
import { postHref } from "@/components/post/quoted-post";
import { cn } from "@/lib/utils";

function itemId(i: FeedItem): string {
  return i.type === "repost" ? `r:${i.reposted_by?.account_id}:${i.post.key}` : `p:${i.post.key}`;
}

export function useFeedItems(spec: FeedSpec) {
  const { accountId } = useAccount();
  const query = useInfiniteQuery(feedQuery(spec, accountId));
  const mutes = useMutes();
  const items = React.useMemo(() => {
    const seen = new Set<string>();
    const out: FeedItem[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const item of page.items) {
        const id = itemId(item);
        if (seen.has(id)) continue;
        seen.add(id);
        if (mutes.includes(item.post.author.account_id)) continue;
        if (item.reposted_by && mutes.includes(item.reposted_by.account_id)) continue;
        out.push(item);
      }
    }
    return out;
  }, [query.data, mutes]);
  return { query, items, viewer: accountId };
}

export function Feed({
  spec,
  empty,
  showReplyContext = true,
  layout = "list",
  newPostsPill = false,
}: {
  spec: FeedSpec;
  empty?: { title: string; body?: React.ReactNode };
  showReplyContext?: boolean;
  layout?: "list" | "media-grid";
  newPostsPill?: boolean;
}) {
  const { query, items, viewer } = useFeedItems(spec);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  if (query.isPending) return <FeedSkeleton />;
  if (query.isError && items.length === 0) {
    return <ErrorState onRetry={() => void query.refetch()} />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title={empty?.title ?? "Nothing here yet"}
        icon={<Layers className="size-8" />}
      >
        {empty?.body}
      </EmptyState>
    );
  }

  return (
    <div>
      {newPostsPill && <NewPostsPill spec={spec} viewer={viewer} />}
      {layout === "media-grid" ? (
        <MediaGrid items={items} />
      ) : (
        items.map((item) => (
          <PostCard key={itemId(item)} item={item} showReplyContext={showReplyContext} />
        ))
      )}
      <InfiniteSentinel
        hasMore={!!hasNextPage}
        loading={isFetchingNextPage}
        onVisible={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
      />
      {query.isError && items.length > 0 && (
        <ErrorState title="Couldn't load more" message="" onRetry={() => void fetchNextPage()} />
      )}
    </div>
  );
}

function MediaGrid({ items }: { items: FeedItem[] }) {
  const tiles = items.flatMap((i) =>
    i.post.media.slice(0, 1).map((m) => ({ key: i.post.key, media: m, count: i.post.media.length })),
  );
  return (
    <div className="grid grid-cols-3 gap-0.5 p-0.5">
      {tiles.map(({ key, media, count }) => (
        <Link prefetch={false}
          key={key}
          href={postHref(key)}
          className="group relative aspect-square overflow-hidden bg-muted"
          aria-label={media.alt || "Open post"}
        >
          {isGatewayUrl(media.url) && (
            <Image
              src={media.url}
              alt={media.alt ?? ""}
              fill
              sizes="(max-width: 640px) 33vw, 200px"
              unoptimized={media.mime === "image/gif"}
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          )}
          {count > 1 && (
            <Images className="absolute right-2 top-2 size-5 text-white drop-shadow" aria-label={`${count} images`} />
          )}
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* "N new posts" pill (SSE /v1/stream, polling fallback)                                      */
/* ------------------------------------------------------------------------------------------ */

function NewPostsPill({ spec, viewer }: { spec: FeedSpec; viewer: string | null }) {
  const qc = useQueryClient();
  const [count, setCount] = React.useState(0);
  const fresh = React.useRef<Page<FeedItem> | null>(null);
  const specKey = JSON.stringify(spec);
  const options = React.useMemo(() => feedQuery(JSON.parse(specKey) as FeedSpec, viewer), [specKey, viewer]);

  React.useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const check = async () => {
      last = Date.now();
      try {
        const page = await fetchFeedPage(JSON.parse(specKey) as FeedSpec, { viewer });
        if (cancelled) return;
        const current = qc.getQueryData<InfiniteData<Page<FeedItem>>>(options.queryKey);
        const top = current?.pages[0]?.items.find((i) => !i.post._pending);
        const topId = top ? itemId(top) : null;
        let n = 0;
        for (const item of page.items) {
          if (topId && itemId(item) === topId) break;
          if (item.type === "post" && item.post.author.account_id === viewer) continue;
          n++;
        }
        fresh.current = page;
        setCount(n);
      } catch {
        /* ignore; next event retries */
      }
    };

    const unsubscribe = subscribeStream((event) => {
      if (event && event.posts.length === 0 && event.tx_hashes.length === 0) return;
      if (document.visibilityState !== "visible") return;
      const wait = Math.max(0, 4000 - (Date.now() - last));
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void check();
      }, wait);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [qc, options, specKey, viewer]);

  if (count <= 0) return null;

  const show = () => {
    const page = fresh.current;
    if (page) {
      qc.setQueryData<InfiniteData<Page<FeedItem>>>(options.queryKey, (old) => {
        const pending = old?.pages[0]?.items.filter((i) => i.post._pending) ?? [];
        const keys = new Set(page.items.map(itemId));
        return {
          pages: [{ ...page, items: [...pending.filter((i) => !keys.has(itemId(i))), ...page.items] }],
          pageParams: [null],
        };
      });
    } else {
      void qc.resetQueries({ queryKey: options.queryKey });
    }
    setCount(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="pointer-events-none sticky top-[62px] z-20 flex h-0 justify-center">
      <button
        type="button"
        onClick={show}
        className={cn(
          "pointer-events-auto mt-2 flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20",
          "animate-in fade-in-0 slide-in-from-top-2 transition-transform hover:scale-[1.03] active:scale-95",
        )}
      >
        <ArrowUp className="size-4" />
        {count >= 20 ? "20+" : count} new {count === 1 ? "post" : "posts"}
      </button>
    </div>
  );
}
