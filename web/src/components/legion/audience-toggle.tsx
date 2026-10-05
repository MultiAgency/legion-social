"use client";

import { Globe } from "lucide-react";
import { legionFeed } from "@/lib/legion/feed";
import { cn } from "@/lib/utils";
import { LegionMark } from "./legion-mark";

/**
 * The Legion feed's audience (docs/LEGION.md §4.1): Members only (the `legion` feed account) or
 * Public (`social`, tagged #legion). `value` is the feed account: `null` is Public. A reply goes
 * where its parent is, so it shows that instead of a choice.
 */
export function AudienceToggle({
  value,
  onChange,
  disabled,
  reply,
}: {
  value: string | null;
  onChange: (channel: string | null) => void;
  disabled?: boolean;
  reply?: boolean;
}) {
  if (!legionFeed) return null;
  if (reply) {
    return value ? (
      <span className="ml-1 inline-flex items-center gap-1 text-xs font-medium text-link">
        <LegionMark className="size-3.5 rounded-[3px]" />
        Replying to members only
      </span>
    ) : null;
  }
  const options = [
    { channel: legionFeed, label: "Members only", note: "Stays off near.social." },
    { channel: null, label: "Public", note: "Also on near.social, with #legion." },
  ];
  const note = options.find((o) => o.channel === value)?.note;
  return (
    <div className="ml-1 flex min-w-0 items-center gap-2">
      <div role="radiogroup" aria-label="Audience" className="flex flex-none items-center rounded-full border p-0.5">
        {options.map(({ channel, label }) => {
          const active = value === channel;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(channel)}
              className={cn(
                "flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-40",
                active ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {channel ? <LegionMark className="size-3.5 rounded-[3px]" /> : <Globe className="size-3.5" aria-hidden />}
              {label}
            </button>
          );
        })}
      </div>
      <span className="hidden truncate text-xs text-muted-foreground sm:inline">{note}</span>
    </div>
  );
}
