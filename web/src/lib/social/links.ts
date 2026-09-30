/**
 * Link previews (`post.link`, docs/API.md). The server picks the link and unfurls it; these
 * helpers decide what the web shows in its place and build the URLs the embeds load.
 */
import type { LinkPreview, Post, PostPreviewResponse } from "@/lib/api/types";

/** near.social's image proxy. `large` is the only usable size (at most 1200 px wide). */
const IMAGE_PROXY = "https://i.near.social/large/";

/** A remote image through the proxy, so the page never loads third-party image hosts. */
export function proxiedImage(url: string): string {
  const hash = url.indexOf("#");
  return IMAGE_PROXY + (hash === -1 ? url : url.slice(0, hash));
}

/** YouTube's thumbnail for a video, through the proxy (no request to Google before a click). */
export function youtubeThumbnail(videoId: string): string {
  return proxiedImage(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`);
}

/** The embed URL loaded once the viewer clicks play. */
export function youtubeSrc(videoId: string, start?: number | null): string {
  const t = start && start > 0 ? `&start=${Math.floor(start)}` : "";
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&playsinline=1&rel=0${t}`;
}

/** The domain shown on a card: hostname without `www.` (punycode stays, so lookalikes show). */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * Drops `url` from the end of `text` when it's the last thing in it (trailing whitespace is
 * fine), like X does when a card renders in its place. When the URL appears more than once, only
 * the last occurrence counts. Otherwise the text is returned unchanged.
 */
export function hideTrailingUrl(text: string, url: string): string {
  if (!url) return text;
  const i = text.lastIndexOf(url);
  if (i === -1 || text.slice(i + url.length).trim() !== "") return text;
  return text.slice(0, i).trimEnd();
}

/** Previews that render under a post. `none` renders nothing. */
export type EmbedPreview = Extract<
  LinkPreview,
  { kind: "card" | "youtube" | "near_fm" | "unavailable" }
>;

const EMBED_KINDS: ReadonlySet<string> = new Set(["card", "youtube", "near_fm", "unavailable"]);

export interface PostLinkView {
  /** `post.text`, without the trailing URL when something renders in its place. */
  text: string;
  /** The quote to show: the on-chain quote, else a linked near.social post. */
  quote: Post["quote"];
  /** The card or embed under the post, with the URL it's for. */
  embed: { url: string; preview: EmbedPreview } | null;
}

/** Whether the post's link still needs `/preview`: it wasn't cached when the post was served. */
export function needsPreviewFetch(post: Post): boolean {
  const link = post.link;
  return !!link && !link.post && !link.preview && !post._pending;
}

/**
 * What a post shows for its link, from `post.link` or the lazily fetched preview. Nothing renders
 * while loading or for `none`; the URL only leaves the text when a linked post, card or embed
 * takes its place (never for `unavailable`, so the link stays reachable).
 */
export function resolvePostLink(
  post: Post,
  fetched?: PostPreviewResponse | null,
): PostLinkView {
  const link = post.link;
  const quote = post.quote ?? link?.post ?? null;
  if (!link) return { text: post.text, quote, embed: null };
  if (link.post) {
    return { text: post.quote ? post.text : hideTrailingUrl(post.text, link.url), quote, embed: null };
  }
  const found = link.preview ? { url: link.url, preview: link.preview } : fetched;
  // Unknown kinds (a newer server) render nothing, like `none`.
  if (!found || !EMBED_KINDS.has(found.preview.kind)) return { text: post.text, quote, embed: null };
  const embed = { url: found.url, preview: found.preview as EmbedPreview };
  const text = embed.preview.kind === "unavailable" ? post.text : hideTrailingUrl(post.text, embed.url);
  return { text, quote, embed };
}
