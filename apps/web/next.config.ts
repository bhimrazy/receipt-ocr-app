import path from "node:path";
import type { NextConfig } from "next";

// Report-only until it has run clean in production: Next's inline bootstrap scripts need nonces
// before `script-src` can be enforced. Receipt images load from presigned storage URLs (R2/S3/RustFS).
// Cloudflare's origin joins script and frame sources only when Turnstile is on (the site
// key is inlined at build time, so this matches the client bundle).
const turnstile = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()
  ? " https://challenges.cloudflare.com"
  : "";

const contentSecurityPolicy = [
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

const securityHeaders = [
  // Enforced now: no framing (admin actions, settings), no MIME sniffing, and no full URLs
  // (reset-password tokens) in Referer headers to other origins.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
  { key: "Reporting-Endpoints", value: 'csp="/api/csp-report"' },
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image. Ignored by Vercel.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // In a monorepo, file tracing must start at the workspace root or the
  // standalone bundle misses the workspace packages.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: [
    "@receipt-ocr/ai",
    "@receipt-ocr/core",
    "@receipt-ocr/db",
    "@receipt-ocr/email",
    "@receipt-ocr/storage",
    "@receipt-ocr/ui",
  ],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
