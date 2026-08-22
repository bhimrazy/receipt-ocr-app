import path from "node:path";
import type { NextConfig } from "next";

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
};

export default nextConfig;
