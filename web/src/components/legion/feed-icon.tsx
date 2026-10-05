"use client";

import { Blocks, Globe, IdCard, type LucideIcon } from "lucide-react";
import type { HomeFeedId } from "@/lib/legion/home-feeds";
import { cn } from "@/lib/utils";
import { LegionMark } from "./legion-mark";

const ICONS: Record<Exclude<HomeFeedId, "legion">, LucideIcon> = { everyone: Globe, agency: IdCard, builders: Blocks };

/** A home feed's icon: the Legion knot, or a lucide icon for the others. */
export function FeedIcon({ id, className }: { id: HomeFeedId; className?: string }) {
  if (id === "legion") return <LegionMark className={cn("size-[18px] rounded-[5px]", className)} />;
  const Icon = ICONS[id];
  return <Icon className={cn("size-[18px]", className)} aria-hidden />;
}
