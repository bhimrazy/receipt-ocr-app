# Architecture

Receipt OCR turns a photo or PDF of a receipt into structured rows (merchant, date, category, currency, totals and
line items) that a user can check, correct and export as CSV. It is a Bun and Turborepo monorepo: one Next.js app and
six internal packages.

This folder documents what the code does today. Work that is only planned is marked **Planned** and links to its plan.
When the code and this page disagree, the code wins; fix the page in the same PR (see [Keeping this current](#keeping-this-current)).

## Contents

- [The system at a glance](#the-system-at-a-glance)
- [Apps and packages](#apps-and-packages)
- [Terms used in these pages](#terms-used-in-these-pages)
- [Reading order](#reading-order)
- [Working principles](#working-principles)
- [What is planned, not built](#what-is-planned-not-built)

## The system at a glance

One Next.js app does everything: it serves the pages, handles sign-in, accepts uploads, calls the model and writes the
results. Background work runs through a Postgres [job queue](flows/jobs.md), drained by a cron-called route in the
same app; there is no separate worker process yet.

```mermaid
flowchart LR
  user([User in a browser])
  web[Next.js app, apps/web<br/>on Vercel or Docker with Bun]
  pg[(Postgres<br/>Supabase in production)]
  s3[(S3-compatible bucket<br/>R2, S3 or RustFS)]
  gemini[Google Gemini<br/>through the AI SDK]
  claude[Anthropic Claude<br/>optional, through the AI SDK]
  groq[Groq<br/>optional, through the AI SDK]
  openai[OpenAI<br/>optional, through the AI SDK]
  cron[pg_cron on Supabase,<br/>daily Vercel cron]
  resend[Resend<br/>transactional email]
  oauth[Google and GitHub<br/>OAuth]
  paddle[Paddle<br/>subscriptions, merchant of record]

  user -- "pages, API calls" --> web
  user -. "loads receipt image<br/>by signed URL" .-> s3
  web -- "SQL over a pool" --> pg
  web -- "put, get, delete,<br/>sign URLs" --> s3
  web -- "image + prompt,<br/>structured output" --> gemini
  web -. "optional chain step" .-> claude
  web -. "optional chain step" .-> groq
  web -. "optional chain step" .-> openai
  cron -- "POST /api/jobs/drain" --> web
  web -- "verify, reset,<br/>invite mail" --> resend
  user -- "OAuth redirect" --> oauth
  oauth -- "callback with code" --> web
  user -. "checkout overlay<br/>(Paddle.js)" .-> paddle
  paddle -- "signed webhooks" --> web
  web -. "portal links" .-> paddle
```

| External service      | What the app uses it for                                            | Configured by                                                                   |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Postgres              | Every table: auth, workspaces, receipts, usage ledger, admin        | `DATABASE_URL` (app), `DIRECT_URL` (migrations)                                 |
| S3-compatible storage | The uploaded receipt files; the bucket stays private                | `S3_*`                                                                          |
| Google Gemini         | Reading the receipt into the extraction schema                      | `GOOGLE_GENERATIVE_AI_API_KEY`, Admin → Settings                                |
| Anthropic Claude      | First step of the default chain (Sonnet 5.5); other models optional | `ANTHROPIC_API_KEY`, Admin → Settings                                           |
| Groq                  | Optional OCR model (Qwen 3.8 27B, free tier) in the chain           | `GROQ_API_KEY`, Admin → Settings                                                |
| OpenAI                | Optional OCR models (GPT-6 Luna, GPT-6.1 Terra) in the chain        | `OPENAI_API_KEY`, Admin → Settings                                              |
| Resend                | Verification, password reset, invitation and support mail           | `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL`                                 |
| Google, GitHub OAuth  | Optional social sign-in                                             | `GOOGLE_CLIENT_ID`/`_SECRET`, `GITHUB_CLIENT_ID`/`_SECRET`                      |
| Paddle Billing        | Subscriptions for Pro: checkout, payment, tax, invoices, portal     | `PADDLE_*`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` (see [billing](flows/billing.md)) |
| Google Analytics 4    | Optional visit counts on public pages, only after consent           | `NEXT_PUBLIC_GA_MEASUREMENT_ID` (see [web](web.md))                             |
| Vercel Web Analytics  | Cookie-free page counts on Vercel builds only                       | automatic when `VERCEL=1`                                                       |
| Axiom (any OTLP host) | Optional copy of the wide-event logs, as OTLP log records           | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`                     |
| Sentry                | Optional error reports (server and browser), errors only            | `SENTRY_DSN`                                                                    |
| PostHog               | Optional server-side product events (no browser SDK)                | `POSTHOG_KEY`, `POSTHOG_HOST`                                                   |

Every service except Postgres and auth is optional at runtime: without a Gemini key the app still serves history and
exports, and without Resend mail is logged instead of sent. The full variable list is in
[deployment.md](../deployment.md#4-environment-variables).

## Apps and packages

Arrows point from a package to what it imports; dashed arrows are narrow imports of a few helpers. The web app is the only thing that runs; the packages are TypeScript
source it compiles in (`transpilePackages` in [next.config.ts](../../apps/web/next.config.ts)).

```mermaid
flowchart TD
  web[apps/web<br/>Next.js]
  core[packages/core<br/>Effect services]
  ai[packages/ai<br/>model calls]
  db[packages/db<br/>Drizzle schema]
  storage[packages/storage<br/>S3 helpers]
  email[packages/email<br/>Resend]
  ui[packages/ui<br/>primitives]
  calendar[packages/calendar<br/>BS dates, no dependencies]

  web --> core
  web --> ui
  web --> calendar
  web --> email
  web -. "auth adapter, counts" .-> db
  web -. "categories, model list" .-> ai
  core --> ai
  core --> calendar
  core --> db
  core --> storage
```

`apps/web` imports `packages/ai` directly only through its two dependency-free entry points: the category list
(`@receipt-ocr/ai/categories`) and the model list (`@receipt-ocr/ai/models`, for the admin settings page). It imports
`packages/db` directly for Better Auth's adapter and a few membership counts. All receipt work goes through
`packages/core`.

| Path                                                 | Role                                                                                                            | Page                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [`apps/web`](../../apps/web)                         | Pages, route handlers, server actions, Better Auth config. Thin adapters over core.                             | [web.md](web.md)         |
| [`packages/core`](../../packages/core)               | The receipt workflow, receipt groups, quota, usage ledger, billing, settings, admin writes. Effect TS services. | [core.md](core.md)       |
| [`packages/ai`](../../packages/ai)                   | One model call: schema, prompt, error kinds, usage, the model list and its prices.                              | [ai.md](ai.md)           |
| [`packages/calendar`](../../packages/calendar)       | Bikram Sambat month table, AD and BS conversion, and the printed-date resolver. Pure, no dependencies.          | [dates.md](dates.md)     |
| [`packages/db`](../../packages/db)                   | Drizzle schema for every table and the shared connection pool.                                                  | [db.md](db.md)           |
| [`packages/storage`](../../packages/storage)         | S3 client, object keys, signed read URLs.                                                                       | [storage.md](storage.md) |
| [`packages/email`](../../packages/email)             | Resend sender and React Email templates (HTML + plain text).                                                    | [email.md](email.md)     |
| [`packages/ui`](../../packages/ui)                   | shadcn-style primitives on Base UI, Tailwind v4 theme tokens.                                                   | [ui.md](ui.md)           |
| `packages/bench/`, `scripts/`, `docker/`, `.github/` | OCR benchmark, load test, dependency checks, images, CI and deploys.                                            | [tooling.md](tooling.md) |

## Terms used in these pages

| Term             | Meaning                                                                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace        | A Better Auth **organization**. Receipts belong to a workspace; every member can read them. Every user gets a personal one.                                                                                                                                      |
| Workspace role   | `member.role`: exactly one of `owner`, `admin` or `member` (enforced by `assertWorkspaceRole`). Decides who may edit or delete receipts and manage members.                                                                                                      |
| Platform admin   | A user with `user.role = 'admin'` (Better Auth admin plugin). Sees `/admin`. Unrelated to the workspace role.                                                                                                                                                    |
| Scope            | `{ organizationId, userId, role }` for one request, resolved through `member` on every request.                                                                                                                                                                  |
| Round            | One upload or one retry of a receipt. `receipts.attempts` counts them; each gets an `ocr_rounds` row.                                                                                                                                                            |
| Call             | One model call inside a round. Each gets an `ocr_calls` row with tokens, latency and cost.                                                                                                                                                                       |
| Chain            | The ordered list of models an admin configured. The first that works reads the receipt; the rest are fallbacks.                                                                                                                                                  |
| Plan             | `free` or `pro`. Belongs to a workspace (an entitled subscription, or an admin comp on its owner). See [Billing](flows/billing.md).                                                                                                                              |
| Usage ledger     | `ocr_rounds` + `ocr_calls`. Append-only; quota and cost are counted from it, never from `receipts`.                                                                                                                                                              |
| Wide event       | One JSON log line per unit of work (request, page render, job attempt, queue tick) holding everything about it: ids, timings, model, cost, outcome. See [Observability](flows/observability.md).                                                                 |
| Advisory lock    | A Postgres lock on a number, not a row (`pg_advisory_xact_lock`). Used per user (and per workspace on a workspace-scoped plan) so quota checks run one at a time, per subscription so webhook writes do, and per workspace for group limits; released at commit. |
| Instant / queued | The two upload modes: read in the request, or respond `202` and read after the response.                                                                                                                                                                         |

## Reading order

**Beginner path.** Read these in order; each takes a few minutes.

1. This page, for the shape of the system.
2. [Upload, extraction and result](flows/upload-and-extraction.md): the one flow the product exists for.
3. [web.md](web.md): where pages and routes live, and how a request reaches core.
4. [core.md](core.md): the services behind every route.
5. [Data model](data-model.md): the tables those services read and write.

**Deep dives**, in any order:

- [Sign-up, sign-in and invitations](flows/auth.md)
- [Retry](flows/retry.md) and the attempt guard
- [Background jobs](flows/jobs.md): the Postgres queue, leases, retries and cooldowns
- [Billing](flows/billing.md): Paddle checkout, webhooks, workspace plans and quota rules
- [Observability](flows/observability.md): wide events, the schema allowlist and sampling
- [Admin actions and the audit log](flows/admin-actions.md)
- [Admin operations and jobs](flows/admin-operations.md): charts, their sources, and the job actions
- [Settings cache](flows/settings-cache.md)
- [Receipt dates and Bikram Sambat](dates.md): the stored date, the month table and its yearly update, the resolver
- [CI, deployment and migrations](flows/deployment.md)
- [ai.md](ai.md) (model boundary, prices), [db.md](db.md), [storage.md](storage.md), [email.md](email.md),
  [ui.md](ui.md), [tooling.md](tooling.md)

Related documents outside this folder: [STATUS.md](../STATUS.md) (what is shipped and what is next),
[deployment.md](../deployment.md) (operator steps), [plans](../plans) and [reviews](../reviews).

## Working principles

These hold across the codebase. Each package page lists its own invariants as well. The security reasoning behind
several of them is in the [security audit](../reviews/2026-11-06-security-audit.md).

1. **Route handlers and server actions are thin adapters.** They check the session, origin and input, then run one
   Effect program from `packages/core` and map its typed error to a status code
   ([`runRoute`](../../apps/web/lib/http.ts)). Workflow logic lives in core so a future worker can reuse it.
2. **Every receipt query is scoped to the caller's workspace.** The scope is resolved from `member` on every request,
   not taken from the session ([`resolveScope`](../../packages/core/src/workspace.ts)).
3. **Usage is an append-only ledger.** Quota, the global cap and cost read `ocr_rounds` and `ocr_calls`, so deleting
   a receipt or a workspace refunds nothing ([`usage.ts`](../../packages/core/src/usage.ts)).
4. **Only the current attempt may write a result.** Completion and failure match on `status = 'processing'` and the
   attempt number, so a stale or duplicate run writes nothing
   ([`currentAttempt`](../../packages/core/src/repository.ts)).
5. **`packages/ai` is the provider boundary.** It makes one call with one model and classifies the failure; core owns
   the chain, deadlines and fallback. Nothing outside `packages/ai` imports the AI SDK.
6. **Every admin change has an audit row.** Core changes write it in the same transaction; Better Auth changes write
   it first and add a `_failed` row if the call fails.
7. **Missing configuration turns a feature off, not the app.** Each service reads its own config when used, so a
   missing key fails only that feature with `NotConfigured` ([`config.ts`](../../packages/core/src/config.ts)).
8. **Fail closed on limits.** Unknown plans get the default plan's limits, and an unreadable settings row falls back
   to code defaults, never to unlimited.

## What is planned, not built

| Planned                                | Today                                                                                                                                                                                   | Plan                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/worker` for the job queue        | The [job queue](flows/jobs.md) is drained by `/api/jobs/drain` (pg_cron every 5 minutes, daily Vercel cron) and by the upload, retry and poll routes in `after()`                       | [Durable background jobs](../plans/2026-11-06-jobs-queue.md), Tracks B to D; also [extraction cost and accuracy, section 5](../plans/2026-11-06-extraction-cost-accuracy.md#5-batch--async) |
| Browser PostHog, Sentry source maps    | Server-side PostHog events and Sentry errors only ([observability](flows/observability.md))                                                                                             | [Observability](../plans/2026-11-06-observability.md); browser PostHog needs a consent decision                                                                                             |
| Usage screens for customers and admins | Rollup queries exist in `usage.ts`; only the daily meter is shown                                                                                                                       | [Usage design](../plans/2026-11-06-usage-design.md)                                                                                                                                         |
| Passkeys and two-factor                | Email/password and OAuth only (PR #95 in review)                                                                                                                                        | [Passkeys and 2FA](../plans/2026-11-06-passkeys-2fa.md)                                                                                                                                     |
| Scan packs                             | Not built; the [billing page](flows/billing.md#how-scan-packs-will-fit) says where they fit                                                                                             | [Payments](../plans/2026-11-07-payments.md)                                                                                                                                                 |
| More AI providers, per-model options   | Google, Anthropic, Groq and OpenAI (plus the offline fixture); keys come from the environment                                                                                           | [AI usage and models](../plans/2026-11-06-ai-usage-models.md), [BYOK](../plans/2026-11-07-byok.md)                                                                                          |
| Seats and member limits                | Pro has a per-workspace monthly quota (500 a month, 200 a day, shared by members; [Billing](flows/billing.md)); Free is per user per UTC day. Seat caps and member limits are not built | [Members and admin](../plans/2026-11-06-members-admin-plan.md)                                                                                                                              |
| Home currency and FX conversion        | Amounts `numeric(12,2)`, currency defaults to USD, no conversion                                                                                                                        | [Currencies and FX](../plans/2026-11-06-currencies-fx.md)                                                                                                                                   |

## Keeping this current

Update the relevant page and its diagram in the same PR as an architectural change: a new package or service, a new
table or constraint, a changed flow, a new external dependency. [AGENTS.md](../../AGENTS.md) says the same.
