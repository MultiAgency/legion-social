/**
 * Runs the cross-language test vectors in docs/fixtures/text.json (also used by the Rust
 * indexer's tests), so the web tokenizer and the indexer agree on mentions, hashtags and URLs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractHashtags, extractMentions, tokenize } from "../text";

interface Vector {
  text: string;
  mentions: string[];
  hashtags: string[];
  urls: string[];
}

const vectors: Vector[] = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../../../docs/fixtures/text.json", import.meta.url)),
    "utf8",
  ),
);

describe("shared text vectors (docs/fixtures/text.json)", () => {
  it("has vectors", () => expect(vectors.length).toBeGreaterThan(0));
  for (const v of vectors) {
    it(JSON.stringify(v.text), () => {
      expect(extractMentions(v.text)).toEqual(v.mentions);
      expect(extractHashtags(v.text)).toEqual(v.hashtags);
      expect(
        tokenize(v.text)
          .filter((t) => t.type === "url")
          .map((t) => t.text),
      ).toEqual(v.urls);
    });
  }
});
