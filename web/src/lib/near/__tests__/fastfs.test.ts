import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deserialize } from "borsh";
import { env } from "@/lib/env";
import { readLocal } from "@/lib/local-store";
import { FASTFS_CHUNK, fastfsUri, LIMITS } from "@/lib/social/standard";
import { waitForTx } from "../confirm";
import { SigningError } from "../errors";
import {
  encodeFastfsPartial,
  encodeFastfsSimple,
  FastfsDataSchema,
  gatewayUrl,
  splitChunks,
  uploadMedia,
  type ProcessedMedia,
} from "../fastfs";
import { sendSocialCall } from "../queue";

vi.mock("../queue", () => ({ sendSocialCall: vi.fn() }));
vi.mock("../confirm", () => ({ waitForTx: vi.fn() }));
vi.mock("@/lib/local-store", () => ({ readLocal: vi.fn(() => null), writeLocal: vi.fn() }));

const MiB = 1_048_576;
const enc = new TextEncoder();

function u32le(n: number) {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

/** The SKILL.md reference: b"\x01" + s(path) + u32(off) + u32(size) + s(mime) + s(chunk) + u32(nonce). */
function referencePartial(path: string, offset: number, fullSize: number, mime: string, chunk: Uint8Array, nonce: number) {
  const s = (b: Uint8Array) => [...u32le(b.length), ...b];
  const head = [1, ...s(enc.encode(path)), ...u32le(offset), ...u32le(fullSize), ...s(enc.encode(mime)), ...u32le(chunk.length)];
  return Buffer.concat([Buffer.from(head), chunk, Buffer.from(u32le(nonce))]);
}

describe("FastFS Partial encoding", () => {
  it("encodes a small Partial byte for byte", () => {
    const bytes = encodeFastfsPartial({
      relativePath: "media/ab.gif",
      offset: MiB,
      fullSize: MiB + 3,
      mimeType: "image/gif",
      contentChunk: new Uint8Array([7, 8, 9]),
      nonce: 0x7fffffff,
    });
    expect(Array.from(bytes)).toEqual([
      1, // enum variant: partial
      ...u32le(12),
      ...enc.encode("media/ab.gif"),
      ...u32le(MiB), // offset
      ...u32le(MiB + 3), // full_size
      ...u32le(9),
      ...enc.encode("image/gif"),
      ...u32le(3),
      7,
      8,
      9,
      ...u32le(0x7fffffff), // nonce
    ]);
  });

  it("matches the reference layout for a 1.28 MB file in two chunks", () => {
    const path = "media/abc.webp";
    const mime = "image/webp";
    const nonce = 12345;
    const data = new Uint8Array(1_280_000).map((_, i) => i % 256);
    const chunks = splitChunks(data);
    expect(chunks.map((c) => c.length)).toEqual([MiB, 1_280_000 - MiB]);

    const encoded = chunks.map((contentChunk, i) =>
      encodeFastfsPartial({ relativePath: path, offset: i * MiB, fullSize: data.length, mimeType: mime, contentChunk, nonce }),
    );
    expect(encoded.map((e) => e.length)).toEqual([1_048_625, 231_473]);

    // Header of the second chunk: tag, path, offset, full_size, mime, chunk length.
    expect(Array.from(encoded[1].subarray(0, 45))).toEqual([
      1,
      14, 0, 0, 0, ...enc.encode(path),
      0x00, 0x00, 0x10, 0x00, // offset 1,048,576
      0x00, 0x88, 0x13, 0x00, // full_size 1,280,000
      10, 0, 0, 0, ...enc.encode(mime),
      0x00, 0x88, 0x03, 0x00, // chunk length 231,424
    ]);
    expect(Array.from(encoded[1].subarray(-4))).toEqual([0x39, 0x30, 0, 0]); // nonce 12345

    for (const [i, e] of encoded.entries()) {
      const expected = referencePartial(path, i * MiB, data.length, mime, chunks[i], nonce);
      expect(Buffer.from(e).equals(expected)).toBe(true);
    }
  });
});

describe("splitChunks", () => {
  it("cuts 1 MiB views with a shorter last chunk", () => {
    const chunks = splitChunks(new Uint8Array(8 * MiB + 1));
    expect(chunks).toHaveLength(9);
    expect(chunks.slice(0, 8).every((c) => c.length === MiB)).toBe(true);
    expect(chunks[8]).toHaveLength(1);
  });

  it("handles exact multiples and small files", () => {
    expect(splitChunks(new Uint8Array(2 * MiB)).map((c) => c.length)).toEqual([MiB, MiB]);
    expect(splitChunks(new Uint8Array(5)).map((c) => c.length)).toEqual([5]);
    expect(FASTFS_CHUNK).toBe(MiB);
  });
});

describe("uploadMedia", () => {
  const account = "alice.near";
  const send = vi.mocked(sendSocialCall);
  const confirm = vi.mocked(waitForTx);
  let heads: { url: string; at: number }[];
  let confirmedAt: number[];
  /** Returns the HEAD status for a probe at time `now`. */
  let headStatus: (now: number) => number;

  function media(size: number, mime = "image/gif", ext = "gif"): ProcessedMedia {
    const bytes = new Uint8Array(size).map((_, i) => (i * 7) % 251);
    return { bytes, mime, ext, w: 10, h: 10, sha256hex: "ab".repeat(32) };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    heads = [];
    confirmedAt = [];
    headStatus = () => 200;
    let n = 0;
    send.mockReset().mockImplementation(async () => `hash${n++}`);
    confirm.mockReset().mockImplementation(async (hash) => {
      confirmedAt.push(Date.now());
      return { tx_hash: hash, indexed: true, actions: [] };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(init?.method).toBe("HEAD");
        heads.push({ url, at: Date.now() });
        return new Response(null, { status: headStatus(Date.now()) });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.mocked(readLocal).mockReset().mockReturnValue(null);
  });

  async function run(m: ProcessedMedia, statuses: string[] = []) {
    const promise = uploadMedia(account, m, {
      onStatus: (s, p) => statuses.push(p ? `${s} ${p.part}/${p.parts}` : s),
    });
    // Settle the result before advancing so a rejection is never unhandled.
    const settled = promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.advanceTimersByTimeAsync(120_000);
    return settled;
  }

  it("sends chunks in offset order with one nonce, confirms every hash, then settles and probes", async () => {
    const m = media(2 * MiB + 500);
    const path = `media/${m.sha256hex}.gif`;
    headStatus = (now) => (now - confirmedAt[0] >= 4000 ? 200 : 404);
    const statuses: string[] = [];

    const result = await run(m, statuses);
    expect(result).toEqual({ ok: true, value: fastfsUri(account, env.socialAccountId, path) });

    // Chunks: offset order, same full_size and nonce, content reassembles the file.
    expect(send).toHaveBeenCalledTimes(3);
    const decoded = send.mock.calls.map(([acct, method, args]) => {
      expect(acct).toBe(account);
      expect(method).toBe("__fastdata_fastfs");
      return (deserialize(FastfsDataSchema, args) as { partial: Record<string, unknown> }).partial;
    });
    expect(decoded.map((d) => d.offset)).toEqual([0, MiB, 2 * MiB]);
    expect(decoded.map((d) => d.fullSize)).toEqual([m.bytes.length, m.bytes.length, m.bytes.length]);
    expect(decoded.every((d) => d.relativePath === path && d.mimeType === "image/gif")).toBe(true);
    const nonce = decoded[0].nonce as number;
    expect(nonce).toBeGreaterThanOrEqual(1);
    expect(nonce).toBeLessThanOrEqual(0x7fffffff);
    expect(decoded.every((d) => d.nonce === nonce)).toBe(true);
    const joined = new Uint8Array(decoded.flatMap((d) => d.contentChunk as number[]));
    expect(Buffer.from(joined).equals(Buffer.from(m.bytes))).toBe(true);

    // Every chunk hash is confirmed, after all chunks were sent.
    expect(confirm.mock.calls.map(([hash]) => hash)).toEqual(["hash0", "hash1", "hash2"]);
    expect(confirm.mock.invocationCallOrder[0]).toBeGreaterThan(send.mock.invocationCallOrder[2]);

    // The first HEAD waits for the 2.5 s settle delay and always busts the cache.
    expect(heads[0].at - Math.max(...confirmedAt)).toBeGreaterThanOrEqual(2500);
    expect(heads.every((h) => h.url.startsWith(`${gatewayUrl(account, path)}?v=`))).toBe(true);
    expect(statuses).toEqual(["sending 1/3", "sending 2/3", "sending 3/3", "waiting", "done"]);
  });

  it("probes about 2 s longer per chunk", async () => {
    // Available only after 34 s of probing: past the 30 s default, within 30 + 3 × 2 s.
    headStatus = (now) => (now - confirmedAt[0] >= 2500 + 34_000 ? 200 : 404);
    const result = await run(media(2 * MiB + 1));
    expect(result.ok).toBe(true);
  });

  it("still probes FastFS when the indexer doesn't confirm a chunk", async () => {
    confirm.mockImplementation(async (hash) => {
      confirmedAt.push(Date.now());
      if (hash === "hash1") throw new SigningError("confirm_timeout", "slow");
      return { tx_hash: hash, indexed: true, actions: [] };
    });
    const result = await run(media(MiB + 1));
    expect(result.ok).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("keeps ≤ 1 MiB files in one Simple transaction", async () => {
    const m = media(MiB, "image/webp", "webp");
    const path = `media/${m.sha256hex}.webp`;
    const statuses: string[] = [];

    const result = await run(m, statuses);
    expect(result).toEqual({ ok: true, value: fastfsUri(account, env.socialAccountId, path) });
    expect(send).toHaveBeenCalledTimes(1);
    expect(Buffer.from(send.mock.calls[0][2]).equals(Buffer.from(encodeFastfsSimple(path, "image/webp", m.bytes)))).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][1]).toMatchObject({ timeoutMs: 20_000 });
    expect(heads[0].at - confirmedAt[0]).toBeGreaterThanOrEqual(2500);
    expect(statuses).toEqual(["sending", "waiting", "done"]);
  });

  it("gives up after 30 s of probing a Simple upload", async () => {
    headStatus = () => 404;
    const result = await run(media(1000, "image/webp", "webp"));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({ code: "upload_timeout" });
    expect(heads.at(-1)!.at - confirmedAt[0]).toBeLessThanOrEqual(2500 + 30_000);
  });

  it("skips files this browser already uploaded", async () => {
    const m = media(3 * MiB);
    vi.mocked(readLocal).mockReturnValue(JSON.stringify([`media/${m.sha256hex}.gif`]));
    const statuses: string[] = [];
    const result = await run(m, statuses);
    expect(result.ok).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(statuses).toEqual(["checking", "done"]);
  });

  it("rejects files over the upload cap before sending anything", async () => {
    const result = await run(media(LIMITS.maxUploadBytes + 1));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBeInstanceOf(SigningError);
    expect(!result.ok && result.error).toMatchObject({ code: "invalid_write", message: "Images up to 8 MB" });
    expect(send).not.toHaveBeenCalled();
    expect(heads).toHaveLength(0);
  });
});
