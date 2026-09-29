"use client";

import * as React from "react";
import { Spinner } from "./states";

/** Calls `onVisible` when scrolled near the end of a list. */
export function InfiniteSentinel({
  onVisible,
  loading,
  hasMore,
}: {
  onVisible: () => void;
  loading: boolean;
  hasMore: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const cb = React.useRef(onVisible);
  React.useEffect(() => {
    cb.current = onVisible;
  });
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore]);
  if (!hasMore) return null;
  return <div ref={ref}>{loading ? <Spinner /> : <div className="h-12" />}</div>;
}
