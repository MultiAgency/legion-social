"use client";

import * as React from "react";
import { fullTime, relativeTime } from "@/lib/time";

/** Relative time that refreshes every minute. Server and client may differ by a few seconds. */
export function RelativeTime({ ms, className }: { ms: number; className?: string }) {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return (
    <time
      dateTime={new Date(ms).toISOString()}
      title={fullTime(ms)}
      className={className}
      suppressHydrationWarning
    >
      {relativeTime(ms, now ?? undefined)}
    </time>
  );
}
