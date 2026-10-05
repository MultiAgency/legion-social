"use client";

import Link from "next/link";
import { Blocks, Globe, IdCard, type LucideIcon } from "lucide-react";
import { HOME_FEEDS, type HomeFeedId } from "@/lib/legion/home-feeds";
import { cn } from "@/lib/utils";
import { LegionMark } from "./legion-mark";

const ICONS: Record<Exclude<HomeFeedId, "legion">, LucideIcon> = { everyone: Globe, agency: IdCard, builders: Blocks };

export function FeedIcon({ id, className }: { id: HomeFeedId; className?: string }) {
  if (id === "legion") return <LegionMark className={cn("size-[18px] rounded-[5px]", className)} />;
  const Icon = ICONS[id];
  return <Icon className={cn("size-[18px]", className)} aria-hidden />;
}

/** The home feeds, as a row of pills (docs/LEGION.md §4). Everyone links to `/`, the others to `?feed=`. */
export function FeedSwitcher({ current }: { current: HomeFeedId }) {
  return (
    <nav aria-label="Feeds" className="scrollbar-none flex gap-2 overflow-x-auto px-4 pb-2.5 pt-1.5">
      {HOME_FEEDS.map((f) => {
        const active = f.id === current;
        return (
          <Link
            key={f.id}
            href={f.id === "everyone" ? "/" : `/?feed=${f.id}`}
            replace
            scroll={false}
            title={f.purpose}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-9 flex-none items-center gap-[7px] rounded-full border pl-2.5 pr-3.5 text-[15px] font-medium transition-colors",
              active
                ? "border-primary bg-primary font-semibold text-primary-foreground"
                : "bg-background hover:border-foreground/25",
            )}
          >
            <FeedIcon id={f.id} />
            {f.label}
          </Link>
        );
      })}
    </nav>
  );
}
