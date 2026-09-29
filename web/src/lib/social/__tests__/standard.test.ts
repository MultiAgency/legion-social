import { describe, expect, it } from "vitest";
import {
  charCount,
  fastfsToHttps,
  isAccountId,
  isPostId,
  keys,
  nextPostId,
  parseFastfsUri,
  parsePostRef,
  validateEntry,
  validatePost,
  validateProfileLink,
} from "../standard";

const SRC = "fastfs://alice.near/social/media/2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae.webp";

describe("account IDs", () => {
  it.each(["alice.near", "social", "a1", "bob-1.tg", "x_y.near", "a".repeat(64), "0".repeat(64)])(
    "accepts %s",
    (id) => expect(isAccountId(id)).toBe(true),
  );
  it.each(["a", "Alice.near", "alice..near", "-alice", "alice-", ".alice", "a".repeat(65), "al ice", ""])(
    "rejects %s",
    (id) => expect(isAccountId(id)).toBe(false),
  );
});

describe("post IDs", () => {
  it("accepts 1 ..= 2^53-1 without leading zeros", () => {
    expect(isPostId("1")).toBe(true);
    expect(isPostId("1759140000000")).toBe(true);
    expect(isPostId("9007199254740991")).toBe(true);
    expect(isPostId("9007199254740992")).toBe(false);
    expect(isPostId("0")).toBe(false);
    expect(isPostId("01")).toBe(false);
    expect(isPostId("1.5")).toBe(false);
    expect(isPostId("99999999999999999")).toBe(false);
  });

  it("parses post references", () => {
    expect(parsePostRef("alice.near/1759140000000")).toEqual({
      accountId: "alice.near",
      postId: "1759140000000",
    });
    expect(parsePostRef("alice.near/0")).toBeNull();
    expect(parsePostRef("Alice/1")).toBeNull();
    expect(parsePostRef("alice.near")).toBeNull();
  });

  it("generates increasing IDs even within the same millisecond", () => {
    const a = nextPostId("gen.near", 1_759_140_000_000);
    const b = nextPostId("gen.near", 1_759_140_000_000);
    const c = nextPostId("gen.near", 1_759_139_999_000);
    expect(a).toBe("1759140000000");
    expect(b).toBe("1759140000001");
    expect(c).toBe("1759140000002");
    expect(isPostId(c)).toBe(true);
  });
});

