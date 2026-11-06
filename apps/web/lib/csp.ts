/**
 * Report-only until it has run clean in production: Next's inline bootstrap scripts need nonces
 * before `script-src` can be enforced. Receipt images load from presigned storage URLs (R2/S3/RustFS).
 * Cloudflare's origin joins script and frame sources only when Turnstile is on (the site
 * key is inlined at build time, so this matches the client bundle).
 */
export function buildContentSecurityPolicy(turnstileSiteKey: string | undefined): string {
  const turnstile = turnstileSiteKey?.trim() ? " https://challenges.cloudflare.com" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${turnstile}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http://localhost:9000",
    "font-src 'self' data:",
    "connect-src 'self'",
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
