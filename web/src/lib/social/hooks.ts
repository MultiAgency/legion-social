"use client";

/**
 * Write hooks with optimistic UI: likes/reposts/follows are coalesced per target (~400 ms, no
 * transaction if the state returns to where it started), new posts are inserted as pending and
 * replaced once `/v1/tx` confirms them, and failures roll back with a toast.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAccount } from "@/components/providers/account-provider";
import { api } from "@/lib/api/client";
import { qk, type FeedSpec } from "@/lib/api/queries";
import type { AccountSummary, FeedItem, Post, PostMedia, Profile } from "@/lib/api/types";
import { confirmTx } from "@/lib/near/confirm";
import { errorMessage, isSigningError } from "@/lib/near/errors";
import { env } from "@/lib/env";
import {
  buildCreatePost,
  buildDeletePost,
  buildPostValue,
  setFollow,
  setLike,
  setRepost,
  updateProfile as sendProfileUpdate,
  type NewPostInput,
  type ProfileFieldsInput,
} from "./actions";
import {
  patchFollowEverywhere,
  patchPostEverywhere,
  prependToFeed,
  removePostEverywhere,
  replaceFeedPost,
} from "./cache";
import {
  fastfsToHttps,
  keys,
  nextPostId,
  type MediaValue,
  type PostValue,
} from "./standard";
import { extractHashtags, extractMentions } from "./text";

import { ownFeed, writeFeed } from "@/lib/legion/feed";

const loadKv = () => import("@/lib/near/kv");

/* ------------------------------------------------------------------------------------------ */
/* Error handling                                                                             */
/* ------------------------------------------------------------------------------------------ */

