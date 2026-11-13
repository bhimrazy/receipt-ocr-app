import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

/**
 * Two projects over one alias table. `unit` is pure logic (no database, no network, no browser DOM; components render
 * to static markup). `int` is every `*.int.test.ts`, found by glob, against the compose Postgres and RustFS
 * (`scripts/test.sh`, CI `e2e` job); files run one at a time because they share one database.
 */
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/*.int.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "int",
          include: ["apps/**/*.int.test.ts", "packages/**/*.int.test.ts"],
          exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
          env: { INTEGRATION: "1" },
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
  resolve: {
    // Mirrors each package's `exports`: a new subpath export needs a line here too.
    alias: {
      "server-only": path.join(root, "vitest.server-only.ts"),
      "@/": `${path.join(root, "apps/web")}/`,
      "@receipt-ocr/ai/categories": path.join(root, "packages/ai/src/categories.ts"),
      "@receipt-ocr/ai/models": path.join(root, "packages/ai/src/models.ts"),
      "@receipt-ocr/ai/image-size": path.join(root, "packages/ai/src/image-size.ts"),
      "@receipt-ocr/ai": path.join(root, "packages/ai/src/index.ts"),
      "@receipt-ocr/core/telemetry/otlp": path.join(root, "packages/core/src/telemetry/otlp.ts"),
      "@receipt-ocr/core/telemetry": path.join(root, "packages/core/src/telemetry/index.ts"),
      "@receipt-ocr/core/group-rules": path.join(root, "packages/core/src/group-rules.ts"),
      "@receipt-ocr/core/plans": path.join(root, "packages/core/src/plans.ts"),
      "@receipt-ocr/core/upload-limits": path.join(root, "packages/core/src/upload-limits.ts"),
      "@receipt-ocr/core/review-reasons": path.join(root, "packages/core/src/review-reasons.ts"),
      "@receipt-ocr/core/receipt-fields": path.join(root, "packages/core/src/receipt-fields.ts"),
      "@receipt-ocr/core/extraction-fields": path.join(
        root,
        "packages/core/src/extraction-fields.ts",
      ),
      "@receipt-ocr/core": path.join(root, "packages/core/src/index.ts"),
      "@receipt-ocr/calendar": path.join(root, "packages/calendar/src/index.ts"),
      "@receipt-ocr/db": path.join(root, "packages/db/src/index.ts"),
      "@receipt-ocr/email": path.join(root, "packages/email/src/index.ts"),
      "@receipt-ocr/storage": path.join(root, "packages/storage/src/index.ts"),
      "@receipt-ocr/vision": path.join(root, "packages/vision/src/index.ts"),
    },
  },
});
