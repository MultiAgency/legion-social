"use client";

/**
 * Shared `/v1/stream` (SSE) connection. Components subscribe to block events; if SSE isn't
 * available or keeps failing, subscribers get a periodic "tick" instead (polling fallback).
 */
import { streamUrl } from "@/lib/api/client";
import type { StreamBlockEvent } from "@/lib/api/types";

type Listener = (event: StreamBlockEvent | null) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let failures = 0;

const POLL_MS = 30_000;
const MAX_FAILURES = 3;

function emit(event: StreamBlockEvent | null) {
  for (const l of listeners) l(event);
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") emit(null);
  }, POLL_MS);
}

function connect() {
  if (source || typeof window === "undefined") return;
  if (typeof EventSource === "undefined") {
    startPolling();
    return;
  }
  try {
    source = new EventSource(streamUrl());
  } catch {
    startPolling();
    return;
  }
  source.addEventListener("open", () => {
    failures = 0;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });
  source.addEventListener("block", (e) => {
    try {
      emit(JSON.parse((e as MessageEvent<string>).data) as StreamBlockEvent);
    } catch {
      /* malformed event */
    }
  });
  source.addEventListener("error", () => {
    failures++;
    if (failures >= MAX_FAILURES) {
      source?.close();
      source = null;
      startPolling();
      // Try SSE again later.
      setTimeout(() => {
        failures = 0;
        if (listeners.size > 0) connect();
      }, 5 * 60_000);
    }
  });
}

function disconnect() {
  source?.close();
  source = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/** Subscribes to new-block events (`null` = polling tick). Returns an unsubscribe function. */
export function subscribeStream(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) disconnect();
  };
}
