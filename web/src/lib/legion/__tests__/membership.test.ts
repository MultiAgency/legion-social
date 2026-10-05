import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBuilder } from "../membership";

describe("fetchBuilder", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads /v1/builders/{account}, and null when the server runs without Legion", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return urls.length === 1
          ? Response.json({ account_id: "b.near", builder: true })
          : Response.json({ error: "not_found" }, { status: 404 });
      }),
    );
    expect(await fetchBuilder("b.near")).toEqual({ account_id: "b.near", builder: true });
    expect(new URL(urls[0]).pathname).toBe("/v1/builders/b.near");
    expect(await fetchBuilder("b.near")).toBeNull();
  });
});
