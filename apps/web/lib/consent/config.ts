/**
 * Pages where analytics may run. Everything else is left out on purpose: /app and /admin titles
 * and URLs carry receipt and workspace ids, and the reset-password and invitation pages carry
 * tokens. Exact paths only; there is no pricing page yet (pricing is a section of /).
 */
const ANALYTICS_PATHS = new Set(["/", "/privacy", "/terms", "/cookies", "/sign-in", "/sign-up"]);

export function isAnalyticsPath(pathname: string): boolean {
  return ANALYTICS_PATHS.has(pathname);
}

/** Bump when the optional categories or what they do change; everyone is asked again. */
export const CONSENT_VERSION = 1;
export const CONSENT_COOKIE = "consent";
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * GA4 measurement ids look like `G-XXXXXXXXXX`. Anything else (a pasted API secret, a UA- id) is
 * refused and GA stays off.
 */
export function parseGaMeasurementId(raw: string | undefined): string | undefined {
  const id = raw?.trim();
  return id && /^G-[A-Z0-9]{4,16}$/.test(id) ? id : undefined;
}

/** Turns a URL into origin + path: query strings and fragments can carry tokens and ids. */
export function stripUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}
