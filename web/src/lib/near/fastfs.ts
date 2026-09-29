/**
 * FastFS uploads (`__fastdata_fastfs`, borsh args), per STANDARD.md §4.
 *
 * Files are content-addressed (`media/{sha256}.{ext}`), so they are immutable. The FastFS CDN
 * caches 404s, so availability is only ever probed with a cache-busting `?v=` query; the clean
 * URL is never requested before it returns 200.
 *
 * Files ≤ 1 MiB go in one `Simple` transaction. Larger ones (up to `LIMITS.maxUploadBytes`)
 * are sent as one `Partial` transaction per 1 MiB chunk, all sharing one nonce.
 */
import { serialize, type Schema } from "borsh";
import { env } from "@/lib/env";
import { FASTFS_CHUNK, fastfsUri, LIMITS } from "@/lib/social/standard";
import { readLocal, writeLocal } from "@/lib/local-store";
import { waitForTx } from "./confirm";
import { SigningError } from "./errors";
import { sendSocialCall } from "./queue";

/* Borsh schema (borsh-js v2 inline struct form), from fastdata-drag-and-drop/src/hooks/fastfs.js */
const FastfsFileContent: Schema = {
  struct: { mimeType: "string", content: { array: { type: "u8" } } },
};
const SimpleFastfs: Schema = {
  struct: { relativePath: "string", content: { option: FastfsFileContent } },
};
const PartialFastfs: Schema = {
  struct: {
    relativePath: "string",
    offset: "u32",
    fullSize: "u32",
    mimeType: "string",
    contentChunk: { array: { type: "u8" } },
    nonce: "u32",
  },
};
export const FastfsDataSchema: Schema = {
  enum: [{ struct: { simple: SimpleFastfs } }, { struct: { partial: PartialFastfs } }],
};

export interface FastfsSimple {
  simple: {
    relativePath: string;
    content: { mimeType: string; content: Uint8Array } | null;
  };
}

/** Encodes `FastfsData::Simple { relative_path, content: Some({ mime_type, content }) }`. */
export function encodeFastfsSimple(relativePath: string, mimeType: string, content: Uint8Array) {
  const value: FastfsSimple = { simple: { relativePath, content: { mimeType, content } } };
  return serialize(FastfsDataSchema, value);
}

export interface FastfsPartialFields {
  relativePath: string;
  /** Byte offset of this chunk: a multiple of 1 MiB. */
  offset: number;
  /** Total file size, the same in every chunk. */
  fullSize: number;
  mimeType: string;
  contentChunk: Uint8Array;
  /** 1..2^31-1, the same in every chunk of one upload. */
  nonce: number;
}

/**
 * Encodes `FastfsData::Partial { relative_path, offset, full_size, mime_type, content_chunk,
 * nonce }`.
 */
export function encodeFastfsPartial(fields: FastfsPartialFields) {
  return serialize(FastfsDataSchema, { partial: fields });
}

/** Splits a file into FastFS chunks: 1 MiB views, the last one shorter. */
export function splitChunks(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += FASTFS_CHUNK) {
    chunks.push(bytes.subarray(offset, offset + FASTFS_CHUNK));
  }
  return chunks;
}

/** A fresh upload nonce in 1..2^31-1. */
function randomNonce(): number {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return (n % 0x7fff_ffff) + 1;
}

export interface ProcessedMedia {
  bytes: Uint8Array;
  mime: string;
  ext: string;
  w: number;
  h: number;
  sha256hex: string;
}

export function mediaPath(m: Pick<ProcessedMedia, "sha256hex" | "ext">): string {
  return `media/${m.sha256hex}.${m.ext}`;
}

export function gatewayUrl(accountId: string, path: string): string {
  return `${env.fastfsGateway}/${accountId}/${env.socialAccountId}/${path}`;
}

