import { cn } from "@/lib/utils";

/** The near.social mark: an arch ("n") with a dot, on a mint tile. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M10 23.5V14.5a6 6 0 0 1 12 0v9"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <circle cx="23.2" cy="9" r="2.2" className="fill-primary-foreground" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-xl font-bold tracking-tight", className)}>
      near<span className="text-link">.social</span>
    </span>
  );
}
