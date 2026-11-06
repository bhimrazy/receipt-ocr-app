import path from "node:path";
import type { NextConfig } from "next";
import { parseGaMeasurementId } from "./lib/consent/config";
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
