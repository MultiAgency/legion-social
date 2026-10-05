import { siteMark, siteName } from "@/lib/brand";
import { LegionMark } from "@/components/legion/legion-mark";
import { cn } from "@/lib/utils";

/** The near.social mark: an arch ("n") with a dot, on a mint tile. */
export function BrandMark({ className }: { className?: string }) {
  if (siteMark === "legion") return <LegionMark className={className} />;
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

/** The site's name (`siteName`); a dotted name like "near.social" sets its suffix in the link color. */
export function Wordmark({ className }: { className?: string }) {
  const dot = siteName.indexOf(".");
  return (
    <span className={cn("text-xl font-bold tracking-tight", className)}>
      {dot > 0 ? (
        <>
          {siteName.slice(0, dot)}
          <span className="text-link">{siteName.slice(dot)}</span>
        </>
      ) : (
        siteName
      )}
    </span>
  );
}
