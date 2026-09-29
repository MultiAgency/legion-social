/** Cookie that tells server components who is viewing (personalisation hint, not a credential). */
export const VIEWER_COOKIE = "ns_viewer";

export function setViewerCookie(accountId: string | null): void {
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  if (accountId) {
    document.cookie = `${VIEWER_COOKIE}=${encodeURIComponent(accountId)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } else {
    document.cookie = `${VIEWER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  }
}

export function readViewerCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)ns_viewer=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}
