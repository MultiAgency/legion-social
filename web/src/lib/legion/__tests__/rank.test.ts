import { describe, expect, it } from "vitest";
import { markedBesideName, RANK_LABEL } from "../rank";

describe("rank marks", () => {
  it("marks earned ranks beside names, not the Initiate everyone shown holds", () => {
    expect(markedBesideName("vanguard")).toBe(true);
    expect(markedBesideName("ascendant")).toBe(true);
    expect(markedBesideName("initiate")).toBe(false);
    expect(markedBesideName(undefined)).toBe(false);
    expect(markedBesideName(null)).toBe(false);
  });

  it("labels every rank", () => {
    expect(Object.values(RANK_LABEL)).toEqual(["Initiate", "Ascendant", "Vanguard"]);
  });
});
