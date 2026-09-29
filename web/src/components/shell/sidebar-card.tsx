import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function SidebarCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border", className)} aria-label={title}>
      <h2 className="px-4 pb-1 pt-3 text-xl font-extrabold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export function SidebarCardSkeleton({ title, rows = 4 }: { title: string; rows?: number }) {
  return (
    <SidebarCard title={title}>
      <div className="space-y-4 px-4 py-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
    </SidebarCard>
  );
}