function useWriteErrorHandler() {
  const router = useRouter();
  const { refreshKey } = useAccount();
  return React.useCallback(
    (err: unknown, what = "That didn't go through") => {
      if (isSigningError(err, "not_enough_allowance")) {
        toast.error("Your posting key is out of allowance", {
          description: "Rotate the key to get a fresh allowance.",
          action: { label: "Rotate", onClick: () => router.push("/settings#posting-key") },
        });
        return;
      }
      if (isSigningError(err, "access_key_not_found") || isSigningError(err, "no_local_key")) {
        void refreshKey();
        toast.error("Posting isn't enabled", { description: errorMessage(err) });
        return;
      }
      if (isSigningError(err, "confirm_timeout")) {
        toast(errorMessage(err));
        return;
      }
      toast.error(what, { description: errorMessage(err) });
    },
    [router, refreshKey],
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Coalesced edges (like / repost / follow)                                                   */
/* ------------------------------------------------------------------------------------------ */

interface EdgeState {
  confirmed: boolean;
  desired: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const edges = new Map<string, EdgeState>();
const COALESCE_MS = 400;

function scheduleEdge(opts: {
  id: string;
  current: boolean;
  next: boolean;
  apply: (on: boolean) => void;
  send: (on: boolean) => Promise<string>;
  onError: (err: unknown) => void;
}) {
  const { id, current, next, apply, send, onError } = opts;
  let st = edges.get(id);
  if (!st) {
    st = { confirmed: current, desired: current, timer: null };
    edges.set(id, st);
  }
  const state = st;
  state.desired = next;
  apply(next);
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    if (state.desired === state.confirmed) {
      edges.delete(id);
      return;
    }
    const target = state.desired;
    const previous = state.confirmed;
    state.confirmed = target;
    send(target)
      .then((hash) => confirmTx(hash))
      .then(() => {
        if (!state.timer && state.desired === state.confirmed && edges.get(id) === state) {
          edges.delete(id);
        }
      })
      .catch((err) => {
        if (isSigningError(err, "confirm_timeout")) return; // sent; the indexer is just slow
        state.confirmed = previous;
        if (!state.timer) {
          state.desired = previous;
          apply(previous);
          edges.delete(id);
        }
        onError(err);
      });
  }, COALESCE_MS);
}

function setLikedFlag(p: Post, on: boolean): Post {
  const liked = p.viewer?.liked ?? false;
  if (liked === on) return p;
  return {
    ...p,
    viewer: { liked: on, reposted: p.viewer?.reposted ?? false },
    counts: { ...p.counts, likes: Math.max(0, p.counts.likes + (on ? 1 : -1)) },
  };
}

function setRepostedFlag(p: Post, on: boolean): Post {
  const reposted = p.viewer?.reposted ?? false;
  if (reposted === on) return p;
  return {
    ...p,
    viewer: { liked: p.viewer?.liked ?? false, reposted: on },
    counts: { ...p.counts, reposts: Math.max(0, p.counts.reposts + (on ? 1 : -1)) },
  };
}

export function useLikeToggle() {
  const qc = useQueryClient();
  const { accountId, requireKey } = useAccount();
  const onError = useWriteErrorHandler();
  return React.useCallback(
    (post: Post) => {
      if (!requireKey() || !accountId) return;
      const current = post.viewer?.liked ?? false;
      scheduleEdge({
        id: `${accountId}:like:${post.key}`,
        current,
        next: !current,
        apply: (on) => patchPostEverywhere(qc, post.key, (p) => setLikedFlag(p, on)),
        send: (on) => setLike(accountId, post.key, on),
        onError: (err) => onError(err, current ? "Couldn't unlike" : "Couldn't like"),
      });
    },
    [qc, accountId, requireKey, onError],
  );
}

export function useRepostToggle() {
  const qc = useQueryClient();
  const { accountId, requireKey } = useAccount();
  const onError = useWriteErrorHandler();
  return React.useCallback(
    (post: Post) => {
      if (!requireKey() || !accountId) return;
      const current = post.viewer?.reposted ?? false;
      scheduleEdge({
        id: `${accountId}:repost:${post.key}`,
        current,
        next: !current,
        apply: (on) => patchPostEverywhere(qc, post.key, (p) => setRepostedFlag(p, on)),
        send: (on) => setRepost(accountId, post.key, on),
        onError: (err) => onError(err, current ? "Couldn't undo repost" : "Couldn't repost"),
      });
    },
    [qc, accountId, requireKey, onError],
  );
}

export function useFollowToggle() {
  const qc = useQueryClient();
  const { accountId, requireKey } = useAccount();
  const onError = useWriteErrorHandler();
  return React.useCallback(
    (target: string, currentlyFollowing: boolean) => {
      if (!requireKey() || !accountId || target === accountId) return;
      scheduleEdge({
        id: `${accountId}:follow:${target}`,
        current: currentlyFollowing,
        next: !currentlyFollowing,
        apply: (on) => patchFollowEverywhere(qc, accountId, target, on),
        send: (on) => setFollow(accountId, target, on),
        onError: (err) =>
          onError(err, currentlyFollowing ? "Couldn't unfollow" : "Couldn't follow"),
      });
    },
    [qc, accountId, requireKey, onError],
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Posts                                                                                      */
/* ------------------------------------------------------------------------------------------ */

function authorSummary(qc: QueryClient, accountId: string): AccountSummary {
  const profiles = qc.getQueriesData<Profile>({ queryKey: qk.profiles });
  for (const [, p] of profiles) {
    if (p && p.account_id === accountId) {
      return { account_id: accountId, name: p.name, avatar_url: p.avatar_url };
    }
  }
  return { account_id: accountId, name: null, avatar_url: null };
}

function toPostMedia(media: MediaValue[] | undefined): PostMedia[] {
  return (media ?? []).map((m) => ({
    src: m.src,
    url: fastfsToHttps(m.src, env.fastfsGateway) ?? "",
    mime: m.mime,
    w: m.w ?? null,
    h: m.h ?? null,
    alt: m.alt ?? null,
  }));
}

export interface ComposeInput {
  text: string;
  media: MediaValue[];
  replyTo: Post | null;
  quote: Post | null;
  /** A channel account to post to instead of `social` (docs/LEGION.md §3). */
  channel?: string | null;
}

async function fetchConfirmedPost(key: string, viewer: string): Promise<Post | null> {
  try {
    const { items } = await api.postsBatch([key], viewer);
    return items[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Creates a post (or reply / quote). The pending post appears immediately at the top of the
 * relevant feeds and is replaced by the indexed version once `/v1/tx` confirms it.
 * Resolves once the transaction is included (the composer can close then).
 */
export function useCreatePost() {
  const qc = useQueryClient();
  const { accountId } = useAccount();
  const onError = useWriteErrorHandler();

  return React.useCallback(
    async (input: ComposeInput): Promise<string> => {
      if (!accountId) throw new Error("Sign in to post.");
      const a = accountId;
      const newInput: NewPostInput = {
        text: input.text,
        media: input.media,
        replyTo: input.replyTo ? { key: input.replyTo.key, root: input.replyTo.root } : null,
        quote: input.quote?.key ?? null,
      };
      const { validateKvArgs, writeKv } = await loadKv();
      const postId = nextPostId(a);
      const data = buildCreatePost(postId, newInput);
      validateKvArgs(data, a); // throws before anything is shown or sent
      const key = `${a}/${postId}`;
      const value = data[keys.post(postId)] as PostValue;
      const feed = writeFeed(input.channel);

      const pending: Post = {
        key,
        id: postId,
        author: authorSummary(qc, a),
        text: value.text ?? "",
        media: toPostMedia(value.media),
        created_at: Date.now(),
        block_height: 0,
        edited_at: null,
        reply_to: input.replyTo
          ? { key: input.replyTo.key, author: input.replyTo.author }
          : null,
        root: value.root ?? null,
        quote: input.quote ? { ...input.quote, quote: null } : null,
        mentions: extractMentions(value.text ?? ""),
        hashtags: extractHashtags(value.text ?? ""),
        counts: { replies: 0, reposts: 0, likes: 0, quotes: 0 },
        viewer: { liked: false, reposted: false },
        channel: feed,
        _pending: true,
      };
      const item: FeedItem = {
        type: "post",
        post: pending,
        reposted_by: null,
        reposted_at: null,
        cursor: `pending-${postId}`,
      };

      const feeds: FeedSpec[] = input.replyTo
        ? [
            { kind: "replies", postKey: input.replyTo.key },
            { kind: "account", tab: "replies", account: a },
          ]
        : feed
          ? [
              { kind: "channel", channel: feed },
              { kind: "account", tab: "posts", account: a },
            ]
          : [
              // For you starts with your own and followed posts, so a new post belongs on top.
              { kind: "for_you" },
              { kind: "following", account: a },
              { kind: "global" },
              { kind: "account", tab: "posts", account: a },
            ];
      if (!input.replyTo && pending.media.length > 0) {
        feeds.push({ kind: "account", tab: "media", account: a });
      }
      for (const spec of feeds) prependToFeed(qc, spec, a, item);
      if (input.replyTo) {
        patchPostEverywhere(qc, input.replyTo.key, (p) => ({
          ...p,
          counts: { ...p.counts, replies: p.counts.replies + 1 },
        }));
      }
      if (input.quote) {
        patchPostEverywhere(qc, input.quote.key, (p) => ({
          ...p,
          counts: { ...p.counts, quotes: p.counts.quotes + 1 },
        }));
      }

      const rollback = () => {
        removePostEverywhere(qc, key);
        if (input.replyTo) {
          patchPostEverywhere(qc, input.replyTo.key, (p) => ({
            ...p,
            counts: { ...p.counts, replies: Math.max(0, p.counts.replies - 1) },
          }));
        }
        if (input.quote) {
          patchPostEverywhere(qc, input.quote.key, (p) => ({
            ...p,
            counts: { ...p.counts, quotes: Math.max(0, p.counts.quotes - 1) },
          }));
        }
      };

      let hash: string;
      try {
        hash = await writeKv(a, data, { channel: feed });
      } catch (err) {
        rollback();
        throw err;
      }

      void confirmTx(hash)
        .then(async () => {
          const real = await fetchConfirmedPost(key, a);
          if (real) {
            replaceFeedPost(qc, key, real);
            patchPostEverywhere(qc, key, () => real);
          } else {
            patchPostEverywhere(qc, key, (p) => ({ ...p, _pending: false }));
          }
        })
        .catch((err) => {
          if (isSigningError(err, "confirm_timeout")) {
            patchPostEverywhere(qc, key, (p) => ({ ...p, _pending: false }));
            return;
          }
          rollback();
          onError(err, "Your post wasn't accepted");
        });

      return key;
    },
    [qc, accountId, onError],
  );
}

/** Edits a post: writes the full new value to the same key. */
export function useEditPost() {
  const qc = useQueryClient();
  const { accountId } = useAccount();
  const onError = useWriteErrorHandler();
  return React.useCallback(
    async (post: Post, text: string, media: MediaValue[]) => {
      if (!accountId || post.author.account_id !== accountId) throw new Error("Not your post.");
      const value = buildPostValue({
        text,
        media,
        replyTo: post.reply_to ? { key: post.reply_to.key, root: post.root } : null,
        quote: post.quote?.key ?? null,
      });
      const data = { [keys.post(post.id)]: value };
      const { validateKvArgs, writeKv } = await loadKv();
      validateKvArgs(data, accountId);
      const before = post;
      patchPostEverywhere(qc, post.key, (p) => ({
        ...p,
        text: value.text ?? "",
        media: toPostMedia(value.media),
        mentions: extractMentions(value.text ?? ""),
        hashtags: extractHashtags(value.text ?? ""),
        edited_at: Date.now(),
        // Keep the link preview only while its URL is still in the text.
        link: p.link && (value.text ?? "").includes(p.link.url) ? p.link : undefined,
      }));
      const restore = (p: Post): Post => ({
        ...p,
        text: before.text,
        media: before.media,
        edited_at: before.edited_at,
        link: before.link,
      });
      let hash: string;
      try {
        hash = await writeKv(accountId, data, { channel: ownFeed(post.channel) });
      } catch (err) {
        patchPostEverywhere(qc, post.key, restore);
        throw err;
      }
      void confirmTx(hash).catch((err) => {
        if (isSigningError(err, "confirm_timeout")) return;
        patchPostEverywhere(qc, post.key, restore);
        onError(err, "Your edit wasn't accepted");
      });
    },
    [qc, accountId, onError],
  );
}

/** Deletes a post (tombstone + reply backlink). */
export function useDeletePost() {
  const qc = useQueryClient();
  const { accountId, requireKey } = useAccount();
  const onError = useWriteErrorHandler();
  return React.useCallback(
    async (post: Post) => {
      if (!requireKey() || !accountId || post.author.account_id !== accountId) return;
      const data = buildDeletePost(post.id, post.reply_to?.key);
      removePostEverywhere(qc, post.key);
      if (post.reply_to) {
        patchPostEverywhere(qc, post.reply_to.key, (p) => ({
          ...p,
          counts: { ...p.counts, replies: Math.max(0, p.counts.replies - 1) },
        }));
      }
      try {
        const { writeKv } = await loadKv();
        const hash = await writeKv(accountId, data, { channel: ownFeed(post.channel) });
        toast.success("Post deleted", {
          description: "Earlier versions stay in the public FastData history.",
        });
        await confirmTx(hash);
      } catch (err) {
        if (isSigningError(err, "confirm_timeout")) return;
        void qc.invalidateQueries({ queryKey: qk.feeds });
        void qc.invalidateQueries({ queryKey: qk.threads });
        onError(err, "Couldn't delete the post");
      }
    },
    [qc, accountId, requireKey, onError],
  );
}

/** Updates flat `profile/*` keys; resolves once confirmed by the indexer. */
export function useUpdateProfile() {
  const qc = useQueryClient();
  const { accountId } = useAccount();
  return React.useCallback(
    async (fields: ProfileFieldsInput, links?: Record<string, string | null>) => {
      if (!accountId) throw new Error("Sign in first.");
      const hash = await sendProfileUpdate(accountId, fields, links);
      try {
        await confirmTx(hash);
      } finally {
        void qc.invalidateQueries({ queryKey: qk.profiles });
      }
      return hash;
    },
    [qc, accountId],
  );
}
