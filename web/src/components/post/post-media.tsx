"use client";

import * as React from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { PostMedia } from "@/lib/api/types";
import { isGatewayUrl } from "@/components/account/user-avatar";
import { cn } from "@/lib/utils";

function ratio(m: PostMedia, fallback = 16 / 9): number {
  return m.w && m.h ? m.w / m.h : fallback;
}

function MediaImage({
  media,
  sizes,
  className,
  fit = "cover",
}: {
  media: PostMedia;
  sizes: string;
  className?: string;
  fit?: "cover" | "contain";
}) {
  const alt = media.alt ?? "";
  if (!isGatewayUrl(media.url)) {
    return <div className={cn("size-full bg-muted", className)} aria-label={alt || "Image"} role="img" />;
  }
  return (
    <Image
      src={media.url}
      alt={alt}
      fill
      sizes={sizes}
      unoptimized={media.mime === "image/gif"}
      className={cn(fit === "cover" ? "object-cover" : "object-contain", className)}
      draggable={false}
    />
  );
}

function Tile({
  media,
  index,
  onOpen,
  sizes,
  className,
  style,
}: {
  media: PostMedia;
  index: number;
  onOpen: (i: number) => void;
  sizes: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      className={cn(
        "group relative block overflow-hidden bg-muted outline-offset-[-2px]",
        className,
      )}
      style={style}
      aria-label={media.alt ? `Image: ${media.alt}` : `Open image ${index + 1}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(index);
      }}
    >
      <MediaImage media={media} sizes={sizes} className="transition-[filter] group-hover:brightness-95" />
      {media.alt && (
        <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-bold text-white">
          ALT
        </span>
      )}
      {media.mime === "image/gif" && (
        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-bold text-white">
          GIF
        </span>
      )}
    </button>
  );
}

/** 1–4 images as a grid, more as a horizontal carousel. Always reserves space (no layout shift). */
export function PostMediaGrid({ media, className }: { media: PostMedia[]; className?: string }) {
  const [open, setOpen] = React.useState<number | null>(null);
  if (media.length === 0) return null;

  let content: React.ReactNode;
  const half = "(max-width: 640px) 50vw, 280px";
  if (media.length === 1) {
    const m = media[0];
    const r = Math.min(Math.max(ratio(m), 3 / 4), 2);
    content = (
      <Tile
        media={m}
        index={0}
        onOpen={setOpen}
        sizes="(max-width: 640px) 100vw, 560px"
        className="w-full"
        style={{ aspectRatio: r, maxHeight: 560 }}
      />
    );
  } else if (media.length <= 4) {
    content = (
      <div
        className={cn(
          "grid aspect-[16/9] gap-0.5",
          "grid-cols-2",
          media.length > 2 && "grid-rows-2",
        )}
      >
        {media.map((m, i) => (
          <Tile
            key={m.src + i}
            media={m}
            index={i}
            onOpen={setOpen}
            sizes={half}
            className={cn("size-full", media.length === 3 && i === 0 && "row-span-2")}
          />
        ))}
      </div>
    );
  } else {
    content = (
      <div className="scrollbar-none flex snap-x snap-mandatory gap-0.5 overflow-x-auto">
        {media.map((m, i) => (
          <Tile
            key={m.src + i}
            media={m}
            index={i}
            onOpen={setOpen}
            sizes="320px"
            className="h-64 shrink-0 snap-start"
            style={{ aspectRatio: Math.min(Math.max(ratio(m, 1), 0.6), 1.8) }}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className={cn("overflow-hidden rounded-2xl border", className)}>{content}</div>
      <Lightbox media={media} index={open} onIndexChange={setOpen} />
    </>
  );
}

export function Lightbox({
  media,
  index,
  onIndexChange,
}: {
  media: PostMedia[];
  index: number | null;
  onIndexChange: (i: number | null) => void;
}) {
  const current = index !== null ? media[index] : null;
  const count = media.length;
  const go = React.useCallback(
    (delta: number) => {
      if (index === null) return;
      onIndexChange((index + delta + count) % count);
    },
    [index, count, onIndexChange],
  );

  return (
    <DialogPrimitive.Root open={current !== null} onOpenChange={(o) => !o && onIndexChange(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col outline-none"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") go(1);
            if (e.key === "ArrowLeft") go(-1);
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <DialogPrimitive.Title className="sr-only">Image viewer</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {current?.alt || "Image without a description"}
          </DialogPrimitive.Description>
          <div className="flex items-center justify-between p-3 text-white">
            <DialogPrimitive.Close
              className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label="Close"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
            {count > 1 && index !== null && (
              <span className="text-sm font-medium tabular-nums text-white/80">
                {index + 1} / {count}
              </span>
            )}
            <span className="size-10" />
          </div>
          <div className="relative min-h-0 flex-1" onClick={() => onIndexChange(null)}>
            {current && (
              <div className="absolute inset-4 sm:inset-10" onClick={(e) => e.stopPropagation()}>
                <MediaImage media={current} sizes="100vw" fit="contain" />
              </div>
            )}
            {count > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous image"
                  className="absolute left-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(-1);
                  }}
                >
                  <ChevronLeft className="size-6" />
                </button>
                <button
                  type="button"
                  aria-label="Next image"
                  className="absolute right-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(1);
                  }}
                >
                  <ChevronRight className="size-6" />
                </button>
              </>
            )}
          </div>
          {current?.alt && (
            <p className="mx-auto max-w-2xl px-4 pb-6 pt-2 text-center text-sm leading-relaxed text-white/85">
              {current.alt}
            </p>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
