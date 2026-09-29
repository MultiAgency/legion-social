import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { FeedItem, Page } from "../types";
import { feedQuery, fetchFeedPage, homeFeed, qk } from "../queries";

describe("homeFeed", () => {
  it("defaults to For you, signed in or out", () => {
    expect(homeFeed(null, "me.near")).toEqual({ tab: "for_you", spec: { kind: "for_you" } });
    expect(homeFeed(undefined, null)).toEqual({ tab: "for_you", spec: { kind: "for_you" } });
    expect(homeFeed("", "me.near").tab).toBe("for_you");
  });

  it("shows Following only when signed in", () => {
    expect(homeFeed("following", "me.near")).toEqual({
      tab: "following",
      spec: { kind: "following", account: "me.near" },
    });
    expect(homeFeed("following", null).tab).toBe("for_you");
  });

  it("keeps ?feed=latest", () => {
    expect(homeFeed("latest", "me.near")).toEqual({ tab: "latest", spec: { kind: "global" } });
    expect(homeFeed("latest", null)).toEqual({ tab: "latest", spec: { kind: "global" } });
    expect(homeFeed(["latest", "following"], "me.near").tab).toBe("latest");
  });
});

describe("For you feed", () => {
  afterEach(() => vi.unstubAllGlobals());

  const page = (next: string | null): Page<FeedItem> => ({ items: [], next_cursor: next });

  it("requests /v1/feed/for_you with the viewer and passes the opaque cursor through", async () => {
    const urls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(new URL(url));
        return Response.json(page(urls.length === 1 ? "f12.p3.gx" : null));
      }),
    );

    const qc = new QueryClient();
    const options = feedQuery({ kind: "for_you" }, "eve1.near");
    expect(options.queryKey).toEqual(qk.feed({ kind: "for_you" }, "eve1.near"));
    const data = await qc.fetchInfiniteQuery(options);
    const next = options.getNextPageParam(data.pages[0], data.pages, null, data.pageParams);
    expect(next).toBe("f12.p3.gx");
    await fetchFeedPage({ kind: "for_you" }, { cursor: next, viewer: "eve1.near" });

    expect(urls.map((u) => u.pathname)).toEqual(["/v1/feed/for_you", "/v1/feed/for_you"]);
    expect(urls[0].searchParams.get("viewer")).toBe("eve1.near");
    expect(urls[0].searchParams.has("cursor")).toBe(false);
    expect(urls[1].searchParams.get("cursor")).toBe("f12.p3.gx");
    expect(urls[1].searchParams.get("limit")).toBe("20");
  });

  it("works signed out (no viewer param)", async () => {
    const urls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(new URL(url));
        return Response.json(page(null));
      }),
    );
    await fetchFeedPage({ kind: "for_you" }, { viewer: null });
    expect(urls[0].pathname).toBe("/v1/feed/for_you");
    expect(urls[0].searchParams.has("viewer")).toBe(false);
  });
});
