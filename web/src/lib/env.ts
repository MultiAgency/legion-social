/**
 * Runtime configuration. `NEXT_PUBLIC_*` values are inlined at build time, so they must be
 * referenced literally (no dynamic `process.env[name]`).
 */

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const env = {
  apiUrl: trimSlash(process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3040"),
  networkId: (process.env.NEXT_PUBLIC_NETWORK_ID || "mainnet") as "mainnet" | "testnet",
  socialAccountId: process.env.NEXT_PUBLIC_SOCIAL_ACCOUNT_ID || "social",
  rpcUrl: trimSlash(process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.fastnear.com"),
  fastfsGateway: trimSlash(process.env.NEXT_PUBLIC_FASTFS_GATEWAY || "https://main.fastfs.io"),
  keyAllowanceNear: positiveNumber(process.env.NEXT_PUBLIC_KEY_ALLOWANCE_NEAR, 1),
} as const;

/** Base URL of the read API: `API_INTERNAL_URL` on the server, `NEXT_PUBLIC_API_URL` in the browser. */
export function apiBase(): string {
  if (typeof window === "undefined") {
    return trimSlash(process.env.API_INTERNAL_URL || env.apiUrl);
  }
  return env.apiUrl;
}

/** Absolute site URL used for metadata (OG tags). */
export function siteUrl(): string {
  return trimSlash(
    process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"),
  );
}
