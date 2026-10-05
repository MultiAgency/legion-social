"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface OrderOption {
  href: string;
  label: string;
  active: boolean;
}

/**
 * How Everyone is ordered (For you / Following / Latest): small muted pills under the feed tabs, in
 * upstream's quiet pill style (like the sidebar search), so the feed reads as the main choice and
 * the order as a refinement.
 */
export function FeedOrder({ options, onActiveClick }: { options: OrderOption[]; onActiveClick: () => void }) {
  return (
    <nav aria-label="Order" className="flex gap-1.5 px-4 pb-3 pt-2.5">
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          replace
          scroll={false}
          aria-current={o.active ? "page" : undefined}
          onClick={(e) => {
            if (!o.active || e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            onActiveClick();
          }}
          className={cn(
            "rounded-full px-3 py-1 text-sm font-medium transition-colors",
            o.active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
