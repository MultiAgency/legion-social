/** NEAR Legion ranks, as the API returns them on accounts (docs/LEGION.md §1). */
export type Rank = "initiate" | "ascendant" | "vanguard";

export const RANK_LABEL: Record<Rank, string> = {
  initiate: "Initiate",
  ascendant: "Ascendant",
  vanguard: "Vanguard",
};

/**
 * Whether a rank is marked beside a name in feeds and lists. Every account shown is a member,
 * so marking Initiates would mark nearly everyone; profiles and hover cards show every rank.
 */
export function markedBesideName(rank: Rank | null | undefined): rank is Rank {
  return rank === "ascendant" || rank === "vanguard";
}
