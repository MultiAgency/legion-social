const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const monthDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const monthDayYear = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const full = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const monthYear = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });

/** Twitter-style short relative time: "now", "5m", "3h", "Sep 2", "Sep 2, 2024". */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < MINUTE) return diff < 10_000 ? "now" : `${Math.max(1, Math.floor(diff / 1000))}s`;
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  const d = new Date(ms);
  return d.getFullYear() === new Date(now).getFullYear() ? monthDay.format(d) : monthDayYear.format(d);
}

/** "3:04 PM · Sep 2, 2025" */
export function fullTime(ms: number): string {
  const parts = full.formatToParts(new Date(ms));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod")} · ${get("month")} ${get("day")}, ${get("year")}`;
}

export function joinedDate(ms: number): string {
  return monthYear.format(new Date(ms));
}
