import { LIMITS } from "@/lib/social/standard";

const HANDLE_RE = /^@?([A-Za-z0-9_.-]{1,100})$/;

const TEMPLATES: Record<string, (h: string) => string> = {
  x: (h) => `https://x.com/${h}`,
  twitter: (h) => `https://x.com/${h}`,
  github: (h) => `https://github.com/${h}`,
  telegram: (h) => `https://t.me/${h}`,
  bluesky: (h) => `https://bsky.app/profile/${h}`,
  farcaster: (h) => `https://warpcast.com/${h}`,
  youtube: (h) => `https://youtube.com/@${h}`,
  instagram: (h) => `https://instagram.com/${h}`,
  linkedin: (h) => `https://linkedin.com/in/${h}`,
};

export const SERVICE_LABELS: Record<string, string> = {
  website: "Website",
  x: "X",
  github: "GitHub",
  telegram: "Telegram",
  discord: "Discord",
  bluesky: "Bluesky",
  farcaster: "Farcaster",
  youtube: "YouTube",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

export interface ResolvedLink {
  service: string;
  label: string;
  /** Display text. */
  text: string;
  /** Safe https URL, or null when the value is just a handle we can't link. */
  href: string | null;
}

function safeHttps(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Turns `profile/links/*` values into display text + a safe https link where possible. */
export function resolveLink(service: string, raw: string): ResolvedLink {
  const value = raw.trim();
  const label = SERVICE_LABELS[service] ?? service;
  if (/^https:\/\//i.test(value)) {
    const href = safeHttps(value);
    return {
      service,
      label,
      text: value.replace(/^https:\/\/(www\.)?/i, "").replace(/\/$/, ""),
      href,
    };
  }
  const m = HANDLE_RE.exec(value);
  if (m && TEMPLATES[service]) {
    return { service, label, text: `@${m[1]}`, href: TEMPLATES[service](m[1]) };
  }
  if (service === "website" && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(value)) {
    return { service, label, text: value, href: `https://${value}` };
  }
  return { service, label, text: value, href: null };
}

export function resolveLinks(links: Record<string, string>): ResolvedLink[] {
  return Object.keys(links)
    .sort()
    .slice(0, LIMITS.profileMaxLinks)
    .filter((s) => links[s])
    .map((s) => resolveLink(s, links[s]))
    .sort((a, b) => (a.service === "website" ? -1 : b.service === "website" ? 1 : 0));
}
