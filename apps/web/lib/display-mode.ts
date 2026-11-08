/**
 * Whether the page runs as the installed app (standalone display). The browser knows; the
 * server learns it from DISPLAY_MODE_COOKIE, which the app sets while running standalone, so a
 * sign-up made there (OAuth callbacks included) can be counted as one.
 */
export const DISPLAY_MODE_COOKIE = "display_mode";

export function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Marks this browser session as standalone for 30 minutes; a no-op in a browser tab. */
export function rememberStandalone(): void {
  if (!isStandaloneDisplay()) return;
  document.cookie = `${DISPLAY_MODE_COOKIE}=standalone; Path=/; Max-Age=1800; SameSite=Lax`;
}

/** Server side: did this request come from the installed app? */
export function standaloneFromCookies(cookieHeader: string | null | undefined): boolean {
  return (cookieHeader ?? "")
    .split(";")
    .some((part) => part.trim() === `${DISPLAY_MODE_COOKIE}=standalone`);
}
