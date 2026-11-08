import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "packages/bench/results/**",
      "packages/email/src/generated.ts",
      "apps/web/playwright-report/**",
      "apps/web/test-results/**",
      "apps/web/next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // The Next plugin only needs to know where the app lives (monorepo root is not apps/web).
    settings: { next: { rootDir: "apps/web/" } },
  },
  {
    // Fetch-on-mount in members-manager trips this; warn until it moves to a data-fetching pattern.
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
  {
    // Server packages have no React; Effect's `Service.use(...)` is not a hook.
    files: ["packages/{ai,bench,core,db,email,storage}/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];

export default config;
