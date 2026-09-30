/**
 * One player at a time. A capture-phase `play` listener on the document (media events don't
 * bubble) pauses every other playing <audio>/<video> and fires `ns:media-play` on window, so an
 * open YouTube iframe, which can't be paused from here, goes back to its thumbnail. Muted media
 * (silent autoplaying clips) is left alone. Browser only.
 */

/** Window event fired when something starts playing. `detail` identifies who started. */
export const MEDIA_PLAY_EVENT = "ns:media-play";

let installed = false;

function pauseOthers(keep?: unknown): void {
  for (const el of document.querySelectorAll<HTMLMediaElement>("audio, video")) {
    if (el !== keep && !el.paused && !el.muted) el.pause();
  }
}

function announce(source: unknown): void {
  window.dispatchEvent(new CustomEvent(MEDIA_PLAY_EVENT, { detail: source }));
}

/** Installs the document listener once. Safe to call repeatedly (and during SSR: no-op). */
export function installPlaybackCoordinator(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener(
    "play",
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLMediaElement) || el.muted) return;
      pauseOthers(el);
      announce(el);
    },
    true,
  );
}

/**
 * For players the listener can't see (iframes): pauses every native player and tells other
 * embeds to stop. `source` comes back as the event's `detail`, so the caller can ignore its own.
 */
export function pauseAllMedia(source?: unknown): void {
  if (typeof document === "undefined") return;
  pauseOthers();
  announce(source);
}
