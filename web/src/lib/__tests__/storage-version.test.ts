import { describe, expect, it } from "vitest";
import { migrateStorage, STORAGE_VERSION, STORAGE_VERSION_KEY } from "../storage-version";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  constructor(entries: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(entries)) this.map.set(k, v);
  }
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  keys() {
    return [...this.map.keys()].sort();
  }
}

const legacy = {
  "near-wallet-selector:selectedWalletId": '"my-near-wallet"',
  "near-wallet-selector:contract": '{"contractId":"social.near","methodNames":[]}',
  "near-wallet-selector:recentlySignedInWallets": '["my-near-wallet"]',
  "near-api-js:keystore:alice.near:mainnet": "ed25519:secret",
  "herewallet:keystore": "{}",
  "near-social-vm:v01::accountId:": '"alice.near"',
  "theme": "light",
};

describe("migrateStorage", () => {
  it("drops the previous app's data but keeps this app's keys", () => {
    const s = new MemoryStorage({ ...legacy, "ns:session": "alice.near", "nsk:v1:alice.near": "ed25519:ours" });
    expect(migrateStorage(s)).toBe(0);
    expect(s.keys()).toEqual(["ns:session", STORAGE_VERSION_KEY, "nsk:v1:alice.near"].sort());
    expect(s.getItem(STORAGE_VERSION_KEY)).toBe(String(STORAGE_VERSION));
  });

  it("marks empty storage", () => {
    const s = new MemoryStorage();
    expect(migrateStorage(s)).toBe(0);
    expect(s.keys()).toEqual([STORAGE_VERSION_KEY]);
  });

  it("leaves migrated storage alone, including the wallet selector's new state", () => {
    const s = new MemoryStorage({ ...legacy, [STORAGE_VERSION_KEY]: String(STORAGE_VERSION) });
    expect(migrateStorage(s)).toBe(STORAGE_VERSION);
    expect(s.length).toBe(Object.keys(legacy).length + 1);
  });

  it("leaves storage from a newer app version alone", () => {
    const s = new MemoryStorage({ ...legacy, [STORAGE_VERSION_KEY]: String(STORAGE_VERSION + 1) });
    migrateStorage(s);
    expect(s.getItem("near-wallet-selector:contract")).not.toBeNull();
  });

  it("treats a garbage marker as legacy", () => {
    const s = new MemoryStorage({ ...legacy, [STORAGE_VERSION_KEY]: "abc" });
    expect(migrateStorage(s)).toBe(0);
    expect(s.keys()).toEqual([STORAGE_VERSION_KEY]);
  });

  it("never throws when storage is unavailable or broken", () => {
    expect(migrateStorage(undefined)).toBeNull();
    const broken = new MemoryStorage();
    broken.getItem = () => {
      throw new Error("SecurityError");
    };
    expect(migrateStorage(broken)).toBeNull();
  });
});
