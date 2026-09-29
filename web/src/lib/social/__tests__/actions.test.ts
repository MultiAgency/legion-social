import { describe, expect, it } from "vitest";
import {
  buildCreatePost,
  buildDeletePost,
  buildPostValue,
  buildProfileData,
  followBatches,
} from "../actions";

describe("post builders (STANDARD.md §8)", () => {
  it("builds a plain post", () => {
    expect(buildCreatePost("1759140000000", { text: " Hello, near.social! #hello " })).toEqual({
      "post/1759140000000": { text: "Hello, near.social! #hello" },
    });
  });

  it("builds a reply to a top-level post with the backlink in the same action", () => {
    expect(
      buildCreatePost("1759140000500", {
        text: "Welcome!",
        replyTo: { key: "alice.near/1759140000000", root: null },
      }),
    ).toEqual({
      "post/1759140000500": {
        text: "Welcome!",
        reply_to: "alice.near/1759140000000",
        root: "alice.near/1759140000000",
      },
      "reply/alice.near/1759140000000/1759140000500": {},
    });
  });

  it("uses the parent's root for nested replies", () => {
    const v = buildPostValue({
      text: "deep",
      replyTo: { key: "bob.near/2", root: "alice.near/1" },
    });
    expect(v).toEqual({ text: "deep", reply_to: "bob.near/2", root: "alice.near/1" });
  });

  it("builds a quote", () => {
    expect(buildCreatePost("1759140000900", { text: "This.", quote: "alice.near/1759140000000" })).toEqual({
      "post/1759140000900": { text: "This.", quote: "alice.near/1759140000000" },
    });
  });

  it("omits empty text for media posts", () => {
    const media = [{ src: "fastfs://a.near/social/media/x.webp", mime: "image/webp" as const, w: 10, h: 10 }];
    expect(buildPostValue({ text: "  ", media })).toEqual({ media });
  });

  it("deletes a reply with both tombstones", () => {
    expect(buildDeletePost("1759140000500", "alice.near/1759140000000")).toEqual({
      "post/1759140000500": null,
      "reply/alice.near/1759140000000/1759140000500": null,
    });
    expect(buildDeletePost("1")).toEqual({ "post/1": null });
  });
});

describe("profile builder", () => {
  it("writes flat keys, clearing empty values with null", () => {
    expect(
      buildProfileData(
        { name: " Alice ", about: "", location: null },
        { github: "alice", website: "https://alice.dev", x: "" },
      ),
    ).toEqual({
      "profile/name": "Alice",
      "profile/about": null,
      "profile/location": null,
      "profile/links/github": "alice",
      "profile/links/website": "https://alice.dev",
      "profile/links/x": null,
    });
  });
});

describe("followBatches", () => {
  it("splits follows into batches", () => {
    const targets = Array.from({ length: 501 }, (_, i) => `a${i}.near`);
    const batches = followBatches(targets, 250);
    expect(batches.map((b) => Object.keys(b).length)).toEqual([250, 250, 1]);
    expect(batches[0]["graph/follow/a0.near"]).toEqual({});
  });
});
