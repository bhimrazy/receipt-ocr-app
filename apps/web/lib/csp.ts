/**
 * Report-only until it has run clean in production: Next's inline bootstrap scripts need nonces
 * before `script-src` can be enforced. Receipt images load from presigned storage URLs (R2/S3/RustFS).
 * Cloudflare's origin joins script and frame sources only when Turnstile is on (the site
 * key is inlined at build time, so this matches the client bundle). Google Analytics origins join
 * only when a measurement id is set (Google's CSP guide, GA4 without ads features). Vercel Web
 * Analytics needs nothing extra: production builds load it from the site's own origin. Paddle's
 * origins (Paddle.js from its CDN, the checkout frame, its API calls) join only when billing is
 * configured (a client token is set at build time).
 */
export function buildContentSecurityPolicy(
  turnstileSiteKey: string | undefined,
  { googleAnalytics = false, paddle = false }: { googleAnalytics?: boolean; paddle?: boolean } = {},
): string {
  const turnstile = turnstileSiteKey?.trim() ? " https://challenges.cloudflare.com" : "";
  const gaScript = googleAnalytics ? " https://www.googletagmanager.com" : "";
  const gaConnect = googleAnalytics
    ? " https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com"
    : "";
  const paddleScript = paddle ? " https://cdn.paddle.com" : "";
  const paddleFrame = paddle ? " https://buy.paddle.com https://sandbox-buy.paddle.com" : "";
  const paddleConnect = paddle ? " https://*.paddle.com" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${turnstile}${gaScript}${paddleScript}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http://localhost:9000",
    "font-src 'self' data:",
    `connect-src 'self'${gaConnect}${paddleConnect}`,
    // public/sw.js; without this, worker-src falls back to script-src.
    "worker-src 'self'",
    "manifest-src 'self'",
    `frame-src 'self'${turnstile}${paddleFrame}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    // Both: Firefox and Safari still only send report-uri; Chromium prefers report-to.
    "report-uri /api/csp-report",
    "report-to csp",
  ].join("; ");
}
