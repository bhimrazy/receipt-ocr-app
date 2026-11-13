import path from "node:path";
import type { NextConfig } from "next";
import {
  ANALYTICS_PATH_LIST,
  ANALYTICS_PREFIX_LIST,
  parseGaMeasurementId,
} from "./lib/consent/config";
import { buildContentSecurityPolicy } from "./lib/csp";
import { PRODUCTION_HOST, nonProductionRobotsHeader, onProductionHost } from "./lib/seo-hosts";
import { parseSentryDsn, sentryEnvironment, sentryRelease } from "./lib/telemetry/sentry-config";

// Browser error reporting is built in only with a valid SENTRY_DSN (a DSN is public by design).
// Always defined, so with none the browser code is `if ("")` and is dropped at build.
const sentry = parseSentryDsn(process.env.SENTRY_DSN);
const sentryBrowserEnv = {
  NEXT_PUBLIC_SENTRY_DSN: sentry?.dsn ?? "",
  NEXT_PUBLIC_SENTRY_RELEASE: (sentry && sentryRelease(process.env)) || "",
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: sentry ? sentryEnvironment(process.env) : "",
};

// Set only by the production workflow, which uploads the maps to Sentry and deletes them before
// deploy. Other builds (previews, Docker) ship none: browser maps are served as static files.
const emitSourceMaps = process.env.UPLOAD_SOURCE_MAPS === "1";

const contentSecurityPolicy = buildContentSecurityPolicy(
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  {
    googleAnalytics: Boolean(parseGaMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)),
    sentryIngest: sentry?.ingestOrigin,
    paddle: Boolean(process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim()),
  },
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
  "/accept-invitation",
  "/accept-invitation/:path*",
  "/account-deleted",
  "/pay",
  "/offline.html",
];

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
    "@receipt-ocr/calendar",
    "@receipt-ocr/core",
    "@receipt-ocr/db",
    "@receipt-ocr/email",
    "@receipt-ocr/storage",
    "@receipt-ocr/ui",
    "@receipt-ocr/vision",
  ],
  poweredByHeader: false,
  productionBrowserSourceMaps: emitSourceMaps,
  env: sentryBrowserEnv,
  // Loaded only when SENTRY_DSN is set; kept out of the bundle, as Sentry's Node SDK expects.
  serverExternalPackages: ["@sentry/node"],
  experimental: {
    serverSourceMaps: emitSourceMaps,
    // Tab switches within 30 s reuse the page already fetched instead of rendering it again on the
    // server. Mutations call router.refresh() or a Server Action, which drop the whole client
    // cache, so edits show at once. Server-side auth checks are untouched: only what the browser
    // already received is reused, and only briefly.
    staleTimes: { dynamic: 30 },
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host" as const, value: `www.${PRODUCTION_HOST}` }],
        destination: `https://${PRODUCTION_HOST}/:path*`,
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      // Every host but production (previews, localhost, a deployment's own vercel.app URL).
      nonProductionRobotsHeader,
      // Pages where analytics may run send only their origin as Referer: the same-origin /view
      // fetch and Google then never see a path or a query string (?redirect= can name a receipt).
      ...[...ANALYTICS_PATH_LIST, ...ANALYTICS_PREFIX_LIST.map((prefix) => `${prefix}:slug`)].map(
        (source) => ({
          source,
          headers: [{ key: "Referrer-Policy", value: "origin" }],
        }),
      ),
      // As well as the meta tag, so non-HTML responses (CSV exports, JSON) and redirects from
      // these paths stay out of search results too.
      ...noindexPaths.map((source) => ({
        source,
        has: onProductionHost,
        headers: [noindexHeader],
      })),
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
