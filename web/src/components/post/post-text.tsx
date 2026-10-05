"use client";

import * as React from "react";
import Link from "next/link";
import { displayUrl, tokenize } from "@/lib/social/text";
import { cn } from "@/lib/utils";
import { hashtagHref } from "@/lib/legion/feed";
import { useHashtagFeed } from "@/components/legion/hashtag-tab";
import { AccountHoverCard } from "@/components/account/account-hover-card";

const stop = (e: React.MouseEvent) => e.stopPropagation();

/**
 * Renders plain text (STANDARD.md §5) as React text nodes: URLs, @mentions and #hashtags become
 * links; everything else stays text. Never uses dangerouslySetInnerHTML.
 */
export function RichText({
  text,
  className,
  channel,
}: {
  text: string;
  className?: string;
  /** The post's feed account: its hashtags link within its feed (docs/LEGION.md §4.4). */
  channel?: string | null;
}) {
  const tokens = React.useMemo(() => tokenize(text), [text]);
  const feed = useHashtagFeed(channel);
  return (
    <span className={cn("whitespace-pre-wrap break-words [overflow-wrap:anywhere]", className)}>
      {tokens.map((t, i) => {
        switch (t.type) {
          case "text":
            return <React.Fragment key={i}>{t.text}</React.Fragment>;
          case "url":
            return (
              <a
                key={i}
                href={t.href}
                target="_blank"
                rel="nofollow ugc noopener noreferrer"
                className="text-link hover:underline"
                onClick={stop}
                title={t.href}
              >
                {displayUrl(t.href)}
              </a>
            );
          case "mention":
            return (
              <AccountHoverCard key={i} accountId={t.accountId}>
                <Link prefetch={false} href={`/${t.accountId}`} className="text-link hover:underline" onClick={stop}>
                  {t.text}
                </Link>
              </AccountHoverCard>
            );
          case "hashtag":
            return (
              <Link prefetch={false}
                key={i}
                href={hashtagHref(t.tag, feed)}
                className="text-link hover:underline"
                onClick={stop}
              >
                {t.text}
              </Link>
            );
        }
      })}
    </span>
  );
}

/** Rich text that collapses after ~8 lines behind "Show more". */
export function CollapsibleText({
  text,
  className,
  lines = 8,
  channel,
}: {
  text: string;
  className?: string;
  lines?: number;
  channel?: string | null;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [overflowing, setOverflowing] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, expanded]);

  return (
    <div className={className}>
      <div
        ref={ref}
        className={cn(!expanded && "overflow-hidden")}
        style={!expanded ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines } : undefined}
      >
        <RichText text={text} channel={channel} />
      </div>
      {overflowing && !expanded && (
        <button
          type="button"
          className="mt-0.5 font-medium text-link hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
        >
          Show more
        </button>
      )}
    </div>
  );
}
