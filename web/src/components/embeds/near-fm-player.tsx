"use client";

import * as React from "react";
import Image from "next/image";
import { Loader2, Music, Pause, Play, RotateCcw } from "lucide-react";
import type { NearFmPreview } from "@/lib/api/types";
import { isGatewayUrl } from "@/components/account/user-avatar";
import { formatDuration, linkHost } from "@/lib/social/links";
import { cn } from "@/lib/utils";

type PlayerState = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

const stop = (e: React.MouseEvent) => e.stopPropagation();
const external = { target: "_blank", rel: "nofollow ugc noopener noreferrer", onClick: stop } as const;

/** The audio element whose song the OS media controls (lock screen, media keys) show. */
let sessionOwner: HTMLAudioElement | null = null;

function claimMediaSession(audio: HTMLAudioElement, song: NearFmPreview): void {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
  const session = navigator.mediaSession;
  sessionOwner = audio;
  session.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist,
    album: "near.fm",
    artwork: song.cover ? [{ src: song.cover }] : [],
  });
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => void audio.play().catch(() => {})],
    ["pause", () => audio.pause()],
    [
      "seekto",
      (d) => {
        if (d.seekTime != null) audio.currentTime = d.seekTime;
      },
    ],
  ];
  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      /* action not supported by this browser */
    }
  }
}

function releaseMediaSession(audio: HTMLAudioElement): void {
  if (sessionOwner !== audio || !("mediaSession" in navigator)) return;
  sessionOwner = null;
  navigator.mediaSession.metadata = null;
  for (const action of ["play", "pause", "seekto"] as const) {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      /* not supported */
    }
  }
}

/**
 * A near.fm song played natively (no iframe): the audio streams from FastFS only once the
 * viewer presses play, since near.fm already gave us the duration.
 */
export function NearFmPlayer({
  url,
  song,
  className,
}: {
  url: string;
  song: NearFmPreview;
  className?: string;
}) {
  const audio = React.useRef<HTMLAudioElement>(null);
  const [state, setState] = React.useState<PlayerState>("idle");
  const [time, setTime] = React.useState(0);
  const [duration, setDuration] = React.useState(song.duration ?? 0);
  // While the seek bar is dragged it shows this value and ignores timeupdate.
  const [scrub, setScrub] = React.useState<number | null>(null);
  const dragging = React.useRef(false);
  // A seek before anything loaded, applied once the metadata arrives.
  const pendingSeek = React.useRef<number | null>(null);
  const [coverFailed, setCoverFailed] = React.useState(false);
  const cover = !coverFailed && isGatewayUrl(song.cover) ? song.cover : null;

  React.useEffect(() => {
    const el = audio.current;
    return () => {
      if (el) releaseMediaSession(el);
    };
  }, []);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    setState("loading");
    el.play().catch((err: unknown) => {
      // Paused again before it started.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setState("error");
    });
  };

  const seek = (to: number) => {
    const el = audio.current;
    setTime(to);
    setState((s) => (s === "ended" ? "paused" : s));
    if (!el) return;
    if (el.readyState === HTMLMediaElement.HAVE_NOTHING) pendingSeek.current = to;
    else el.currentTime = to;
  };

  // Seek once the drag ends, wherever the pointer is released.
  const startDrag = (e: React.PointerEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    dragging.current = true;
    const end = () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      dragging.current = false;
      seek(input.valueAsNumber);
      setScrub(null);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const position = Math.min(scrub ?? time, duration || 0);
  const busy = state === "loading" || state === "playing";

  return (
    <div className={cn("flex gap-3 rounded-2xl border p-3", className)} onClick={stop}>
      <div className="relative size-[88px] shrink-0 overflow-hidden rounded-xl bg-muted">
        {cover ? (
          <Image
            src={cover}
            alt=""
            fill
            sizes="88px"
            className="object-cover"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <span className="grid size-full place-items-center text-muted-foreground" aria-hidden>
            <Music className="size-8" />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2 text-[15px] leading-5">
          <div className="min-w-0">
            <a href={url} {...external} className="block truncate font-bold hover:underline">
              {song.title}
            </a>
            {song.artist_url ? (
              <a href={song.artist_url} {...external} className="block truncate text-muted-foreground hover:underline">
                {song.artist}
              </a>
            ) : (
              <div className="truncate text-muted-foreground">{song.artist}</div>
            )}
          </div>
          <span className="shrink-0 text-[12px] font-medium text-muted-foreground">near.fm</span>
        </div>
        {state === "error" ? (
          <p className="mt-auto pt-2 text-[13px] text-muted-foreground">
            Can&apos;t play this song.{" "}
            <a href={url} {...external} className="text-link hover:underline">
              Open on near.fm
            </a>
          </p>
        ) : (
          <div className="mt-auto flex items-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={toggle}
              aria-label={busy ? `Pause ${song.title}` : `Play ${song.title}`}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85"
            >
              {state === "loading" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : state === "playing" ? (
                <Pause className="size-4 fill-current" />
              ) : state === "ended" ? (
                <RotateCcw className="size-4" />
              ) : (
                <Play className="ml-0.5 size-4 fill-current" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step="any"
              value={position}
              disabled={!duration}
              aria-label="Seek"
              aria-valuetext={`${formatDuration(position)} of ${formatDuration(duration)}`}
              className="min-w-0 flex-1 cursor-pointer accent-link disabled:cursor-default"
              onPointerDown={startDrag}
              onChange={(e) => {
                const to = e.currentTarget.valueAsNumber;
                if (dragging.current) setScrub(to);
                else seek(to); // keyboard
              }}
            />
            <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
              {formatDuration(position)}
              {duration > 0 && ` / ${formatDuration(duration)}`}
            </span>
          </div>
        )}
      </div>
      <audio
        ref={audio}
        src={song.audio}
        preload="none"
        onPlaying={(e) => {
          setState("playing");
          claimMediaSession(e.currentTarget, song);
        }}
        onWaiting={() => setState("loading")}
        onPause={(e) => {
          if (!e.currentTarget.ended) setState("paused");
        }}
        onEnded={() => setState("ended")}
        onError={() => setState("error")}
        onTimeUpdate={(e) => {
          if (!dragging.current) setTime(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => {
          if (pendingSeek.current === null) return;
          e.currentTarget.currentTime = pendingSeek.current;
          pendingSeek.current = null;
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
      />
    </div>
  );
}

/** A link whose target is gone, e.g. a hidden or deleted near.fm song. */
export function UnavailableEmbed({ url, className }: { url: string; className?: string }) {
  return (
    <div
      className={cn("rounded-2xl border bg-muted/40 px-4 py-3 text-[15px] text-muted-foreground", className)}
      onClick={stop}
    >
      {linkHost(url) === "near.fm"
        ? "This song is unavailable on near.fm."
        : "This link is unavailable."}
    </div>
  );
}
