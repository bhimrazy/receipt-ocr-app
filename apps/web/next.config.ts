import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@receipt-ocr/ai",
    "@receipt-ocr/core",
    "@receipt-ocr/db",
    "@receipt-ocr/storage",
    "@receipt-ocr/ui",
  ],
};

export default nextConfig;
