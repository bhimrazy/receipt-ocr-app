/**
 * Non-HttpOnly marker cookie that lets the static landing page show "Open the app" without
 * a session fetch. proxy.ts sets it on /app visits that carry a session cookie. It only
 * picks a button; a stale value just sends the visitor through /sign-in.
 */
export const SIGNED_IN_HINT_COOKIE = "signed_in_hint";

/**
 * Set by proxy.ts on any signed-in /app visit and kept for a year, through sign-out: someone
 * opening the installed app (`/app?source=pwa`) signed out is sent to sign-in, not sign-up.
 */
export const HAS_ACCOUNT_COOKIE = "has_account";

/** The manifest's `start_url` carries `?source=pwa`, so launches from the home screen show. */
export const PWA_SOURCE = "pwa";

export function hasSignedInHint(): boolean {
  return document.cookie.split("; ").some((part) => part === `${SIGNED_IN_HINT_COOKIE}=1`);
}

export function clearSignedInHint(): void {
  document.cookie = `${SIGNED_IN_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** True for `/app?source=pwa` (the requested path proxy.ts hands on), the installed app's start. */
export function launchedFromPwa(requestedPath: string | null | undefined): boolean {
  if (!requestedPath) return false;
  const url = new URL(requestedPath, "http://x");
  return url.pathname === "/app" && url.searchParams.get("source") === PWA_SOURCE;
}
