/**
 * Non-HttpOnly marker cookie that lets the static landing page show "Open the app" without
 * a session fetch. proxy.ts sets it on /app visits that carry a session cookie. It only
 * picks a button; a stale value just sends the visitor through /sign-in.
 */
export const SIGNED_IN_HINT_COOKIE = "signed_in_hint";

export function hasSignedInHint(): boolean {
  return document.cookie.split("; ").some((part) => part === `${SIGNED_IN_HINT_COOKIE}=1`);
}

export function clearSignedInHint(): void {
  document.cookie = `${SIGNED_IN_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
