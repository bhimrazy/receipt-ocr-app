/**
 * Report-only until it has run clean in production: Next's inline bootstrap scripts need nonces
 * before `script-src` can be enforced. Receipt images load from presigned storage URLs (R2/S3/RustFS).
 * Cloudflare's origin joins script and frame sources only when Turnstile is on (the site
 * key is inlined at build time, so this matches the client bundle). Google Analytics origins join
 * only when a measurement id is set (Google's CSP guide, GA4 without ads features). Vercel Web
 * Analytics needs nothing extra: production builds load it from the site's own origin.
 */
export function buildContentSecurityPolicy(
  turnstileSiteKey: string | undefined,
  { googleAnalytics = false }: { googleAnalytics?: boolean } = {},
): string {
  const turnstile = turnstileSiteKey?.trim() ? " https://challenges.cloudflare.com" : "";
  const gaScript = googleAnalytics ? " https://www.googletagmanager.com" : "";
  const gaConnect = googleAnalytics
    ? " https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com"
    : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${turnstile}${gaScript}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http://localhost:9000",
    "font-src 'self' data:",
    `connect-src 'self'${gaConnect}`,
    `frame-src 'self'${turnstile}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    // Both: Firefox and Safari still only send report-uri; Chromium prefers report-to.
    "report-uri /api/csp-report",
    "report-to csp",
  ].join("; ");
}
