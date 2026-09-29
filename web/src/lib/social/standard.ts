/**
 * social-kv/1: key builders, limits and value validation.
 * Mirrors docs/STANDARD.md exactly. Keep this file in sync with the standard.
 */

export const STANDARD_ID = "social-kv/1";

/* ------------------------------------------------------------------------------------------ */
/* Limits                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export const LIMITS = {
  /** FastData: more than 256 top-level keys drops the whole action. */
  maxKeys: 256,
  /** FastData: keys longer than 1024 bytes are dropped. */
  maxKeyBytes: 1024,
  /** FastData: serialized values longer than 262,144 bytes are dropped. */
  maxValueBytes: 262_144,
  /** Client cap for the whole args object (the chain rejects transactions > 1.5 MiB). */
  maxArgsBytes: 1_048_576,

  profileName: 256,
  profileAbout: 10_000,
  profileLocation: 256,
  profileLink: 2048,
  profileMaxLinks: 32,

  postText: 25_000,
  postMedia: 10,
  mediaAlt: 5_000,
  mediaDimMax: 16_384,

  /** FastFS Simple upload size used by the web app. */
  mediaBytes: 1_000_000,
  mediaMaxDim: 2048,
  /**
   * Web app policy, not part of the standard (FastFS itself allows 32 MiB): the largest file
   * uploaded as-is in 1 MiB chunks. Only animated GIFs get this big; other images are
   * re-encoded to ≤ `mediaBytes`.
   */
  maxUploadBytes: 8 * 1024 * 1024,

  /** Indexer policy: at most 5000 active follows. */
  maxFollows: 5000,
} as const;

export const MAX_POST_ID = 9_007_199_254_740_991; // 2^53 - 1

/** FastFS chunk size (STANDARD.md §4): a file up to this size fits in one `Simple` upload. */
export const FASTFS_CHUNK = 1_048_576;

export const MEDIA_MIMES = [
  "image/webp",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/avif",
] as const;
export type MediaMime = (typeof MEDIA_MIMES)[number];

export const MIME_EXT: Record<MediaMime, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/avif": "avif",
};

export const PROFILE_FIELDS = ["name", "about", "avatar", "banner", "location"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const WELL_KNOWN_SERVICES = [
  "website",
  "x",
  "github",
  "telegram",
  "discord",
  "bluesky",
  "farcaster",
  "youtube",
  "instagram",
  "linkedin",
] as const;

/* ------------------------------------------------------------------------------------------ */
/* Primitive validators                                                                       */
/* ------------------------------------------------------------------------------------------ */

const ACCOUNT_ID_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const POST_ID_RE = /^[1-9][0-9]{0,15}$/;
const SERVICE_RE = /^[a-z0-9_]{1,32}$/;
const FASTFS_PATH_RE = /^[A-Za-z0-9._\-/]{1,1024}$/;

/** Unicode scalar value count (Rust `chars().count()`). */
export function charCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

const LONE_SURROGATE_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** True if any string (key or value) contains a lone UTF-16 surrogate, which isn't valid UTF-8. */
export function hasLoneSurrogate(value: unknown): boolean {
  if (typeof value === "string") return LONE_SURROGATE_RE.test(value);
  if (Array.isArray(value)) return value.some(hasLoneSurrogate);
  if (value && typeof value === "object") {
    return Object.entries(value).some(([k, v]) => LONE_SURROGATE_RE.test(k) || hasLoneSurrogate(v));
  }
  return false;
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function isAccountId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length <= 64 &&
    ACCOUNT_ID_RE.test(value)
  );
}

export function isPostId(value: unknown): value is string {
  return typeof value === "string" && POST_ID_RE.test(value) && Number(value) <= MAX_POST_ID;
}

export interface PostRef {
  accountId: string;
  postId: string;
}

/** Parses `"{account_id}/{post_id}"`. */
export function parsePostRef(value: unknown): PostRef | null {
  if (typeof value !== "string") return null;
  const slash = value.lastIndexOf("/");
  if (slash <= 0) return null;
  const accountId = value.slice(0, slash);
  const postId = value.slice(slash + 1);
  if (!isAccountId(accountId) || !isPostId(postId)) return null;
  return { accountId, postId };
}

export function postRef(accountId: string, postId: string): string {
  return `${accountId}/${postId}`;
}

export function isService(value: unknown): value is string {
  return typeof value === "string" && SERVICE_RE.test(value);
}

