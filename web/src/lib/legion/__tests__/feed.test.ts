import { describe, expect, it } from "vitest";
import { configured, feedHref, hashtagHref, legionTab, writeFeed } from "../feed";
import { channelKeySlot } from "../feed-send";

describe("Legion feed", () => {
  it("is configured only by a valid account", () => {
    expect(configured(undefined)).toBeNull();
    expect(configured("")).toBeNull();
    expect(configured("not an account")).toBeNull();
    expect(configured(" Feed.NearLegion.near ")).toBe("feed.nearlegion.near");
  });

  it("adds a Legion home tab only when configured", () => {
    expect(legionTab("legion", "feed.near")).toEqual({
      tab: "legion",
      spec: { kind: "channel", channel: "feed.near" },
    });
    expect(legionTab("legion", null)).toBeNull();
    expect(legionTab("latest", "feed.near")).toBeNull();
  });
});

describe("writeFeed", () => {
  it("writes to the configured Legion feed only, else to social", () => {
    expect(writeFeed("legion", "legion")).toBe("legion");
    expect(writeFeed("other.near", "legion")).toBeNull();
    expect(writeFeed(null, "legion")).toBeNull();
    expect(writeFeed(undefined, "legion")).toBeNull();
    expect(writeFeed("legion", null)).toBeNull();
  });
});

describe("feed links", () => {
  it("scopes hashtag pages to a feed", () => {
    expect(hashtagHref("near")).toBe("/hashtag/near");
    expect(hashtagHref("near", null)).toBe("/hashtag/near");
    expect(hashtagHref("near", "feed.near")).toBe("/hashtag/near?channel=feed.near");
    expect(feedHref("feed.near")).toBe("/feed.near/feed");
  });

  it("keeps channel keys apart from the social posting key", () => {
    const slot = channelKeySlot("a.near", "feed.near");
    expect(slot).toBe("nsk:ch:v1:a.near:feed.near");
    // The social key list scans `nsk:v1:`; a channel key must never look like one.
    expect(slot.startsWith("nsk:v1:")).toBe(false);
  });
});
