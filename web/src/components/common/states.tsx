import * as React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  children,
  icon,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex max-w-sm flex-col items-center px-6 py-14 text-center", className)}>
      {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
      <h2 className="text-balance text-[22px] font-extrabold leading-tight tracking-tight">{title}</h2>
      {children && <div className="mt-2 text-[15px] text-muted-foreground">{children}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message = "We couldn't reach the near.social API.",
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)} role="alert">
      <AlertTriangle className="size-6 text-muted-foreground" />
      <div>
        <p className="font-bold">{title}</p>
        <p className="mt-1 text-[15px] text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw />
          Try again
        </Button>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn("flex justify-center py-6", className)} aria-label="Loading">
      <span className="size-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
    </div>
  );
}
