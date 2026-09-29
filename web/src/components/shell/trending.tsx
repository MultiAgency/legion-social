import Link from "next/link";
import { api } from "@/lib/api/client";
import type { TrendingTag } from "@/lib/api/types";
import { formatCount, pluralize } from "@/lib/utils";
import { SidebarCard } from "./sidebar-card";

export async function Trending() {
  let items: TrendingTag[] | null = null;
  try {
    items = (await api.trending()).items;
  } catch {
    items = null;
  }
  return (
    <SidebarCard title="Trending">
      {items === null ? (
        <p className="px-4 pb-4 pt-2 text-[15px] text-muted-foreground">Trends are unavailable right now.</p>
      ) : items.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-[15px] text-muted-foreground">
          No hashtags in the last 24 hours. Start one!
        </p>
      ) : (
        <ol className="pb-2">
          {items.map((t, i) => (
            <li key={t.tag}>
              <Link prefetch={false}
                href={`/hashtag/${encodeURIComponent(t.tag)}`}
                className="block px-4 py-2.5 transition-colors hover:bg-accent/60"
              >
                <span className="block text-[13px] text-muted-foreground">{i + 1} · Trending</span>
                <span className="block truncate text-[15px] font-bold">#{t.tag}</span>
                <span className="block text-[13px] text-muted-foreground">
                  {formatCount(t.count)} {pluralize(t.count, "post")}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </SidebarCard>
  );
}
