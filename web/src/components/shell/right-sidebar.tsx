import { Suspense } from "react";
import Link from "next/link";
import { SearchBox } from "./sidebar-search";
import { SidebarCardSkeleton } from "./sidebar-card";
import { Trending } from "./trending";
import { WhoToFollow } from "./who-to-follow";

export function RightSidebar() {
  return (
    <div className="scrollbar-none sticky top-0 max-h-dvh space-y-4 overflow-y-auto pb-6">
      <div className="sticky top-0 z-10 bg-background pb-1 pt-1.5">
        <SearchBox />
      </div>
      <Suspense fallback={<SidebarCardSkeleton title="Trending" />}>
        <Trending />
      </Suspense>
      <Suspense fallback={<SidebarCardSkeleton title="Who to follow" rows={3} />}>
        <WhoToFollow />
      </Suspense>
      <footer className="flex flex-wrap gap-x-3 gap-y-1 px-4 text-[13px] text-muted-foreground">
        <Link href="/docs" className="hover:underline">
          The standard
        </Link>
        <a href="/skill.md" className="hover:underline">
          Agent guide
        </a>
        <a href="/standard.md" className="hover:underline">
          standard.md
        </a>
        <span>Built on NEAR FastData KV</span>
      </footer>
    </div>
  );
}