export interface FastfsUri {
  uploader: string;
  receiver: string;
  path: string;
}

/** Parses `fastfs://{uploader_account}/{receiver}/{path}`. */
export function parseFastfsUri(value: unknown): FastfsUri | null {
  if (typeof value !== "string" || !value.startsWith("fastfs://")) return null;
  const rest = value.slice("fastfs://".length);
  const a = rest.indexOf("/");
  if (a <= 0) return null;
  const b = rest.indexOf("/", a + 1);
  if (b <= a + 1) return null;
  const uploader = rest.slice(0, a);
  const receiver = rest.slice(a + 1, b);
  const path = rest.slice(b + 1);
  if (!isAccountId(uploader) || !isAccountId(receiver)) return null;
  if (!FASTFS_PATH_RE.test(path) || path.startsWith("/") || path.includes("..")) return null;
  return { uploader, receiver, path };
}

export function isFastfsUri(value: unknown): value is string {
  return parseFastfsUri(value) !== null;
}

export function fastfsUri(uploader: string, receiver: string, path: string): string {
  return `fastfs://${uploader}/${receiver}/${path}`;
}

/** `fastfs://a/r/p` → `{gateway}/a/r/p`. Returns null for anything that isn't a valid FastFS URI. */
export function fastfsToHttps(uri: string, gateway: string): string | null {
  const parsed = parseFastfsUri(uri);
  if (!parsed) return null;
  return `${gateway}/${parsed.uploader}/${parsed.receiver}/${parsed.path}`;
}

/* ------------------------------------------------------------------------------------------ */
/* Keys                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export const keys = {
  profile: (field: ProfileField) => `profile/${field}`,
  profileLink: (service: string) => `profile/links/${service}`,
  post: (postId: string) => `post/${postId}`,
  reply: (parentAccount: string, parentPostId: string, postId: string) =>
    `reply/${parentAccount}/${parentPostId}/${postId}`,
  like: (account: string, postId: string) => `like/${account}/${postId}`,
  repost: (account: string, postId: string) => `repost/${account}/${postId}`,
  follow: (account: string) => `graph/follow/${account}`,
} as const;

/* ------------------------------------------------------------------------------------------ */
/* Values                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export interface MediaValue {
  src: string;
  mime: MediaMime;
  w?: number;
  h?: number;
  alt?: string;
}

export interface PostValue {
  text?: string;
  media?: MediaValue[];
  reply_to?: string;
  root?: string;
  quote?: string;
}

/** An edge value: `{}` means active, `null` removes it. */
export type EdgeValue = Record<string, never> | null;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isDim(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= LIMITS.mediaDimMax;
}

/** Returns an error message, or null when the media object is valid. */
export function validateMedia(m: unknown): string | null {
  if (!isPlainObject(m)) return "media item must be an object";
  if (!isFastfsUri(m.src)) return "media src must be a fastfs:// URI";
  if (typeof m.mime !== "string" || !(MEDIA_MIMES as readonly string[]).includes(m.mime)) {
    return "unsupported media type";
  }
  if (m.w !== undefined && !isDim(m.w)) return "media width must be an integer in 1..16384";
  if (m.h !== undefined && !isDim(m.h)) return "media height must be an integer in 1..16384";
  if (m.alt !== undefined) {
    if (typeof m.alt !== "string") return "alt text must be a string";
    if (charCount(m.alt) > LIMITS.mediaAlt) return "alt text is longer than 5,000 characters";
  }
  return null;
}

/**
 * Validates a `post/{id}` value per STANDARD.md §3.2. `selfRef` is `"{author}/{id}"`, used to
 * reject `reply_to` pointing to the post itself.
 */
export function validatePost(value: unknown, selfRef?: string): string | null {
  if (!isPlainObject(value)) return "post must be an object";
  const { text, media, reply_to, root, quote } = value;
  if (text !== undefined) {
    if (typeof text !== "string") return "text must be a string";
    if (charCount(text) > LIMITS.postText) return "text is longer than 25,000 characters";
  }
  if (media !== undefined) {
    if (!Array.isArray(media)) return "media must be an array";
    if (media.length > LIMITS.postMedia) return "at most 10 media items";
    for (const m of media) {
      const err = validateMedia(m);
      if (err) return err;
    }
  }
  if (reply_to !== undefined) {
    if (!parsePostRef(reply_to)) return "reply_to must be a post reference";
    if (selfRef && reply_to === selfRef) return "a post can't reply to itself";
    if (root === undefined) return "root is required when reply_to is set";
  }
  if (root !== undefined && !parsePostRef(root)) return "root must be a post reference";
  if (quote !== undefined && !parsePostRef(quote)) return "quote must be a post reference";
  const hasText = typeof text === "string" && text.trim().length > 0;
  const hasMedia = Array.isArray(media) && media.length > 0;
  if (!hasText && !hasMedia && quote === undefined) return "a post needs text, media or a quote";
  return null;
}

