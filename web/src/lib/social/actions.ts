/**
 * social-kv/1 write actions. Each builds the args of ONE `__fastdata_kv` call (see
 * STANDARD.md §8) and sends it with the app key. They resolve with the tx hash once the
 * transaction is included; confirm through `/v1/tx` (see `lib/near/confirm.ts`).
 */
import type { KvData } from "@/lib/near/kv";

/** The signing pipeline is loaded on first write, keeping crypto out of the initial bundle. */
async function writeKv(accountId: string, data: KvData): Promise<string> {
  const kv = await import("@/lib/near/kv");
  return kv.writeKv(accountId, data);
}
import {
  keys,
  LIMITS,
  nextPostId,
  parsePostRef,
  type MediaValue,
  type PostValue,
  type ProfileField,
} from "./standard";

export interface NewPostInput {
  text: string;
  media?: MediaValue[];
  /** Parent post key and the parent's `root` (null for a top-level parent). */
  replyTo?: { key: string; root: string | null } | null;
  /** Quoted post key. */
  quote?: string | null;
}

/** Builds the `post/{id}` value (fields omitted when empty). */
export function buildPostValue(input: NewPostInput): PostValue {
  const value: PostValue = {};
  const text = input.text.trim();
  if (text) value.text = text;
  if (input.media && input.media.length > 0) value.media = input.media;
  if (input.replyTo) {
    value.reply_to = input.replyTo.key;
    // root = the parent's root, or the parent itself when it's a top-level post.
    value.root = input.replyTo.root ?? input.replyTo.key;
  }
  if (input.quote) value.quote = input.quote;
  return value;
}

/** Args for creating a post (plus the reply backlink in the same action for replies). */
export function buildCreatePost(postId: string, input: NewPostInput): KvData {
  const data: KvData = { [keys.post(postId)]: buildPostValue(input) };
  if (input.replyTo) {
    const parent = parsePostRef(input.replyTo.key);
    if (parent) data[keys.reply(parent.accountId, parent.postId, postId)] = {};
  }
  return data;
}

export interface CreatedPost {
  hash: string;
  postId: string;
  key: string;
  value: PostValue;
}

export async function createPost(accountId: string, input: NewPostInput): Promise<CreatedPost> {
  const postId = nextPostId(accountId);
  const data = buildCreatePost(postId, input);
  const hash = await writeKv(accountId, data);
  return { hash, postId, key: `${accountId}/${postId}`, value: data[keys.post(postId)] as PostValue };
}

/** Edit: write the full new value to the same key. */
export function editPost(accountId: string, postId: string, value: PostValue): Promise<string> {
  return writeKv(accountId, { [keys.post(postId)]: value });
}

/** Delete: tombstone the post and, for replies, its backlink. */
export function buildDeletePost(postId: string, replyTo?: string | null): KvData {
  const data: KvData = { [keys.post(postId)]: null };
  const parent = replyTo ? parsePostRef(replyTo) : null;
  if (parent) data[keys.reply(parent.accountId, parent.postId, postId)] = null;
  return data;
}

export function deletePost(
  accountId: string,
  postId: string,
  replyTo?: string | null,
): Promise<string> {
  return writeKv(accountId, buildDeletePost(postId, replyTo));
}

function edge(on: boolean) {
  return on ? {} : null;
}

export function setLike(accountId: string, postKey: string, on: boolean): Promise<string> {
  const ref = parsePostRef(postKey);
  if (!ref) return Promise.reject(new Error(`Invalid post key ${postKey}`));
  return writeKv(accountId, { [keys.like(ref.accountId, ref.postId)]: edge(on) });
}

export function setRepost(accountId: string, postKey: string, on: boolean): Promise<string> {
  const ref = parsePostRef(postKey);
  if (!ref) return Promise.reject(new Error(`Invalid post key ${postKey}`));
  return writeKv(accountId, { [keys.repost(ref.accountId, ref.postId)]: edge(on) });
}

export function setFollow(accountId: string, target: string, on: boolean): Promise<string> {
  return writeKv(accountId, { [keys.follow(target)]: edge(on) });
}

export type ProfileFieldsInput = Partial<Record<ProfileField, string | null>>;

/**
 * Flat `profile/*` keys. Empty strings become `null` (clears the field); `links` maps a
 * service to a handle/URL (or null to remove it).
 */
export function buildProfileData(
  fields: ProfileFieldsInput,
  links: Record<string, string | null> = {},
): KvData {
  const data: KvData = {};
  for (const [field, raw] of Object.entries(fields) as [ProfileField, string | null | undefined][]) {
    if (raw === undefined) continue;
    const value = typeof raw === "string" ? raw.trim() : raw;
    data[keys.profile(field)] = value ? value : null;
  }
  for (const [service, raw] of Object.entries(links).slice(0, LIMITS.profileMaxLinks)) {
    const value = typeof raw === "string" ? raw.trim() : raw;
    data[keys.profileLink(service)] = value ? value : null;
  }
  return data;
}

export function updateProfile(
  accountId: string,
  fields: ProfileFieldsInput,
  links?: Record<string, string | null>,
): Promise<string> {
  return writeKv(accountId, buildProfileData(fields, links));
}

/** Splits follow keys into batches of `size`, e.g. for migration. */
export function followBatches(targets: string[], size: number): KvData[] {
  const out: KvData[] = [];
  for (let i = 0; i < targets.length; i += size) {
    const data: KvData = {};
    for (const t of targets.slice(i, i + size)) data[keys.follow(t)] = {};
    out.push(data);
  }
  return out;
}
