import { describe, expect, it } from "vitest";
import { isAccountId } from "@/lib/social/standard";
import { configured, feedHref, hashtagHref, legionTab, writeFeed } from "../feed";
import { feedKeyId } from "../feed-send";

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

  it("keeps feed keys out of the keystore's account list", () => {
    const id = feedKeyId("a.near", "legion");
    expect(id).toBe("a.near:legion");
    // listKeyAccounts keeps ids that are account ids; `:` never appears in one.
    expect(isAccountId(id)).toBe(false);
  });
});
