/**
 * Plain-text tokenizer implementing STANDARD.md §5.
 *
 * Tokens are recognised in this order:
 *  1. URLs `https?://[^\s<>"]+`, with trailing `.,:;!?'")]}` removed.
 *  2. Mentions outside URLs: `(?:^|[^A-Za-z0-9_@.])@([a-z0-9][a-z0-9._-]{0,63})`; trailing `.`,
 *     `-`, `_` trimmed, then the result must be a valid account ID.
 *  3. Hashtags outside URLs: `(?:^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_]{1,64})`, containing at least
 *     one letter, normalised to lowercase.
 *
 * The output is rendered as React text nodes only; nothing here produces HTML.
 */
import { isAccountId } from "./standard";

export type Token =
  | { type: "text"; text: string }
  | { type: "url"; text: string; href: string }
  | { type: "mention"; text: string; accountId: string }
  | { type: "hashtag"; text: string; tag: string };

interface Span {
  start: number;
  end: number;
  token: Exclude<Token, { type: "text" }>;
}

const URL_RE = /https?:\/\/[^\s<>"]+/gu;
const URL_TRAILING_RE = /[.,:;!?'")\]}]+$/u;
const MENTION_RE = /(?:^|[^A-Za-z0-9_@.])@([a-z0-9][a-z0-9._-]{0,63})/gu;
const MENTION_TRAILING_RE = /[._-]+$/u;
const HASHTAG_RE = /(?:^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_]{1,64})/gu;
const LETTER_RE = /\p{L}/u;

function findUrls(text: string): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index;
    const trimmed = m[0].replace(URL_TRAILING_RE, "");
    // "https://" followed only by trimmed punctuation has no host: not a link.
    if (trimmed.length <= trimmed.indexOf("//") + 2) continue;
    spans.push({
      start,
      end: start + trimmed.length,
      token: { type: "url", text: trimmed, href: trimmed },
    });
  }
  return spans;
}

function inside(spans: Span[], index: number): boolean {
  for (const s of spans) if (index >= s.start && index < s.end) return true;
  return false;
}

function findMentions(text: string, urls: Span[]): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const captureStart = m.index + m[0].length - m[1].length;
    const at = captureStart - 1;
    if (inside(urls, at)) continue;
    const name = m[1].replace(MENTION_TRAILING_RE, "");
    if (!isAccountId(name)) continue;
    spans.push({
      start: at,
      end: captureStart + name.length,
      token: { type: "mention", text: `@${name}`, accountId: name },
    });
  }
  return spans;
}

function findHashtags(text: string, urls: Span[]): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(HASHTAG_RE)) {
    const captureStart = m.index + m[0].length - m[1].length;
    const hash = captureStart - 1;
    if (inside(urls, hash)) continue;
    const raw = m[1];
    if (!LETTER_RE.test(raw)) continue;
    spans.push({
      start: hash,
      end: captureStart + raw.length,
      token: { type: "hashtag", text: `#${raw}`, tag: raw.toLowerCase() },
    });
  }
  return spans;
}

/** Splits text into text / url / mention / hashtag tokens (STANDARD.md §5). */
export function tokenize(text: string): Token[] {
  if (!text) return [];
  const urls = findUrls(text);
  const others = [...findMentions(text, urls), ...findHashtags(text, urls)];
  const all = [...urls, ...others].sort((a, b) => a.start - b.start);

  const tokens: Token[] = [];
  let pos = 0;
  for (const span of all) {
    if (span.start < pos) continue; // defensive: never overlap
    if (span.start > pos) tokens.push({ type: "text", text: text.slice(pos, span.start) });
    tokens.push(span.token);
    pos = span.end;
  }
  if (pos < text.length) tokens.push({ type: "text", text: text.slice(pos) });
  return tokens;
}

/** Unique mentioned account IDs, in order of appearance. */
export function extractMentions(text: string): string[] {
  const out: string[] = [];
  for (const t of tokenize(text)) {
    if (t.type === "mention" && !out.includes(t.accountId)) out.push(t.accountId);
  }
  return out;
}

/** Unique lowercase hashtags, in order of appearance. */
export function extractHashtags(text: string): string[] {
  const out: string[] = [];
  for (const t of tokenize(text)) {
    if (t.type === "hashtag" && !out.includes(t.tag)) out.push(t.tag);
  }
  return out;
}

/** Validates a hashtag route segment (already decoded). Returns the lowercase tag or null. */
export function normalizeHashtag(raw: string): string | null {
  if (!/^[\p{L}\p{N}_]{1,64}$/u.test(raw) || !LETTER_RE.test(raw)) return null;
  return raw.toLowerCase();
}

/** Short display form of a URL: no scheme, no `www.`, truncated. */
export function displayUrl(href: string, max = 42): string {
  const short = href.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const chars = [...short];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : short;
}

/**
 * If the caret is right after an `@partial` mention (per the mention grammar), returns the
 * partial name and where the `@` is. Used for composer autocomplete.
 */
export function mentionQueryAt(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = /(?:^|[^A-Za-z0-9_@.])@([a-z0-9][a-z0-9._-]{0,63})?$/u.exec(before);
  if (!m) return null;
  const query = m[1] ?? "";
  return { query, start: caret - query.length - 1 };
}
