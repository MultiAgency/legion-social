import { siteMark } from "@/lib/brand";
import { LEGION_ICON_SVG } from "@/components/legion/legion-mark";

// The browser tab icon follows the site mark (`NEXT_PUBLIC_SITE_MARK`). Upstream's is the static
// app/icon.svg this replaces; its SVG is kept here unchanged.
const UPSTREAM_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#2ee6a8"/><path d="M10 23.5V14.5a6 6 0 0 1 12 0v9" fill="none" stroke="#0c1512" stroke-width="3.6" stroke-linecap="round"/><circle cx="23.2" cy="9" r="2.2" fill="#0c1512"/></svg>`;

export const contentType = "image/svg+xml";

export default function Icon() {
  return new Response(siteMark === "legion" ? LEGION_ICON_SVG : UPSTREAM_ICON_SVG, {
    headers: { "content-type": contentType },
  });
}
