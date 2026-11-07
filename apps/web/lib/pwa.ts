const INSTALL_DISMISSED_KEY = "receiptocr.install-dismissed";

/** The signed-in app, where the service worker registers and the install prompt shows. */
export function isAppPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

/**
 * Safari on iPhone or iPad, which has no install prompt: people add the app from the Share menu.
 * iPadOS reports a Mac user agent, so touch support tells them apart. Chrome, Firefox and Edge on
 * iOS, and in-app browsers (no "Safari/" token), are left out.
 */
export function isIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  const ios =
    /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  return ios && /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(userAgent);
}

// Storage can throw (Safari private mode, blocked site data); then the prompt just shows again.
export function installDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberInstallDismissed(): void {
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
  } catch {
    // Not remembered; see above.
  }
}