describe("FastFS URIs", () => {
  it("parses and resolves to the gateway", () => {
    expect(parseFastfsUri(SRC)?.path).toMatch(/^media\//);
    expect(fastfsToHttps(SRC, "https://main.fastfs.io")).toBe(
      SRC.replace("fastfs://", "https://main.fastfs.io/"),
    );
  });
  it.each([
    "https://main.fastfs.io/alice.near/social/media/a.webp",
    "fastfs://alice.near/social/../a.webp",
    "fastfs://alice.near/social//a.webp",
    "fastfs://alice.near/social/",
    "fastfs://Alice/social/a.webp",
    "fastfs://alice.near/social/a b.webp",
  ])("rejects %s", (uri) => expect(parseFastfsUri(uri)).toBeNull());
});

describe("validatePost (§3.2)", () => {
  it("accepts text, media-only and quote-only posts", () => {
    expect(validatePost({ text: "hi" })).toBeNull();
    expect(validatePost({ media: [{ src: SRC, mime: "image/webp", w: 1, h: 1 }] })).toBeNull();
    expect(validatePost({ quote: "carol.near/1" })).toBeNull();
  });

  it("rejects empty posts", () => {
    expect(validatePost({})).not.toBeNull();
    expect(validatePost({ text: "   \n" })).not.toBeNull();
    expect(validatePost({ text: "x", media: [] })).toBeNull();
    expect(validatePost({ media: [] })).not.toBeNull();
  });

  it("counts characters as Unicode scalar values", () => {
    const emoji = "😀".repeat(25_000);
    expect(charCount(emoji)).toBe(25_000);
    expect(validatePost({ text: emoji })).toBeNull();
    expect(validatePost({ text: `${emoji}x` })).not.toBeNull();
  });

  it("validates media", () => {
    const m = { src: SRC, mime: "image/webp" };
    expect(validatePost({ media: new Array(11).fill(m) })).not.toBeNull();
    expect(validatePost({ media: [{ ...m, mime: "image/svg+xml" }] })).not.toBeNull();
    expect(validatePost({ media: [{ ...m, src: "https://evil.example/pixel.gif" }] })).not.toBeNull();
    expect(validatePost({ media: [{ ...m, w: 0 }] })).not.toBeNull();
    expect(validatePost({ media: [{ ...m, h: 16_385 }] })).not.toBeNull();
    expect(validatePost({ media: [{ ...m, w: 1.5 }] })).not.toBeNull();
    expect(validatePost({ media: [{ ...m, alt: "a".repeat(5001) }] })).not.toBeNull();
    expect(validatePost({ media: [{ ...m, alt: "a".repeat(5000) }] })).toBeNull();
  });

  it("validates replies", () => {
    expect(validatePost({ text: "x", reply_to: "bob.near/1" })).not.toBeNull(); // root missing
    expect(validatePost({ text: "x", reply_to: "bob.near/1", root: "bob.near/1" })).toBeNull();
    expect(
      validatePost({ text: "x", reply_to: "alice.near/5", root: "bob.near/1" }, "alice.near/5"),
    ).not.toBeNull(); // self reply
    expect(validatePost({ text: "x", quote: "nope" })).not.toBeNull();
  });
});

describe("validateEntry", () => {
  it("validates profile keys", () => {
    expect(validateEntry("profile/name", "Alice")).toBeNull();
    expect(validateEntry("profile/name", null)).toBeNull();
    expect(validateEntry("profile/name", "")).toBeNull();
    expect(validateEntry("profile/name", "a".repeat(257))).not.toBeNull();
    expect(validateEntry("profile/name", 5)).not.toBeNull();
    expect(validateEntry("profile/avatar", SRC)).toBeNull();
    expect(validateEntry("profile/avatar", "https://x/a.png")).not.toBeNull();
    expect(validateEntry("profile/links/github", "alice")).toBeNull();
    expect(validateEntry("profile/links/website", "https://alice.dev")).toBeNull();
    expect(validateEntry("profile/links/Website", "x")).not.toBeNull();
    expect(validateEntry("profile/links/x", "a".repeat(2049))).not.toBeNull();
    expect(validateEntry("profile/tags", "x")).not.toBeNull();
  });

  it("validates links as handles or https URLs", () => {
    expect(validateProfileLink("javascript://alert")).not.toBeNull();
    expect(validateProfileLink("http://alice.dev")).not.toBeNull();
    expect(validateProfileLink("t.me/alice")).toBeNull();
  });

  it("validates edges", () => {
    expect(validateEntry(keys.like("alice.near", "1"), {})).toBeNull();
    expect(validateEntry(keys.repost("alice.near", "1"), null)).toBeNull();
    expect(validateEntry(keys.like("alice.near", "1"), true)).not.toBeNull();
    expect(validateEntry("like/alice.near/0", {})).not.toBeNull();
    expect(validateEntry(keys.follow("bob.near"), {}, "alice.near")).toBeNull();
    expect(validateEntry(keys.follow("alice.near"), {}, "alice.near")).not.toBeNull();
    expect(validateEntry(keys.reply("bob.near", "1", "2"), {})).toBeNull();
    expect(validateEntry("graph/block/bob.near", {})).not.toBeNull();
  });

  it("validates posts and tombstones", () => {
    expect(validateEntry(keys.post("1759140000000"), { text: "hi" })).toBeNull();
    expect(validateEntry(keys.post("1759140000000"), null)).toBeNull();
    expect(validateEntry("post/abc", { text: "hi" })).not.toBeNull();
  });

  it("rejects unknown namespaces", () => {
    expect(validateEntry("settings/theme", "dark")).not.toBeNull();
  });
});
