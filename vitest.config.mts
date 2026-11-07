import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

/**
 * One config for the whole workspace. These are unit tests over pure logic —
 * no database, no network, no browser DOM (components render to static markup) — so a single Node environment covers all of
 * them and keeps `bun run test` fast enough to run on every change.
 */
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.ts", "bench/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
  },
  resolve: {
    alias: {
      "@/": `${path.join(root, "apps/web")}/`,
      "@receipt-ocr/ai/categories": path.join(root, "packages/ai/src/categories.ts"),
      "@receipt-ocr/ai/models": path.join(root, "packages/ai/src/models.ts"),
      "@receipt-ocr/ai": path.join(root, "packages/ai/src/index.ts"),
      "@receipt-ocr/core/group-rules": path.join(root, "packages/core/src/group-rules.ts"),
      "@receipt-ocr/core/plans": path.join(root, "packages/core/src/plans.ts"),
      "@receipt-ocr/core/upload-limits": path.join(root, "packages/core/src/upload-limits.ts"),
      "@receipt-ocr/core": path.join(root, "packages/core/src/index.ts"),
      "@receipt-ocr/db": path.join(root, "packages/db/src/index.ts"),
      "@receipt-ocr/email": path.join(root, "packages/email/src/index.ts"),
      "@receipt-ocr/storage": path.join(root, "packages/storage/src/index.ts"),
    },
  },
});
