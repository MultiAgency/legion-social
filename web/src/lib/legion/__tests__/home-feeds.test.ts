import { describe, expect, it } from "vitest";
import { destinationFor, hasTag, homeFeedId, pickedFeedPath, pickedFeedsFor, pickedHomeFeed, withTag } from "../home-feeds";

describe("home feeds", () => {
  it("are picked by ?feed= only with a Legion feed configured", () => {
    expect(homeFeedId("legion", "legion")).toBe("legion");
    expect(homeFeedId("agency", "legion")).toBe("agency");
    expect(homeFeedId("builders", "legion")).toBe("builders");
    expect(homeFeedId("latest", "legion")).toBe("everyone");
    expect(homeFeedId(null, "legion")).toBe("everyone");
    expect(homeFeedId("legion", null)).toBe("everyone");
    expect(pickedHomeFeed("builders", "legion")).toEqual({ tab: "builders", spec: { kind: "picked", feed: "builders" } });
    expect(pickedHomeFeed("builders", null)).toBeNull();
  });

  it("map to their API paths", () => {
    expect(pickedFeedPath("legion")).toBe("/v1/feed/legion");
    expect(pickedFeedPath("agency")).toBe("/v1/feed/names/agency");
    expect(pickedFeedPath("builders")).toBe("/v1/feed/builders");
  });

  it("name where the post button sends a post", () => {
    const legion = destinationFor("legion", "legion")!;
    expect(legion.channel).toBe("legion");
    expect(legion.audience).toBe(true);
    expect([legion.label("legion"), legion.label(null)]).toEqual(["Post to Legion", "Post to Legion and near.social"]);
    expect(destinationFor("everyone", "legion")!.label(null)).toBe("Post to Everyone");
    expect(destinationFor("builders", "legion")!.channel).toBeNull();
    expect(destinationFor("agency", "legion")).toBeNull();
  });
});

describe("#legion on public posts", () => {
  it("is appended once, whatever its case", () => {
    expect(withTag("city node call", "legion")).toBe("city node call #legion");
    expect(withTag("call #Legion tonight", "legion")).toBe("call #Legion tonight");
    expect(withTag("see #legionnaires", "legion")).toBe("see #legionnaires #legion");
    expect(hasTag("mail@x#legion", "legion")).toBe(false);
  });

  it("puts a new post on the Legion feed right away only by the server's rule", () => {
    const legion = [{ kind: "picked", feed: "legion" }];
    const post = { channel: null as string | null, text: "hi", reply: false, member: true };
    expect(pickedFeedsFor({ ...post, channel: "legion" }, "legion")).toEqual(legion);
    expect(pickedFeedsFor({ ...post, text: "hi #legion" }, "legion")).toEqual(legion);
    expect(pickedFeedsFor(post, "legion")).toEqual([]);
    // Replies and non-members' posts aren't in the Legion feed.
    expect(pickedFeedsFor({ ...post, channel: "legion", reply: true }, "legion")).toEqual([]);
    expect(pickedFeedsFor({ ...post, text: "hi #legion", member: false }, "legion")).toEqual([]);
    expect(pickedFeedsFor({ ...post, channel: "legion" }, null)).toEqual([]);
  });
});
