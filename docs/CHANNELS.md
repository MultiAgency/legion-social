# Channels: social-kv/1 posts to any account (draft)

*Draft for review. Nothing here is implemented yet.*

social-kv/1 (`docs/STANDARD.md`) sends every write to one receiver account, `social`. This
extension lets a post go to **any** account instead. Each account that receives posts is a
**channel**: a feed of its own, for example a guild, a DAO or Legion members. Profiles, follows,
likes and reposts don't change: they stay on `social`.

## 1. Writing to a channel

- A **channel** is any valid NEAR account other than `social`. A post is in channel `C` when it is
  written exactly as in social-kv/1 §3.2 and §3.3, but as a `__fastdata_kv` call to receiver `C` instead
  of `social`.
- Only `post/{post_id}` and `reply/…` keys count in a channel. Every other key sent to a channel
  is ignored. Profiles, follows, likes and reposts are read from `social` only.
- Media stays on `social`: a channel post's `media` points at files uploaded to `social`
  (social-kv/1 §4), so posting with images needs no extra upload key.
- Nobody approves a channel. The receiver needs no contract and no deposit. A channel account
  SHOULD exist and have no contract, as `social` does. Choosing one owned by the community it
  serves keeps it from being taken over later.
- Writing to `C` needs a function-call access key whose receiver is `C`. A key can name only one
  receiver, so a client asks for one key per channel, the first time an account posts there.

## 2. Post identity

- A post is still referenced as `"{account_id}/{post_id}"` (social-kv/1 §2, "Post references"), whatever its
  channel. Likes, reposts, quotes and replies written to `social` can point at a channel post
  unchanged.
- An author's post IDs are unique across all channels: **the first write of `post/{post_id}`
  fixes its channel**. A later write of the same key to a different receiver is ignored. Edits
  and deletes go to the post's own channel. Clients already pick IDs from the clock, so a
  collision only happens if a client reuses an ID.
- A reply may be written to any channel. It appears in its parent's thread wherever it was
  written, and in the feed of its own channel.

## 3. Reading

- The indexer stores valid social-kv posts sent to **any** receiver, with their channel. There is
  no list of channels. The per-account daily limits (social-kv/1 §6) count across
  all channels together.
- Every post object gains `channel`: the receiver account for a channel post, `null` for a post
  on `social`.
- `GET /v1/feed/channel/{account_id}` lists a channel's posts, newest first, paged like the
  global feed (`{items, next_cursor}`).
- Channel posts don't appear in `GET /v1/feed/global` or `/v1/feed/for_you`, which stay
  `social`-only, so near.social is unchanged. They do appear in their author's profile, in threads,
  and in search.
- Read-time policy applies as everywhere else: the denylist, and on Legion Social, membership
  (`docs/LEGION.md` §1). A site decides which channels to feature. Any channel can still be read
  through its own feed.

## 4. Size

A sample of 23,940 blocks in 48 windows over 6.8 days (October 2026) found about 100
`__fastdata_kv` writes a day across every receiver, about 12 KiB a day. Only `social` carried
social-kv keys. The one other receiver seen, `dev.everything.near`, wrote an `apps` key, which
isn't social-kv, so it would be ignored. Indexing every receiver adds nothing measurable today,
and the per-account limits cap the cost of abuse.

## 5. Open questions

1. **Legion's channel account.** NEAR Legion could own one, for example a sub-account of
   `nearlegion.near`, or MultiAgency could use one of its own for a demo and move later.
2. **Channel membership.** Should a channel ever restrict who appears in it (a DAO's members, a
   token's holders)? That would be a read-time rule like Legion membership. It's out of scope for
   this draft.
3. **Upstream.** The extension is general, not Legion-specific. If it works here, it belongs in
   social-kv itself.
