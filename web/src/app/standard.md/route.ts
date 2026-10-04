import { apiUrl } from "@/lib/api/client";
import { siteName } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** Proxies `${API_INTERNAL_URL}/standard.md` as markdown. */
export async function GET() {
  try {
    const res = await fetch(apiUrl("/standard.md"), {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return new Response(`Upstream returned HTTP ${res.status}\n`, {
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(await res.text(), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "public, max-age=60, stale-while-revalidate=600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response(`The ${siteName} API is unreachable.\n`, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
