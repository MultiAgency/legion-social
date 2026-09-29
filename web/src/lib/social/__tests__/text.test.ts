import { describe, expect, it } from "vitest";
import {
  displayUrl,
  extractHashtags,
  extractMentions,
  mentionQueryAt,
  normalizeHashtag,
  tokenize,
  type Token,
} from "../text";

const kinds = (tokens: Token[]) => tokens.map((t) => `${t.type}:${t.text}`);

describe("tokenize (STANDARD.md §5)", () => {
  it("handles the standard's example post", () => {
    expect(kinds(tokenize("gm @bob.near, check #fastdata https://near.org"))).toEqual([
      "text:gm ",
      "mention:@bob.near",
      "text:, check ",
      "hashtag:#fastdata",
      "text: ",
      "url:https://near.org",
    ]);
  });

  it("returns no tokens for empty text and keeps plain text intact", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("hello\nworld")).toEqual([{ type: "text", text: "hello\nworld" }]);
  });

  describe("URLs", () => {
    it("trims trailing punctuation", () => {
      const t = tokenize("see https://near.org/foo). ok");
      expect(kinds(t)).toEqual(["text:see ", "url:https://near.org/foo", "text:). ok"]);
    });

    it("trims every trailing .,:;!?'\")]}", () => {
      const t = tokenize("https://a.com/x?y=1!?'\")]}.,:;");
      expect(t[0]).toEqual({ type: "url", text: "https://a.com/x?y=1", href: "https://a.com/x?y=1" });
    });

    it("stops at whitespace, <, > and double quotes", () => {
      expect(kinds(tokenize('"https://a.com"'))).toEqual(['text:"', "url:https://a.com", 'text:"']);
      expect(kinds(tokenize("<https://a.com>"))).toEqual(["text:<", "url:https://a.com", "text:>"]);
    });

    it("accepts http and https only", () => {
      expect(tokenize("ftp://a.com").every((t) => t.type === "text")).toBe(true);
      expect(tokenize("javascript:alert(1)").every((t) => t.type === "text")).toBe(true);
      expect(tokenize("http://a.com")[0].type).toBe("url");
    });

    it("ignores mentions and hashtags inside URLs", () => {
      expect(kinds(tokenize("https://x.com/@bob.near"))).toEqual(["url:https://x.com/@bob.near"]);
      expect(kinds(tokenize("https://a.com/#frag"))).toEqual(["url:https://a.com/#frag"]);
    });

    it("does not treat a bare scheme as a link", () => {
      expect(tokenize("https://.").every((t) => t.type === "text")).toBe(true);
    });
  });

  describe("mentions", () => {
    it("trims trailing . - _ and validates the account ID", () => {
      expect(extractMentions("hi @bob.near.")).toEqual(["bob.near"]);
      expect(extractMentions("hi @bob-")).toEqual(["bob"]);
      expect(extractMentions("hi @bob_")).toEqual(["bob"]);
    });

    it("requires a valid account ID", () => {
      expect(extractMentions("@a")).toEqual([]); // too short
      expect(extractMentions("@bob..near")).toEqual([]);
      expect(extractMentions("@Bob")).toEqual([]); // uppercase isn't in the grammar
    });

    it("requires a non-word, non-@, non-dot character (or start) before @", () => {
      expect(extractMentions("alice@bob.near")).toEqual([]);
      expect(extractMentions("@@bob")).toEqual([]);
      expect(extractMentions("x.@bob")).toEqual([]);
      expect(extractMentions("(@bob)")).toEqual(["bob"]);
      expect(extractMentions("@bob")).toEqual(["bob"]);
      expect(extractMentions("hey,@bob")).toEqual(["bob"]);
    });

    it("accepts implicit (64-hex) accounts", () => {
      const hex = "a".repeat(64);
      expect(extractMentions(`@${hex}`)).toEqual([hex]);
    });

    it("dedupes in order of appearance", () => {
      expect(extractMentions("@bob @carol @bob")).toEqual(["bob", "carol"]);
    });

    it("keeps the display text of the trimmed mention only", () => {
      expect(kinds(tokenize("@bob.near."))).toEqual(["mention:@bob.near", "text:."]);
    });
  });

  describe("hashtags", () => {
    it("lowercases and requires a letter", () => {
      const t = tokenize("#NEAR #123 #abc123");
      expect(t.filter((x) => x.type === "hashtag")).toEqual([
        { type: "hashtag", text: "#NEAR", tag: "near" },
        { type: "hashtag", text: "#abc123", tag: "abc123" },
      ]);
    });

    it("supports Unicode letters and numbers", () => {
      expect(extractHashtags("#日本語 #café #Ünïcödé")).toEqual(["日本語", "café", "ünïcödé"]);
    });

    it("rejects hashtags preceded by letters, digits, _, &, # or /", () => {
      expect(extractHashtags("a#tag 1#tag _#tag &#tag ##tag /#tag")).toEqual([]);
      expect(extractHashtags("(#tag)")).toEqual(["tag"]);
    });

    it("stops at characters outside [\\p{L}\\p{N}_]", () => {
      expect(kinds(tokenize("#tag-name"))).toEqual(["hashtag:#tag", "text:-name"]);
      expect(extractHashtags("#tag_name")).toEqual(["tag_name"]);
    });

    it("caps tags at 64 characters", () => {
      const long = "a".repeat(70);
      expect(extractHashtags(`#${long}`)).toEqual(["a".repeat(64)]);
    });
  });

  it("never overlaps tokens", () => {
    const t = tokenize("@bob#tag #tag@bob");
    expect(kinds(t)).toEqual(["mention:@bob", "text:#tag ", "hashtag:#tag", "text:@bob"]);
  });
});

describe("helpers", () => {
  it("normalizeHashtag validates route segments", () => {
    expect(normalizeHashtag("NEAR")).toBe("near");
    expect(normalizeHashtag("123")).toBeNull();
    expect(normalizeHashtag("a-b")).toBeNull();
    expect(normalizeHashtag("")).toBeNull();
  });

  it("displayUrl shortens", () => {
    expect(displayUrl("https://www.near.org/")).toBe("near.org/");
    expect(displayUrl(`https://a.com/${"x".repeat(100)}`, 20)).toHaveLength(20);
  });

  it("mentionQueryAt finds the partial mention at the caret", () => {
    expect(mentionQueryAt("hi @bo", 6)).toEqual({ query: "bo", start: 3 });
    expect(mentionQueryAt("hi @", 4)).toEqual({ query: "", start: 3 });
    expect(mentionQueryAt("mail@bo", 7)).toBeNull();
    expect(mentionQueryAt("hi @bob there", 13)).toBeNull();
  });
});
