"use client";

import { useQuery } from "@tanstack/react-query";
import type { Post } from "@/lib/api/types";
import { membersOnly } from "@/lib/legion/feed";
import { membershipQuery } from "@/lib/legion/membership";
import { cn } from "@/lib/utils";
import { LegionMark } from "./legion-mark";

const MINT_URL = "https://nearlegion.com/mint";

/**
 * Whether `viewer` may reply to `parent`: a members-only post (sent to the Legion feed account)
 * takes replies from members only, since the server hides a non-member's (docs/LEGION.md §3).
 * "checking" while the viewer's membership loads.
 */
export function useReplyAllowed(parent: Post | null, viewer: string | null): "yes" | "no" | "checking" {
  const gated = membersOnly(parent?.channel);
  const { data, isPending } = useQuery({ ...membershipQuery(viewer ?? ""), enabled: gated && !!viewer });
  if (!gated) return "yes";
  if (isPending) return "checking";
  return data?.rank != null ? "yes" : "no";
}

/** In place of the reply box, for a non-member on a members-only post. */
export function MembersOnlyReply({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground", className)}>
      <LegionMark className="size-4 flex-none rounded-[4px]" />
      <span>
        Only Legion members can reply to members-only posts. Mint an Initiate token at{" "}
        <a href={MINT_URL} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
          nearlegion.com/mint
        </a>
        .
      </span>
    </p>
  );
}
