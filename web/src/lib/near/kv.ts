/**
 * `__fastdata_kv` writes with client-side pre-validation.
 *
 * FastData drops invalid writes silently, so everything that would be dropped (or rejected by
 * social-kv/1 validation) is caught here before anything is signed.
 */
import { hasLoneSurrogate, LIMITS, validateEntry } from "@/lib/social/standard";
import { SigningError } from "./errors";
import { sendSocialCall, type SendOptions } from "./queue";
import { sendChannelCall } from "@/lib/channels/send";

export interface WriteOptions extends SendOptions {
  /** Write to this channel account instead of `social` (docs/LEGION.md §3). */
  channel?: string | null;
}

export type KvData = Record<string, unknown>;

const ASCII_RE = /^[\x20-\x7e]+$/;

/** Throws `SigningError("invalid_write")` if the args would be (partly) dropped or invalid. */
export function validateKvArgs(data: KvData, author?: string): Uint8Array {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new SigningError("invalid_write", "KV args must be a JSON object.");
  }
  const entries = Object.entries(data);
  if (entries.length === 0) throw new SigningError("invalid_write", "Nothing to write.");
  if (entries.length > LIMITS.maxKeys) {
    throw new SigningError(
      "invalid_write",
      `Too many keys in one write (${entries.length} > ${LIMITS.maxKeys}).`,
    );
  }
  if (hasLoneSurrogate(data)) {
    // JSON.stringify escapes these as \udXXX, which the indexer's JSON parser rejects.
    throw new SigningError("invalid_write", "The text contains an invalid character.");
  }
  const encoder = new TextEncoder();
  for (const [key, value] of entries) {
    if (!ASCII_RE.test(key)) {
      throw new SigningError("invalid_write", `Key "${key}" must be printable ASCII.`);
    }
    if (encoder.encode(key).length > LIMITS.maxKeyBytes) {
      throw new SigningError("invalid_write", `Key is longer than ${LIMITS.maxKeyBytes} bytes.`);
    }
    if (value === undefined) {
      throw new SigningError("invalid_write", `Key "${key}" has no value.`);
    }
    const serialized = JSON.stringify(value);
    if (encoder.encode(serialized).length > LIMITS.maxValueBytes) {
      throw new SigningError("invalid_write", `The value of "${key}" is larger than 256 KiB.`);
    }
    const err = validateEntry(key, value, author);
    if (err) throw new SigningError("invalid_write", err);
  }
  const bytes = encoder.encode(JSON.stringify(data));
  if (bytes.length > LIMITS.maxArgsBytes) {
    throw new SigningError("invalid_write", "This write is larger than 1 MiB.");
  }
  return bytes;
}

/**
 * Validates and sends one `__fastdata_kv` call to `social` signed by the account's app key.
 * Resolves with the transaction hash once included.
 */
export function writeKv(accountId: string, data: KvData, opts: WriteOptions = {}): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = validateKvArgs(data, accountId);
  } catch (err) {
    return Promise.reject(err);
  }
  const { channel, ...send } = opts;
  return channel
    ? sendChannelCall(accountId, channel, bytes, send)
    : sendSocialCall(accountId, "__fastdata_kv", bytes, send);
}
