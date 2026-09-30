import { describe, expect, it } from "vitest";
import type { LinkPreview, Post, PostLink } from "@/lib/api/types";
import {
  formatDuration,
  hideTrailingUrl,
  linkHost,
  needsPreviewFetch,
  proxiedImage,
  resolvePostLink,
  youtubeSrc,
  youtubeThumbnail,
} from "../links";

describe("hideTrailingUrl", () => {
  const url = "https://example.com/a?b=1";

  it("drops a URL at the end", () => {
    expect(hideTrailingUrl(`look ${url}`, url)).toBe("look");
    expect(hideTrailingUrl(`look:\n\n${url}`, url)).toBe("look:");
  });

  it("tolerates trailing whitespace and newlines", () => {
    expect(hideTrailingUrl(`look ${url}  \n\n`, url)).toBe("look");
    expect(hideTrailingUrl(`look ${url}\t\r\n`, url)).toBe("look");
  });

  it("keeps a URL followed by punctuation or more text", () => {
    expect(hideTrailingUrl(`look ${url}.`, url)).toBe(`look ${url}.`);
    expect(hideTrailingUrl(`${url} is neat`, url)).toBe(`${url} is neat`);
  });

  it("keeps a URL that is only a prefix of the last one", () => {
    const text = `see ${url}&c=2`;
    expect(hideTrailingUrl(text, url)).toBe(text);
  });

  it("strips only the last copy when the URL appears twice", () => {
    expect(hideTrailingUrl(`${url} again: ${url}`, url)).toBe(`${url} again:`);
    expect(hideTrailingUrl(`${url} and ${url} then text`, url)).toBe(`${url} and ${url} then text`);
  });

  it("can leave the text empty", () => {
    expect(hideTrailingUrl(url, url)).toBe("");
    expect(hideTrailingUrl(`  ${url}\n`, url)).toBe("");
  });

  it("leaves text without the URL alone", () => {
    expect(hideTrailingUrl("no links here ", url)).toBe("no links here ");
    expect(hideTrailingUrl("text", "")).toBe("text");
  });
});

describe("URL helpers", () => {
  it("proxies images through i.near.social/large without the fragment", () => {
    expect(proxiedImage("https://a.com/x.png")).toBe("https://i.near.social/large/https://a.com/x.png");
    expect(proxiedImage("https://a.com/x.png?w=1#frag")).toBe(
      "https://i.near.social/large/https://a.com/x.png?w=1",
    );
    expect(youtubeThumbnail("dQw4w9WgXcQ")).toBe(
      "https://i.near.social/large/https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
  });

  it("builds youtube-nocookie embed URLs", () => {
    const base = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0";
    expect(youtubeSrc("dQw4w9WgXcQ")).toBe(base);
    expect(youtubeSrc("dQw4w9WgXcQ", null)).toBe(base);
    expect(youtubeSrc("dQw4w9WgXcQ", 0)).toBe(base);
    expect(youtubeSrc("dQw4w9WgXcQ", 90)).toBe(`${base}&start=90`);
    expect(youtubeSrc("dQw4w9WgXcQ", 12.7)).toBe(`${base}&start=12`);
  });

  it("shows the host without www.", () => {
    expect(linkHost("https://www.example.com/a")).toBe("example.com");
    expect(linkHost("https://News.Example.co.uk:8080/x")).toBe("news.example.co.uk");
    expect(linkHost("https://wwwexample.com")).toBe("wwwexample.com");
    expect(linkHost("https://bücher.de")).toBe("xn--bcher-kva.de");
    expect(linkHost("not a url")).toBe("");
  });

  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(75.9)).toBe("1:15");
    expect(formatDuration(600)).toBe("10:00");
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(-3)).toBe("0:00");
    expect(formatDuration(NaN)).toBe("0:00");
    expect(formatDuration(Infinity)).toBe("0:00");
  });
});

