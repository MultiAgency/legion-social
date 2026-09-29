import { describe, expect, it } from "vitest";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { qk } from "@/lib/api/queries";
import type { FeedItem, Page, Post, ThreadResponse } from "@/lib/api/types";
import { mapPostsInData, patchFollowEverywhere, patchPostEverywhere, prependToFeed, removePostEverywhere } from "../cache";

function post(key: string, extra: Partial<Post> = {}): Post {
  const [a, id] = key.split("/");
  return {
    key,
    id,
    author: { account_id: a, name: null, avatar_url: null },
    text: "t",
    media: [],
    created_at: 1,
    block_height: 1,
    edited_at: null,
    reply_to: null,
    root: null,
    quote: null,
    mentions: [],
    hashtags: [],
    counts: { replies: 0, reposts: 0, likes: 0, quotes: 0 },
    viewer: { liked: false, reposted: false },
    ...extra,
  };
}

const item = (p: Post): FeedItem => ({ type: "post", post: p, reposted_by: null, reposted_at: null, cursor: p.id });

function feed(...posts: Post[]): InfiniteData<Page<FeedItem>> {
  return { pages: [{ items: posts.map(item), next_cursor: null }], pageParams: [null] };
}

const like = (p: Post): Post => ({ ...p, counts: { ...p.counts, likes: p.counts.likes + 1 } });

describe("mapPostsInData", () => {
  it("patches matching posts and quoted posts, keeping untouched references", () => {
    const a = post("a.near/1");
    const b = post("b.near/2", { quote: post("a.near/1") });
    const c = post("c.near/3");
    const data = feed(a, b, c);
    const next = mapPostsInData(data, "a.near/1", like);
    expect(next).not.toBe(data);
    expect(next.pages[0].items[0].post.counts.likes).toBe(1);
    expect((next.pages[0].items[1].post.quote as Post).counts.likes).toBe(1);
    expect(next.pages[0].items[2]).toBe(data.pages[0].items[2]);
    expect(mapPostsInData(data, "zzz.near/9", like)).toBe(data);
  });

  it("patches threads", () => {
    const t: ThreadResponse = { post: post("a.near/2"), ancestors: [post("a.near/1")], parent_missing: false };
    const next = mapPostsInData(t, "a.near/1", like);
    expect(next.ancestors[0].counts.likes).toBe(1);
    expect(next.post).toBe(t.post);
  });
});

describe("query cache helpers", () => {
  it("patches every cached copy and removes deleted posts", () => {
    const qc = new QueryClient();
    const p = post("a.near/1");
    qc.setQueryData(qk.feed({ kind: "global" }, null), feed(p));
    qc.setQueryData(qk.feed({ kind: "following", account: "me.near" }, "me.near"), feed(p, post("b.near/1", { quote: p })));
    qc.setQueryData(qk.thread("a.near/1", "me.near"), { post: p, ancestors: [], parent_missing: false });

    patchPostEverywhere(qc, "a.near/1", like);
    expect(qc.getQueryData<InfiniteData<Page<FeedItem>>>(qk.feed({ kind: "global" }, null))!.pages[0].items[0].post.counts.likes).toBe(1);
    expect(qc.getQueryData<ThreadResponse>(qk.thread("a.near/1", "me.near"))!.post.counts.likes).toBe(1);

    removePostEverywhere(qc, "a.near/1");
    const following = qc.getQueryData<InfiniteData<Page<FeedItem>>>(qk.feed({ kind: "following", account: "me.near" }, "me.near"))!;
    expect(following.pages[0].items).toHaveLength(1);
    expect(following.pages[0].items[0].post.quote).toEqual({ key: "a.near/1", unavailable: true });
  });

  it("prepends pending posts once", () => {
    const qc = new QueryClient();
    const spec = { kind: "global" } as const;
    qc.setQueryData(qk.feed(spec, "me.near"), feed(post("a.near/1")));
    const pending = item(post("me.near/5", { _pending: true }));
    prependToFeed(qc, spec, "me.near", pending);
    prependToFeed(qc, spec, "me.near", pending);
    const data = qc.getQueryData<InfiniteData<Page<FeedItem>>>(qk.feed(spec, "me.near"))!;
    expect(data.pages[0].items.map((i) => i.post.key)).toEqual(["me.near/5", "a.near/1"]);
  });

  it("patches follow state and counts", () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.profile("bob.near", "me.near"), {
      account_id: "bob.near",
      counts: { followers: 1, following: 0, posts: 0 },
      viewer: { following: false, followed_by: true },
    });
    qc.setQueryData(qk.profile("me.near", "me.near"), {
      account_id: "me.near",
      counts: { followers: 0, following: 3, posts: 0 },
    });
    patchFollowEverywhere(qc, "me.near", "bob.near", true);
    expect(qc.getQueryData<{ counts: { followers: number }; viewer: { following: boolean } }>(qk.profile("bob.near", "me.near"))).toMatchObject({
      counts: { followers: 2 },
      viewer: { following: true, followed_by: true },
    });
    expect(qc.getQueryData<{ counts: { following: number } }>(qk.profile("me.near", "me.near"))!.counts.following).toBe(4);
  });
});
