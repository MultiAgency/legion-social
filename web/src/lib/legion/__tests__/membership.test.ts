import { describe, expect, it } from "vitest";
import { showsNonMemberNotice } from "../membership";

const at = { account_id: "a.near", checked_at: 1 };

describe("non-member notice", () => {
  it("shows for a checked non-member", () => {
    expect(showsNonMemberNotice({ ...at, rank: null })).toBe(true);
  });

  it("stays hidden for members, while loading, and with Legion off", () => {
    expect(showsNonMemberNotice({ ...at, rank: "initiate" })).toBe(false);
    expect(showsNonMemberNotice(undefined)).toBe(false);
    expect(showsNonMemberNotice(null)).toBe(false);
  });
});
