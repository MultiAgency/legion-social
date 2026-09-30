"use client";

import * as React from "react";
import { Play } from "lucide-react";
import type { YoutubePreview } from "@/lib/api/types";
import { MEDIA_PLAY_EVENT, pauseAllMedia } from "@/lib/media/playback";
import { youtubeSrc, youtubeThumbnail } from "@/lib/social/links";
import { cn } from "@/lib/utils";

const stop = (e: React.MouseEvent) => e.stopPropagation();

/**
 * A YouTube video behind a click-to-play facade: until clicked it's only a thumbnail through
 * i.near.social, so nothing loads from Google. Playing another video or song closes the player
 * and brings the thumbnail back.
 */
export function YoutubeEmbed({ preview, className }: { preview: YoutubePreview; className?: string }) {
  const [playing, setPlaying] = React.useState(false);
  const [thumbFailed, setThumbFailed] = React.useState(false);
  const self = React.useRef({});

  React.useEffect(() => {
    if (!playing) return;
    const onPlay = (e: Event) => {
      if ((e as CustomEvent).detail !== self.current) setPlaying(false);
    };
    window.addEventListener(MEDIA_PLAY_EVENT, onPlay);
    return () => window.removeEventListener(MEDIA_PLAY_EVENT, onPlay);
  }, [playing]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-black",
        preview.shorts ? "aspect-[9/16] w-full max-w-[300px]" : "aspect-video w-full",
        className,
      )}
      onClick={stop}
    >
      {playing ? (
        <iframe
          src={youtubeSrc(preview.video_id, preview.start)}
          title="YouTube video player"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write; web-share; accelerometer; gyroscope"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 size-full border-0"
        />
      ) : (
        <button
          type="button"
          aria-label="Play YouTube video"
          className="group absolute inset-0 size-full"
          onClick={() => {
            pauseAllMedia(self.current);
            setPlaying(true);
          }}
        >
          {!thumbFailed && (
            // The proxy serves arbitrary remote images, which next/image isn't configured for.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={youtubeThumbnail(preview.video_id)}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="absolute inset-0 size-full object-cover"
              onError={() => setThumbFailed(true)}
            />
          )}
          <span className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/70 text-white shadow-lg transition-colors group-hover:bg-black/85">
            <Play className="ml-1 size-7 fill-current" />
          </span>
        </button>
      )}
    </div>
  );
}
