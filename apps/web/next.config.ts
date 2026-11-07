import path from "node:path";
import type { NextConfig } from "next";
import { ANALYTICS_PATH_LIST, parseGaMeasurementId } from "./lib/consent/config";
import { buildContentSecurityPolicy } from "./lib/csp";

const contentSecurityPolicy = buildContentSecurityPolicy(
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  { googleAnalytics: Boolean(parseGaMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)) },
);

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

const noindexHeader = { key: "X-Robots-Tag", value: "noindex" };
const noindexPaths = [
  "/app",
  "/app/:path*",
  "/admin",
  "/admin/:path*",
  "/api/:path*",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/accept-invitation/:path*",
];

// Everything but production stays out of search results. Vercel only adds this on *.vercel.app, not on
// a custom domain such as the fixed preview one. No VERCEL_ENV (Docker) leaves behaviour as it was.
const notProduction =
  process.env.VERCEL_ENV !== undefined && process.env.VERCEL_ENV !== "production";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image. Ignored by Vercel.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // In a monorepo, file tracing must start at the workspace root or the
  // standalone bundle misses the workspace packages.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // Resend's SDK lazily imports @react-email/render for its `react` option, which we never use
  // (templates are prerendered by packages/email). The package is a dev dependency there, so
  // without this alias Turbopack would bundle it, with prettier, into the server.
  turbopack: { resolveAlias: { "@react-email/render": "./lib/no-react-email.ts" } },
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
    return [
      {
        source: "/:path*",
        headers: notProduction ? [...securityHeaders, noindexHeader] : securityHeaders,
      },
      // Pages where analytics may run send only their origin as Referer: the same-origin /view
      // fetch and Google then never see a path or a query string (?redirect= can name a receipt).
      ...ANALYTICS_PATH_LIST.map((source) => ({
        source,
        headers: [{ key: "Referrer-Policy", value: "origin" }],
      })),
      // As well as the meta tag, so non-HTML responses (CSV exports, JSON) and redirects from
      // these paths stay out of search results too.
      ...noindexPaths.map((source) => ({ source, headers: [noindexHeader] })),
      // The browser checks for a new worker on each visit; a cached copy would delay updates.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
