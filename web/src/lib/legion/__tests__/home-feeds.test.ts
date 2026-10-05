import { describe, expect, it } from "vitest";
import {
  destinationFor,
  HOME_FEEDS,
  hashtagFeed,
  hashtagFeedFor,
  homeFeedId,
  pickedFeedRequest,
  pickedFeedsFor,
  pickedHomeFeed,
} from "../home-feeds";

describe("home feeds", () => {
  it("are pinned in order after upstream's tabs", () => {
    expect(HOME_FEEDS.map((f) => f.label)).toEqual(["Multi", "Legion", ".agency", "Builders"]);
  });

  it("are picked by ?feed= only with a Multi feed configured", () => {
    for (const id of ["multi", "legion", "agency", "builders"]) expect(homeFeedId(id, "multi")).toBe(id);
    expect(homeFeedId("latest", "multi")).toBe("everyone");
    expect(homeFeedId(null, "multi")).toBe("everyone");
    expect(homeFeedId("space", "multi")).toBe("everyone");
    expect(homeFeedId("multi", null)).toBe("everyone");
    expect(pickedHomeFeed("multi", "multi")).toEqual({ tab: "multi", spec: { kind: "picked", feed: "multi" } });
    expect(pickedHomeFeed("builders", null)).toBeNull();
  });

  it("read their endpoints, within a hashtag when given", () => {
    expect(pickedFeedRequest("multi", null, "multi")).toEqual({ path: "/v1/feed/channel/multi", query: {} });
    expect(pickedFeedRequest("multi", "city", "multi")).toEqual({ path: "/v1/hashtags/city", query: { channel: "multi" } });
    expect(pickedFeedRequest("legion", null, "multi")).toEqual({ path: "/v1/feed/legion", query: {} });
    expect(pickedFeedRequest("legion", "city", "multi")).toEqual({ path: "/v1/feed/legion", query: { tag: "city" } });
    expect(pickedFeedRequest("agency", "city", "multi")).toEqual({ path: "/v1/feed/names/agency", query: { tag: "city" } });
    expect(pickedFeedRequest("builders", null, "multi")).toEqual({ path: "/v1/feed/builders", query: {} });
  });

  it("have one destination each: Multi to its feed account, Legion to social, none for the rest", () => {
    expect(destinationFor("multi", "multi")).toEqual({ channel: "multi", label: "Post to Multi" });
    expect(destinationFor("legion", "multi")).toEqual({ channel: null, label: "Post to Legion" });
    expect(destinationFor("agency", "multi")).toBeNull();
    expect(destinationFor("builders", "multi")).toBeNull();
    expect(destinationFor("multi", null)).toBeNull();
  });

  it("put a new post on the right tab right away, by the server's rules", () => {
    const post = { channel: null as string | null, reply: false, member: true };
    expect(pickedFeedsFor(post, "multi")).toEqual([{ kind: "picked", feed: "legion" }]);
    expect(pickedFeedsFor({ ...post, member: false }, "multi")).toEqual([]);
    expect(pickedFeedsFor({ ...post, reply: true }, "multi")).toEqual([]);
    // Multi is open to everyone, and its feed lists replies too.
    expect(pickedFeedsFor({ channel: "multi", reply: true, member: false }, "multi")).toEqual([{ kind: "picked", feed: "multi" }]);
    expect(pickedFeedsFor({ ...post, channel: "other.near" }, "multi")).toEqual([]);
    expect(pickedFeedsFor(post, null)).toEqual([]);
  });
});

describe("hashtags per feed", () => {
  it("the hashtag page picks its feed by ?feed=, upstream's without it", () => {
    expect(hashtagFeed("city", undefined, "multi")).toEqual({ id: "everyone", spec: { kind: "hashtag", tag: "city" } });
    expect(hashtagFeed("city", "multi", "multi")).toEqual({ id: "multi", spec: { kind: "picked", feed: "multi", tag: "city" } });
    expect(hashtagFeed("city", "legion", "multi").spec).toEqual({ kind: "picked", feed: "legion", tag: "city" });
    expect(hashtagFeed("city", ["multi"], "multi").id).toBe("everyone");
    expect(hashtagFeed("city", "multi", null)).toEqual({ id: "everyone", spec: { kind: "hashtag", tag: "city" } });
  });

  it("links inside posts stay in the feed they're shown in, and Multi posts always link there", () => {
    expect(hashtagFeedFor(null, null, "multi")).toBeNull();
    expect(hashtagFeedFor(null, "builders", "multi")).toBe("builders");
    expect(hashtagFeedFor("multi", null, "multi")).toBe("multi");
    expect(hashtagFeedFor("multi", "legion", "multi")).toBe("multi");
    expect(hashtagFeedFor("multi", "builders", null)).toBeNull();
  });
});
