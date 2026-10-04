import { Shield, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { markedBesideName, RANK_LABEL, type Rank } from "@/lib/legion/rank";
import { cn } from "@/lib/utils";

const ICON = { initiate: Shield, ascendant: Shield, vanguard: ShieldCheck } as const;

/** An account's Legion rank: a labelled badge on profiles and hover cards. */
export function RankBadge({ rank, className }: { rank: Rank | null | undefined; className?: string }) {
  if (!rank) return null;
  const Icon = ICON[rank];
  return (
    <Badge variant={rank === "initiate" ? "outline" : "primary"} className={className}>
      <Icon className="size-3" aria-hidden />
      {RANK_LABEL[rank]}
    </Badge>
  );
}

/** The mark beside a name in feeds and lists: Ascendant and Vanguard only (`markedBesideName`). */
export function RankMark({ rank, className }: { rank: Rank | null | undefined; className?: string }) {
  if (!markedBesideName(rank)) return null;
  const Icon = ICON[rank];
  return (
    <span title={RANK_LABEL[rank]} className={cn("inline-flex shrink-0 self-center text-link", className)}>
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{RANK_LABEL[rank]}</span>
    </span>
  );
}
