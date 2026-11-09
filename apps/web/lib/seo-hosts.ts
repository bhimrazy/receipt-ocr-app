// Dependency-free: next.config.ts imports this file.

/** The only host search engines may index. Everything else is noindex and Disallow: /. */
export const PRODUCTION_HOST = "receipt-ocr.bhimraj.com.np";
export const PRODUCTION_ORIGIN = `https://${PRODUCTION_HOST}`;

/** Host header value without port, lower-cased; the first entry when a proxy sent several. */
export function normalizeHost(raw: string | null | undefined): string {
  const first = (raw ?? "").split(",")[0]!.trim().toLowerCase();
  return first.replace(/:\d+$/, "").replace(/\.$/, "");
}

export function isProductionHost(raw: string | null | undefined): boolean {
  return normalizeHost(raw) === PRODUCTION_HOST;
}

/**
 * Host of a request. Host only, never X-Forwarded-Host: next.config's host rules match Host, and a
 * client can send any forwarded value, so both checks must read the same header.
 */
export function requestHost(headers: { get(name: string): string | null }): string {
  return headers.get("host") ?? "";
}

export const NOINDEX_VALUE = "noindex, nofollow";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const productionHostPattern = `^${escapeRegex(PRODUCTION_HOST)}(:\\d+)?$`;

/**
 * Header rules for next.config. `missing` on the host keeps every other host (previews, localhost,
 * a Vercel URL of the production deployment) out of search results, including non-HTML responses.
 */
export const nonProductionRobotsHeader = {
  source: "/:path*",
  missing: [{ type: "host" as const, value: productionHostPattern }],
  headers: [{ key: "X-Robots-Tag", value: NOINDEX_VALUE }],
};

/** `has` variant for rules that apply on the production host only. */
export const onProductionHost = [{ type: "host" as const, value: productionHostPattern }];

/** True when this build may carry indexable meta tags: a production Vercel build or a non-Vercel one. */
export function buildIsIndexable(env: Partial<Record<string, string | undefined>>): boolean {
  return env.VERCEL_ENV === undefined || env.VERCEL_ENV === "production";
}

/** Paths crawlers must not fetch on the production host. */
// Sign-in, sign-up and forgot-password stay crawlable so Google can read their noindex; a
// disallowed but linked URL can still be listed as a bare result.
export const PRODUCTION_DISALLOW = [
  "/api/",
  "/app/",
  "/app$",
  "/admin/",
  "/admin$",
  "/reset-password",
  "/accept-invitation",
  "/account-deleted",
  "/pay",
  "/share-target",
  "/offline.html",
  "/offline.js",
  "/sw.js",
  "/landing-",
  "/final-",
];
