import { describe, expect, it } from "vitest";
import { isAccountId } from "@/lib/social/standard";
import { configured, feedHref, hashtagChannel, hashtagHref, ownFeed, writeFeed } from "../feed";
import { feedKeyId } from "../feed-keys";

describe("Legion feed", () => {
  it("is configured only by a valid account", () => {
    expect(configured(undefined)).toBeNull();
    expect(configured("")).toBeNull();
    expect(configured("not an account")).toBeNull();
    expect(configured(" Feed.NearLegion.near ")).toBe("feed.nearlegion.near");
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

describe("ownFeed", () => {
  it("edits and deletes social and the configured feed, and refuses any other feed", () => {
    expect(ownFeed(null, "legion")).toBeNull();
    expect(ownFeed("legion", "legion")).toBe("legion");
    expect(() => ownFeed("other.near", "legion")).toThrow(/@other.near/);
    expect(() => ownFeed("legion", null)).toThrow();
  });
});

describe("feed links", () => {
  it("scopes hashtag pages to a feed", () => {
    expect(hashtagHref("near")).toBe("/hashtag/near");
    expect(hashtagHref("near", null)).toBe("/hashtag/near");
    expect(hashtagHref("near", "feed.near", "legion")).toBe("/hashtag/near?channel=feed.near");
    // No feeds configured: plain hashtag pages.
    expect(hashtagHref("near", "feed.near", null)).toBe("/hashtag/near");
    expect(hashtagChannel("legion", "legion")).toBe("legion");
    expect(hashtagChannel("legion", null)).toBeNull();
    expect(hashtagChannel(["legion"], "legion")).toBeNull();
    expect(hashtagChannel("not an account", "legion")).toBeNull();
    expect(feedHref("feed.near")).toBe("/feed.near/feed");
  });

  it("keeps feed keys out of the keystore's account list", () => {
    const id = feedKeyId("a.near", "legion");
    expect(id).toBe("a.near:legion");
    // listKeyAccounts keeps ids that are account ids; `:` never appears in one.
    expect(isAccountId(id)).toBe(false);
  });
});