function bust(url: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${url}?v=${rand}`;
}

/** HEAD with a cache-busting query. Never touches the clean URL. */
export async function isUploaded(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(bust(url), { method: "HEAD", signal });
    return res.status === 200;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type UploadStatus = "checking" | "sending" | "waiting" | "done";

/** Chunk progress for multi-chunk uploads: `part` is 1-based. */
export interface UploadProgress {
  part: number;
  parts: number;
}

export interface UploadOptions {
  signal?: AbortSignal;
  /** `progress` is set on "sending" for multi-chunk uploads, once per chunk. */
  onStatus?: (status: UploadStatus, progress?: UploadProgress) => void;
  /** How long to wait after the indexer confirms the tx before probing FastFS. */
  settleMs?: number;
  pollIntervalMs?: number;
  /** How long to keep probing FastFS after the settle delay (plus 2 s per chunk). */
  timeoutMs?: number;
}

/* Extra FastFS probing time per chunk of a multi-chunk upload. */
const POLL_MS_PER_CHUNK = 2000;

/* Paths this browser uploaded before (content-addressed, so they don't change). */
const UPLOADED_MAX = 500;
const uploadedKey = (accountId: string) => `ns:fastfs:${accountId}`;

function uploadedPaths(accountId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(readLocal(uploadedKey(accountId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function rememberUploaded(accountId: string, path: string) {
  const paths = uploadedPaths(accountId).filter((p) => p !== path);
  paths.push(path);
  writeLocal(uploadedKey(accountId), JSON.stringify(paths.slice(-UPLOADED_MAX)));
}

/**
 * Uploads processed media to FastFS under the account and returns its `fastfs://` URI.
 *
 * FastFS serves a file only after its own indexer has processed the final block (of every
 * chunk), so probing right after sending just produces 404s. Instead:
 *  1. wait until our indexer confirms the tx, or every chunk's tx (`/v1/tx`), which means the
 *     blocks are final;
 *  2. give FastFS's indexer a couple of seconds to catch up;
 *  3. only then probe the gateway (cache-busting HEAD) until it serves the file.
 * Files this browser uploaded before are checked first and not re-sent.
 */
export async function uploadMedia(
  accountId: string,
  media: ProcessedMedia,
  opts: UploadOptions = {},
): Promise<string> {
  const { signal, onStatus, settleMs = 2500, pollIntervalMs = 1500, timeoutMs = 30_000 } = opts;
  const path = mediaPath(media);
  const uri = fastfsUri(accountId, env.socialAccountId, path);
  const url = gatewayUrl(accountId, path);
  const aborted = () => new DOMException("Upload aborted", "AbortError");

  if (media.bytes.length > LIMITS.maxUploadBytes) {
    throw new SigningError("invalid_write", "Images up to 8 MB");
  }

  if (uploadedPaths(accountId).includes(path)) {
    onStatus?.("checking");
    if (await isUploaded(url, signal)) {
      onStatus?.("done");
      return uri;
    }
  }

  const hashes: string[] = [];
  if (media.bytes.length <= FASTFS_CHUNK) {
    onStatus?.("sending");
    const args = encodeFastfsSimple(path, media.mime, media.bytes);
    hashes.push(await sendSocialCall(accountId, "__fastdata_fastfs", args));
  } else {
    // In offset order; sendSocialCall serializes per account anyway.
    const chunks = splitChunks(media.bytes);
    const nonce = randomNonce();
    for (const [i, contentChunk] of chunks.entries()) {
      if (signal?.aborted) throw aborted();
      onStatus?.("sending", { part: i + 1, parts: chunks.length });
      const args = encodeFastfsPartial({
        relativePath: path,
        offset: i * FASTFS_CHUNK,
        fullSize: media.bytes.length,
        mimeType: media.mime,
        contentChunk,
        nonce,
      });
      hashes.push(await sendSocialCall(accountId, "__fastdata_fastfs", args));
    }
  }

  onStatus?.("waiting");
  await Promise.all(
    hashes.map((hash) =>
      waitForTx(hash, { signal, timeoutMs: 20_000 }).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        // Indexer unavailable or slow: fall back to probing FastFS after the settle delay.
      }),
    ),
  );
  if (signal?.aborted) throw aborted();
  await sleep(settleMs);

  const extraMs = hashes.length > 1 ? POLL_MS_PER_CHUNK * hashes.length : 0;
  const deadline = Date.now() + timeoutMs + extraMs;
  for (;;) {
    if (signal?.aborted) throw aborted();
    if (await isUploaded(url, signal)) {
      rememberUploaded(accountId, path);
      onStatus?.("done");
      return uri;
    }
    if (Date.now() + pollIntervalMs > deadline) break;
    await sleep(pollIntervalMs);
  }
  throw new SigningError(
    "upload_timeout",
    "The image was sent but isn't available yet. Try again in a moment.",
  );
}
