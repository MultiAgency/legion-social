import { cn } from "@/lib/utils";

/** The Legion knot: interlaced bars on a dark tile, drawn on a 32 × 32 grid. */
export const LEGION_KNOT = "M5.00 5.34h6.48v1.28h-6.48zM15.32 5.34h6.40v1.28h-6.40zM5.00 6.62h1.28v4.95h-1.28zM10.20 6.62h1.28v8.02h-1.28zM15.32 6.62h1.28v2.98h-1.28zM20.43 6.62h1.28v8.02h-1.28zM6.28 10.29h3.16v1.28h-3.16zM12.16 10.29h7.59v1.28h-7.59zM22.48 10.29h4.52v1.28h-4.52zM25.72 11.57h1.28v5.03h-1.28zM15.32 12.25h1.28v7.42h-1.28zM5.00 15.32h9.64v1.28h-9.64zM17.36 15.32h8.36v1.28h-8.36zM5.00 16.60h1.28v5.03h-1.28zM10.20 17.28h1.28v9.38h-1.28zM20.43 17.28h1.28v9.38h-1.28zM6.28 20.35h3.16v1.28h-3.16zM12.16 20.35h7.59v1.28h-7.59zM22.48 20.35h4.52v1.28h-4.52zM25.72 21.63h1.28v5.03h-1.28zM15.32 22.31h1.28v4.35h-1.28zM11.48 25.38h3.84v1.28h-3.84zM21.71 25.38h4.01v1.28h-4.01z";

/** The site mark when `NEXT_PUBLIC_SITE_MARK` is "legion" (see BrandMark). */
export function LegionMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <rect width="32" height="32" rx="9" fill="#0f1a14" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="#82f399" strokeOpacity="0.25" />
      <path d={LEGION_KNOT} fill="#82f399" />
    </svg>
  );
}

/** The same mark as a standalone SVG document, for the browser tab icon. */
export const LEGION_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#0f1a14"/><rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="#82f399" stroke-opacity="0.25"/><path d="${LEGION_KNOT}" fill="#82f399"/></svg>`;