/** Validates a `profile/{field}` value. `null` and `""` clear the field. */
export function validateProfileField(field: ProfileField, value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return `${field} must be a string`;
  switch (field) {
    case "name":
      return charCount(value) > LIMITS.profileName ? "name is longer than 256 characters" : null;
    case "about":
      return charCount(value) > LIMITS.profileAbout ? "bio is longer than 10,000 characters" : null;
    case "location":
      return charCount(value) > LIMITS.profileLocation
        ? "location is longer than 256 characters"
        : null;
    case "avatar":
    case "banner":
      return isFastfsUri(value) ? null : `${field} must be a fastfs:// URI`;
  }
}

/** A profile link is a handle or an `https://` URL, ≤ 2048 characters. */
export function validateProfileLink(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return "link must be a string";
  if (charCount(value) > LIMITS.profileLink) return "link is longer than 2048 characters";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https:\/\//i.test(value)) {
    return "links must be a handle or an https:// URL";
  }
  return null;
}

export function validateEdge(value: unknown): string | null {
  if (value === null) return null;
  return isPlainObject(value) ? null : "edge value must be {} or null";
}

/**
 * Validates one KV entry against the social-kv/1 key space. Returns an error message or null.
 * `author` is the signer (used for self-reply and self-follow checks).
 */
export function validateEntry(key: string, value: unknown, author?: string): string | null {
  const parts = key.split("/");
  switch (parts[0]) {
    case "profile": {
      if (parts.length === 2 && (PROFILE_FIELDS as readonly string[]).includes(parts[1])) {
        return validateProfileField(parts[1] as ProfileField, value);
      }
      if (parts.length === 3 && parts[1] === "links") {
        if (!isService(parts[2])) return `invalid link service "${parts[2]}"`;
        return validateProfileLink(value);
      }
      return `unknown profile key "${key}"`;
    }
    case "post": {
      if (parts.length !== 2 || !isPostId(parts[1])) return `invalid post key "${key}"`;
      if (value === null) return null;
      return validatePost(value, author ? postRef(author, parts[1]) : undefined);
    }
    case "reply": {
      if (parts.length !== 4 || !isAccountId(parts[1]) || !isPostId(parts[2]) || !isPostId(parts[3])) {
        return `invalid reply key "${key}"`;
      }
      return validateEdge(value);
    }
    case "like":
    case "repost": {
      if (parts.length !== 3 || !isAccountId(parts[1]) || !isPostId(parts[2])) {
        return `invalid ${parts[0]} key "${key}"`;
      }
      return validateEdge(value);
    }
    case "graph": {
      if (parts.length !== 3 || parts[1] !== "follow" || !isAccountId(parts[2])) {
        return `invalid graph key "${key}"`;
      }
      if (author && parts[2] === author) return "you can't follow yourself";
      return validateEdge(value);
    }
    default:
      return `unknown key "${key}"`;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Post IDs                                                                                   */
/* ------------------------------------------------------------------------------------------ */

const LAST_ID_PREFIX = "ns:last-post-id:";

function readLastId(accountId: string): number {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_ID_PREFIX + accountId);
    const n = raw ? Number(raw) : 0;
    return Number.isSafeInteger(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeLastId(accountId: string, id: number): void {
  try {
    globalThis.localStorage?.setItem(LAST_ID_PREFIX + accountId, String(id));
  } catch {
    /* storage unavailable: the in-memory fallback below still bumps within this session */
  }
}

const memoryLastId = new Map<string, number>();

/**
 * New post ID: the current Unix time in ms, bumped by one if it's not greater than the last ID
 * this client used for the account (persisted in localStorage).
 */
export function nextPostId(accountId: string, now: number = Date.now()): string {
  const last = Math.max(readLastId(accountId), memoryLastId.get(accountId) ?? 0);
  const id = Math.min(Math.max(now, last + 1), MAX_POST_ID);
  memoryLastId.set(accountId, id);
  writeLastId(accountId, id);
  return String(id);
}
