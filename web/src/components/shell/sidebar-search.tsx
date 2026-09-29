"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchBox({
  defaultValue = "",
  autoFocus,
  className,
  onSearch,
}: {
  defaultValue?: string;
  autoFocus?: boolean;
  className?: string;
  onSearch?: (q: string) => void;
}) {
  const router = useRouter();
  const [q, setQ] = React.useState(defaultValue);
  return (
    <form
      role="search"
      className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const value = q.trim();
        if (!value) return;
        if (onSearch) onSearch(value);
        else {
          const isTag = value.startsWith("#") && value.length > 1;
          router.push(
            isTag
              ? `/hashtag/${encodeURIComponent(value.slice(1).toLowerCase())}`
              : `/search?q=${encodeURIComponent(value)}`,
          );
        }
      }}
    >
      <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search near.social"
        aria-label="Search"
        className="h-11 w-full rounded-full border border-transparent bg-muted pl-11 pr-4 text-[15px] outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:bg-background"
      />
    </form>
  );
}
