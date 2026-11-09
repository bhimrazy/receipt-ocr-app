import { SIGNED_IN_HINT_COOKIE } from "./signed-in-hint";

/**
 * Whether the page runs as the installed app (standalone display). The browser knows; the
 * server learns it from DISPLAY_MODE_COOKIE, which the app sets while running standalone, so a
 * sign-up made there (OAuth callbacks included) can be counted as one.
 */
export const DISPLAY_MODE_COOKIE = "display_mode";

/** Set on <html> by DISPLAY_MODE_SCRIPT in the installed app; the `standalone:` CSS variant reads it. */
export const DISPLAY_MODE_ATTR = "data-display-mode";

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

/**
 * Where the installed app goes instead of the landing page. A stale sign-in hint is harmless:
 * proxy.ts sends a signed-out /app visit on to /sign-in.
 */
export function standaloneHome(signedInHint: boolean): "/app" | "/sign-in" {
  return signedInHint ? "/app" : "/sign-in";
}

/** Where sign-out lands: sign-in in the installed app, the landing page in a browser tab. */
export function signedOutPath(): "/" | "/sign-in" {
  return isStandaloneDisplay() ? "/sign-in" : "/";
}

/**
 * Runs in <head> before the first paint. In the installed app it sets DISPLAY_MODE_ATTR and, on
 * `/`, replaces the page with standaloneHome() before the landing page can show. Detection is per
 * window (the display-mode query, or `navigator.standalone` on older iOS), never a cookie: Chrome
 * shares cookies between the installed app and its browser tabs, so a cookie would redirect the
 * website too. Client-side navigations to `/` are handled by StandaloneHome.
 */
export const DISPLAY_MODE_SCRIPT = `(function(){try{if(!(matchMedia("(display-mode: standalone)").matches||navigator.standalone===true))return;document.documentElement.setAttribute(${JSON.stringify(DISPLAY_MODE_ATTR)},"standalone");if(location.pathname==="/")location.replace(document.cookie.split("; ").indexOf(${JSON.stringify(`${SIGNED_IN_HINT_COOKIE}=1`)})>=0?${JSON.stringify(standaloneHome(true))}:${JSON.stringify(standaloneHome(false))})}catch(e){}})()`;
