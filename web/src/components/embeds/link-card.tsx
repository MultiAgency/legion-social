"use client";

import * as React from "react";
import type { CardPreview } from "@/lib/api/types";
import { linkHost, proxiedImage } from "@/lib/social/links";
import { cn } from "@/lib/utils";

const stop = (e: React.MouseEvent) => e.stopPropagation();

/**
 * An Open Graph card: a large image above the domain and title, or a small square image beside
 * domain, title and description. Images load through i.near.social; if one fails, the card
 * falls back to text only.
 */
export function LinkCard({
  url,
  preview,
  className,
}: {
  url: string;
  preview: CardPreview;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const image = preview.image && !failed ? proxiedImage(preview.image) : null;
  const host = linkHost(url);
  const layout = !image ? "text" : preview.large ? "large" : "small";

  const img = image && (
    // Arbitrary remote hosts (via the proxy) can't go through next/image.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className="absolute inset-0 size-full object-cover"
      // A load that failed before hydration never fires onError: catch it on mount.
      ref={(el) => {
        if (el?.complete && el.naturalWidth === 0) setFailed(true);
      }}
      onError={() => setFailed(true)}
    />
  );

  return (
    <a
      href={url}
      target="_blank"
      rel="nofollow ugc noopener noreferrer"
      onClick={stop}
      className={cn(
        "block overflow-hidden rounded-2xl border transition-colors hover:bg-accent/40",
        layout === "small" && "flex",
        className,
      )}
    >
      {layout === "large" && <div className="relative aspect-[1.91/1] border-b bg-muted">{img}</div>}
      {layout === "small" && <div className="relative size-[130px] shrink-0 border-r bg-muted">{img}</div>}
      <div
        className={cn(
          "min-w-0 px-3 py-2.5 text-[15px] leading-5",
          layout === "small" && "flex flex-1 flex-col justify-center",
        )}
      >
        {host && <div className="truncate text-[13px] text-muted-foreground">{host}</div>}
        <div className="truncate">{preview.title}</div>
        {layout !== "large" && preview.description && (
          <div className="mt-0.5 line-clamp-2 text-muted-foreground">{preview.description}</div>
        )}
      </div>
    </a>
  );
}
