"use client";

import { Globe, ShieldCheck } from "lucide-react";
import { legionFeed } from "@/lib/legion/feed";
import { cn } from "@/lib/utils";

/**
 * "Everyone" or "Legion only" for a new post (docs/LEGION.md §3). `value` is the channel: `null` is
 * `social`. Shows nothing when no Legion feed is configured.
 */
export function LegionFeedToggle({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (channel: string | null) => void;
  disabled?: boolean;
}) {
  if (!legionFeed) return null;
  const options = [
    { channel: null, label: "Everyone", icon: Globe },
    { channel: legionFeed, label: "Legion only", icon: ShieldCheck },
  ];
  return (
    <div role="radiogroup" aria-label="Post to" className="ml-1 flex items-center rounded-full border p-0.5">
      {options.map(({ channel, label, icon: Icon }) => {
        const active = value === channel;
        return (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(channel)}
            title={channel ? "Shows only on this site, in the Legion tab" : "Shows here and on near.social"}
            className={cn(
              "flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-40",
              active ? "bg-link/15 text-link" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
