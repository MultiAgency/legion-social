"use client";

/**
 * Tiny localStorage-backed stores for per-browser state (mutes, last-seen notifications,
 * onboarding flags), shared across components and tabs via useSyncExternalStore.
 */
import { useSyncExternalStore } from "react";

const EVENT = "ns:local-store";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

export function readLocal(key: string): string | null {
  if (typeof window === "undefined") return null;
  return read(key);
}

export function subscribeLocal(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** Raw string value of a localStorage key (null on the server and when unset). */
export function useLocalString(key: string | null): string | null {
  return useSyncExternalStore(
    subscribeLocal,
    () => (key ? read(key) : null),
    () => null,
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Mutes (local only; mutes are intentionally not part of social-kv/1 since KV is public)     */
/* ------------------------------------------------------------------------------------------ */

const MUTES_KEY = "ns:mutes";
const EMPTY: readonly string[] = Object.freeze([]);
let mutesCache: { raw: string | null; list: readonly string[] } = { raw: null, list: EMPTY };

function parseMutes(raw: string | null): readonly string[] {
  if (raw === mutesCache.raw) return mutesCache.list;
  let list: readonly string[] = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    list = EMPTY;
  }
  mutesCache = { raw, list };
  return list;
}

export function useMutes(): readonly string[] {
  const raw = useLocalString(MUTES_KEY);
  return parseMutes(raw);
}

export function setMuted(accountId: string, muted: boolean): void {
  const current = parseMutes(readLocal(MUTES_KEY));
  const next = muted
    ? Array.from(new Set([...current, accountId]))
    : current.filter((a) => a !== accountId);
  writeLocal(MUTES_KEY, JSON.stringify(next));
}

/* ------------------------------------------------------------------------------------------ */
/* Notifications last-seen and onboarding flags                                               */
/* ------------------------------------------------------------------------------------------ */

export const notifSeenKey = (account: string) => `ns:notif-seen:${account}`;
export const onboardedKey = (account: string) => `ns:onboarded:${account}`;

export function useNotifSeen(account: string | null): number {
  const raw = useLocalString(account ? notifSeenKey(account) : null);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function markNotifSeen(account: string, at: number): void {
  const prev = Number(readLocal(notifSeenKey(account)) ?? 0);
  if (at > prev) writeLocal(notifSeenKey(account), String(at));
}

export function isOnboarded(account: string): boolean {
  return readLocal(onboardedKey(account)) !== null;
}

export function setOnboarded(account: string): void {
  writeLocal(onboardedKey(account), String(Date.now()));
}

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true afterwards (no setState-in-effect needed). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
