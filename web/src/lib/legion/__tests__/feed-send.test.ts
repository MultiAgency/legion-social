import { afterEach, describe, expect, it, vi } from "vitest";
import { removeFeedKeys } from "../feed-send";

function memoryStorage(entries: Record<string, string>): Storage {
  const m = new Map(Object.entries(entries));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe("removeFeedKeys", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forgets the account's feed keys and nothing else", () => {
    const storage = memoryStorage({
      "nsk:v1:a.near": "social key",
      "nsk:v1:a.near:legion": "feed key",
      "nsk:v1:a.near:other": "feed key",
      "nsk:v1:b.near:legion": "someone else's",
      "nsk:channels": "unrelated",
    });
    vi.stubGlobal("window", { localStorage: storage });
    removeFeedKeys("a.near");
    const left = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    expect(left.sort()).toEqual(["nsk:channels", "nsk:v1:a.near", "nsk:v1:b.near:legion"]);
  });
});
