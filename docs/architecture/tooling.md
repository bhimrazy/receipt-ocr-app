# Benchmarks, scripts, Docker and CI

Everything that is not the app but keeps it honest: the OCR benchmark, the upload load test, repository checks,
container images and GitHub workflows. Deployment as a flow is on [its own page](flows/deployment.md).

## Contents

- [Monorepo tooling](#monorepo-tooling)
- [OCR benchmark](#ocr-benchmark)
- [Load test](#load-test)
- [Scripts](#scripts)
- [Docker](#docker)
- [CI workflows](#ci-workflows)
- [Dependency rules](#dependency-rules)

## Monorepo tooling

| Tool       | Where                                                                  | Notes                                                                                              |
| ---------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Bun        | [`package.json`](../../package.json) `packageManager`                  | Installs, runs scripts and tests; runs the production Docker image                                 |
| Turborepo  | [`turbo.json`](../../turbo.json)                                       | `build`, `dev`, `typecheck`, `test` across workspaces. Lists every env variable the build may read |
| Vitest     | [`vitest.config.mts`](../../vitest.config.mts)                         | One Node config for every `*.test.ts`; aliases point packages at their `src`                       |
| Playwright | [`apps/web/playwright.config.ts`](../../apps/web/playwright.config.ts) | Starts `next start` on 3004; one Chromium project; a random `x-forwarded-for` per worker           |
| ESLint     | [`eslint.config.mjs`](../../eslint.config.mjs)                         | `eslint-config-next`                                                                               |
| Prettier   | [`.prettierrc.json`](../../.prettierrc.json)                           | Also formats Markdown                                                                              |
| knip       | [`knip.json`](../../knip.json)                                         | Unused files and dependencies                                                                      |

Packages have no build output: each `build` script is `tsc --noEmit`, and Next.js compiles their TypeScript source
directly (`transpilePackages`).

## OCR benchmark

[`bench/ocr.ts`](../../bench/ocr.ts), run with `bun run bench:ocr`. It calls real models, billed to
`GOOGLE_GENERATIVE_AI_API_KEY`.

```mermaid
flowchart LR
  fixtures[bench/fixtures<br/>image + ground-truth JSON] --> run[bench/ocr.ts]
  run -- "extractReceipt per model" --> ai[packages/ai]
  ai --> run
  run -- "scoreReceipt" --> score[bench/score.ts]
  run -- "costOf, same price table as the app" --> ai
  run --> out[bench/results/date.md]
```

- Fixtures are `<id>.png|jpg|pdf` plus `<id>.json`. The five today are synthetic, made by
  [`make-fixtures.mjs`](../../bench/make-fixtures.mjs) (`bun run bench:fixtures`).
- [`score.ts`](../../bench/score.ts) scores exact fields, amounts within 0.01, merchant by edit similarity, and line
  items by F1. It is unit-tested ([`score.test.ts`](../../bench/score.test.ts)).
- Cost uses `costOf` from [`packages/ai/src/models.ts`](../../packages/ai/src/models.ts), so benchmark and app agree.
- Details and flags: [`bench/README.md`](../../bench/README.md).

**Planned:** a set of 20 to 30 real, PII-free receipts and more engines to compare
([parsers landscape](../plans/2026-11-06-parsers-landscape.md)). No benchmark results are committed yet.

## Load test

[`scripts/load.sh`](../../scripts/load.sh) runs the production image (`docker/Dockerfile.prod`) as a small server and
drives it with k6. [`docker-compose.load.yml`](../../docker-compose.load.yml) limits the app to 1 vCPU and 1 GB and
Postgres to 1 vCPU and 512 MB, turns on `pg_stat_statements`, and sets `OCR_PROVIDER=fixture` with
`FIXTURE_LATENCY_MS` so the model takes a realistic few seconds without costing anything. k6 comes from the official
`grafana/k6` image pinned by digest and runs on the compose network, so nothing is installed except Docker and Bun.

```mermaid
flowchart LR
  A[Build and start limited stack] --> B[Seed users, receipts, plan limits]
  B --> C[Warm up]
  C --> D[k6 scenarios]
  D --> E[Sample docker stats and Postgres]
  D --> F[report.mjs]
  E --> F
  F --> G[bench/results/latest.md and load-date.json]
```

Scenarios are smoke, load, spike, soak and a capacity ladder; thresholds are k6 SLOs in
[`bench/load/load.js`](../../bench/load/load.js). The report joins k6 results with container CPU and memory, Postgres
connections, per-statement times and the app's wide events. Details: [`bench/README.md`](../../bench/README.md).

## Scripts

| Script                                                   | Does                                                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`scripts/test.sh`](../../scripts/test.sh)               | Unit tests, then compose Postgres and RustFS, a throwaway database, migrations, build and Playwright e2e. `--unit` stops after unit tests; `--keep-db` keeps the database |
| [`scripts/check-deps.ts`](../../scripts/check-deps.ts)   | `bun run check:deps`: one version per package across the workspace, exact pins only, `bun.lock` in sync                                                                   |
| [`scripts/screenshot.mjs`](../../scripts/screenshot.mjs) | Full-page screenshots of a running instance at desktop and phone widths, optionally signed in                                                                             |

## Docker

```mermaid
flowchart TD
  base[oven/bun:1.4.4-alpine<br/>pinned by digest] --> builder
  builder[builder stage<br/>frozen install, next build standalone] --> runner
  builder -. "also runs" .-> migrate[migrate service<br/>bun run db:migrate]
  runner[runner stage<br/>bun apps/web/server.js, user nextjs]
```

| File                                                     | Used by                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`docker/Dockerfile.prod`](../../docker/Dockerfile.prod) | `bun run docker:app` and any self-hosted deploy. `NEXT_OUTPUT=standalone` only here                       |
| [`docker/Dockerfile.dev`](../../docker/Dockerfile.dev)   | `bun run docker:dev`: `next dev` with the repo bind-mounted                                               |
| [`docker-compose.yml`](../../docker-compose.yml)         | Postgres 18 on 5433, RustFS on 9000, a bucket-creating one-shot, a migrate one-shot, and the app profiles |

Images are pinned by digest. Containers have no restart policy, so they stay stopped until `bun run docker:up`.

## CI workflows

| Workflow                                                   | Trigger                                                  | Jobs                                                                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ci.yml`](../../.github/workflows/ci.yml)                 | Every PR, every push to `main`                           | `static` (format, lint, deps, knip, audit), `checks` (typecheck, unit tests, build), `e2e` (Postgres and RustFS services, migrations, integration suites, build, Playwright) |
| [`preview.yml`](../../.github/workflows/preview.yml)       | Every PR                                                 | Vercel preview deploy and a PR comment with its URL. Skipped for Dependabot                                                                                                  |
| [`production.yml`](../../.github/workflows/production.yml) | CI succeeded on a push to `main`, or by hand from `main` | Deploys the exact commit CI tested to Vercel production; the automatic run skips when migrations changed since the `production-deployed` tag                                 |
| [`db-migrate.yml`](../../.github/workflows/db-migrate.yml) | By hand from `main` only                                 | `bun run db:migrate` against `staging-db` or `production-db` (GitHub environments holding `DIRECT_URL`), one run per database at a time                                      |
| [`load.yml`](../../.github/workflows/load.yml)             | By hand only (workflow_dispatch)                         | Builds the image, runs `scripts/load.sh` with the chosen scenarios and limits, uploads the report. No secrets                                                                |

All third-party actions are pinned to a commit SHA. [`.github/actions/setup-bun`](../../.github/actions/setup-bun/action.yml)
installs the pinned Bun and runs `bun install --frozen-lockfile` with a cache. The Vercel CLI has its own pinned
lockfile in [`.github/vercel-cli`](../../.github/vercel-cli).

## Dependency rules

- Exact versions only, one version per package, checked by `check:deps`.
- Releases must be at least 7 days old: `minimumReleaseAge = "7d"` in [`bunfig.toml`](../../bunfig.toml).
- Installs use `--frozen-lockfile` in CI and Docker.
- `bun audit --audit-level=high` fails CI on high or critical advisories.