function post(text: string, link?: PostLink | null, extra: Partial<Post> = {}): Post {
  return {
    key: "a.near/1",
    id: "1",
    author: { account_id: "a.near", name: null, avatar_url: null },
    text,
    media: [],
    created_at: 1,
    block_height: 1,
    edited_at: null,
    reply_to: null,
    root: null,
    quote: null,
    mentions: [],
    hashtags: [],
    counts: { replies: 0, reposts: 0, likes: 0, quotes: 0 },
    link,
    ...extra,
  };
}

describe("resolvePostLink", () => {
  const url = "https://example.com/story";
  const text = `read this ${url}`;
  const card: LinkPreview = { kind: "card", title: "T", description: null, site_name: null, image: null, large: false };

  it("shows nothing extra without a link", () => {
    expect(resolvePostLink(post(text))).toEqual({ text, quote: null, embed: null });
    expect(resolvePostLink(post(text, null))).toEqual({ text, quote: null, embed: null });
  });

  it("shows a linked post as the quote and hides its URL", () => {
    const linked = post("hi", null, { key: "b.near/2", id: "2" });
    const nsUrl = "https://near.social/b.near/post/2";
    const r = resolvePostLink(post(`this ${nsUrl}`, { url: nsUrl, post: linked }));
    expect(r).toEqual({ text: "this", quote: linked, embed: null });
  });

  it("prefers the on-chain quote and then keeps the URL", () => {
    const quoted = post("q", null, { key: "c.near/3", id: "3" });
    const linked = post("hi", null, { key: "b.near/2", id: "2" });
    const nsUrl = "https://near.social/b.near/post/2";
    const r = resolvePostLink(post(`x ${nsUrl}`, { url: nsUrl, post: linked }, { quote: quoted }));
    expect(r.quote).toBe(quoted);
    expect(r.text).toBe(`x ${nsUrl}`);
  });

  it("uses the inline preview over a fetched one", () => {
    const fetched = { url, preview: { kind: "none" } as LinkPreview };
    const r = resolvePostLink(post(text, { url, post: null, preview: card }), fetched);
    expect(r).toEqual({ text: "read this", quote: null, embed: { url, preview: card } });
  });

  it("uses the fetched preview when none came inline", () => {
    const yt: LinkPreview = { kind: "youtube", video_id: "dQw4w9WgXcQ", start: null, shorts: false };
    const r = resolvePostLink(post(text, { url }), { url, preview: yt });
    expect(r).toEqual({ text: "read this", quote: null, embed: { url, preview: yt } });
  });

  it("renders nothing and keeps the URL while loading or for `none`", () => {
    expect(resolvePostLink(post(text, { url, preview: null }))).toEqual({ text, quote: null, embed: null });
    expect(resolvePostLink(post(text, { url }), { url, preview: { kind: "none" } })).toEqual({
      text,
      quote: null,
      embed: null,
    });
  });

  it("keeps the URL for `unavailable`", () => {
    const r = resolvePostLink(post(text, { url, preview: { kind: "unavailable" } }));
    expect(r).toEqual({ text, quote: null, embed: { url, preview: { kind: "unavailable" } } });
  });

  it("ignores preview kinds it doesn't know", () => {
    const odd = { kind: "hologram" } as unknown as LinkPreview;
    expect(resolvePostLink(post(text, { url, preview: odd })).embed).toBeNull();
  });

  it("fetches only uncached, confirmed links", () => {
    expect(needsPreviewFetch(post(text, { url }))).toBe(true);
    expect(needsPreviewFetch(post(text, { url, preview: null }))).toBe(true);
    expect(needsPreviewFetch(post(text))).toBe(false);
    expect(needsPreviewFetch(post(text, null))).toBe(false);
    expect(needsPreviewFetch(post(text, { url, preview: card }))).toBe(false);
    expect(needsPreviewFetch(post(text, { url, preview: { kind: "none" } }))).toBe(false);
    expect(needsPreviewFetch(post(text, { url, post: post("hi") }))).toBe(false);
    expect(needsPreviewFetch(post(text, { url }, { _pending: true }))).toBe(false);
  });
});
