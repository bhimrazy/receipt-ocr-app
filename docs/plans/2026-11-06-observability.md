# Observability: wide events, OTLP transport, vendors as configuration

Date: 2026-11-06. Revised 2026-11-06 with the owner's decision (below). Sections 2 to 10 are the earlier per-vendor
design; where they disagree with "Decided", "Decided" wins.

## Decided (owner, 2026-11-06)

1. **Wide events are the base.** Every unit of work writes one JSON event: an API request, a server page render, a
   job attempt and a queue tick. The schema, the redaction allowlist and tail sampling live in
   [`packages/core/src/telemetry`](../../packages/core/src/telemetry) and are documented there. Code reports each fact
   once, on the current event (`annotateEvent` from Effect code, the `event` argument in route handlers).
2. **Vendor-neutral through OpenTelemetry. OTLP is the only transport in code.** The app never imports a vendor's
   logging SDK for shipping events. Events go to stdout as JSON lines (always, so `vercel logs` and `docker logs` keep
   working) and, when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, also as OTLP log records through `@effect/opentelemetry` on
   the Effect side and Next's `instrumentation.ts` (`register()`) on the Next side. No OTel dependency is added until
   that track; this PR only makes the event shape ready for it.
3. **Axiom is the default destination**, through its OTLP endpoint. Switching to Grafana Cloud, Honeycomb, Sentry
   (its OTLP intake) or a self-hosted OpenTelemetry Collector is a change of env values only, never of code.
4. **Vendor extras stay optional and separate** (each off unless its own env is set): Sentry error grouping, release
   tracking and source maps (`@sentry/nextjs`, sections 3 and 4), and PostHog server-side product analytics and
   `$ai_generation` (section 2). They add features on top; they are not the log pipeline.
5. **Browser analytics is out of scope here.** Product analytics on public pages (client PostHog, consent) is decided
   in the separate consent track.

### Env keys

| Key                           | Meaning                                                                                | Default                      |
| ----------------------------- | -------------------------------------------------------------------------------------- | ---------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP/HTTP base URL. Unset: stdout only, no exporter loaded, no network calls           | unset                        |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Comma-separated `key=value` auth headers for the endpoint (standard OTel format)       | unset                        |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (preferred) or `http/json`                                             | `http/protobuf`              |
| `OTEL_SERVICE_NAME`           | `service` on every event and the OTel resource `service.name`                          | `web`                        |
| `OTEL_RESOURCE_ATTRIBUTES`    | Extra resource attributes, e.g. `deployment.environment.name=production`               | unset                        |
| `LOG_SAMPLE_RATE`             | Share (0 to 1) of routine events kept: fast successful page renders, polls, idle ticks | `1`; set `0.1` in production |
| `LOG_SLOW_MS`                 | At or above this `duration_ms` an event is slow and always kept                        | `1000`                       |

Errors (status 4xx/5xx, `error` set, level `error`), slow units and anything with a model call are always kept, at any
rate. Sampled lines carry `sample_rate`, so dashboards weight counts by `1 / sample_rate`. `LOG_*` sampling applies
before both stdout and OTLP, so the two sinks always hold the same events. OTel trace sampling
(`OTEL_TRACES_SAMPLER`) stays at its default off until traces are wanted.

### Axiom example (placeholder values)

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.axiom.co
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer xaat-00000000-0000-0000-0000-000000000000,X-Axiom-Dataset=receipt-ocr
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_SERVICE_NAME=web
LOG_SAMPLE_RATE=0.1
```

Use an ingest-only token scoped to the one dataset. EU org: the regional edge URL from Axiom's settings. Switching
vendors means replacing the first two lines: for example Grafana Cloud's OTLP gateway URL with
`Authorization=Basic <base64 instance:token>`, Honeycomb's `https://api.honeycomb.io` with `x-honeycomb-team=<key>`, or
a collector at `http://otel-collector:4318` with no headers.

### Mapping a wide event to an OTLP log record

- Resource: `service` → `service.name`, `version` → `service.version`, `env` → `deployment.environment.name`,
  `region` → `cloud.region`, `instance` → `service.instance.id`.
- Record: `timestamp` → `Timestamp`, `level` → `SeverityText` (and `SeverityNumber` 9 for info, 17 for error),
  `event` → `EventName`, the rest of the fields → attributes under the same snake_case keys (nested groups flattened
  with dots: `ocr.tokens_in`). `request_id` stays an attribute; when traces arrive the record also gets the active
  span's `TraceId`/`SpanId`.

### Flushing on serverless

- Vercel functions freeze after the response. The exporter's batch processor is flushed in `after()` once per
  request (`forceFlush()`, bounded at 2 s), and job drains flush at the end of their `after()`. When no endpoint is
  set, nothing is registered.
- The Docker (Bun) server is long-lived: the batch processor's timer covers it, plus `shutdown()` on `SIGTERM`.
- Export failures never fail a request and never log through the logger (no recursion): one stderr line per minute
  at most.

### Scrubbing

- The allowlist in `telemetry/schema.ts` is the scrubber: unknown keys are dropped (their paths listed in
  `dropped_fields`), ids must look like ids, codes like codes (no spaces or `@`), routes lose query strings and hashes.
  Errors are described by `type`, `class`, `kind` and `code`, never their message. This runs inside `formatEvent`,
  before any sink, so stdout and OTLP get the same scrubbed object (security plan B6).
- Vendor SDKs added on top (Sentry, PostHog) keep their own `beforeSend` scrubbers as described below, because they
  capture things our events don't (stack frames, breadcrumbs).

### Tracks from here

1. **Wide events everywhere** (this PR): schema, allowlist, sampling, request/page/job/tick events, Effect logger.
2. **OTLP export**: `@effect/opentelemetry` with the OTLP log and trace exporters, wired in `register()` only when
   `OTEL_EXPORTER_OTLP_ENDPOINT` is set; `after()` flush; a test that an unset endpoint loads nothing. Pin versions at
   implementation time (7-day rule), and check that `@effect/opentelemetry` peers match `effect@3.22.4`.
   **Built (2026-11-08)** as an event sink on the one `emit` ([flow](../architecture/flows/observability.md#otlp-export)):
   `@opentelemetry/sdk-logs` with the OTLP/HTTP protobuf (default) and JSON log exporters, no trace exporter and no
   `@effect/opentelemetry`, because every Effect log already goes through `emit`. The `after()` flush is scheduled by
   the first event of a request instead of at each call site.
3. **Sentry extras** (optional): errors, releases and source maps, as in sections 3 and 4.
   **Built (2026-11-08)** without source maps ([flow](../architecture/flows/observability.md#sentry)):
   `@sentry/node` on the server and a bare `@sentry/browser` client instead of `@sentry/nextjs`, because without
   `withSentryConfig` (no build plugin, no tunnel) the Next SDK adds only `captureRequestError`, and the lean client
   keeps tracing and Replay code out of the bundle. No edge config: nothing runs on the edge runtime. Source maps
   wait for the separate `sentry-cli` step (security plan M11).
4. **PostHog server events** (optional): as in section 2, server side only.
   **Built (2026-11-08)** ([flow](../architecture/flows/observability.md#posthog)): events are projected from the
   wide events through an event sink rather than called at each route, with a closed, runtime-checked catalogue:
   `signed_up`, `receipt_uploaded`, `receipt_scanned`, `receipt_scan_failed`, `csv_exported`, `plan_limit_hit`
   (uploads only so far). Not yet: `workspace_created`, invites, `receipt_retried`, `$ai_generation`, browser PostHog.

## Earlier design (vendor-specific, superseded where it conflicts)

The text below was written when Axiom was planned as an SDK sink (`@axiomhq/js`). That is replaced by OTLP above; the
Sentry and PostHog sections still describe the optional extras.

## 2. PostHog (product analytics and LLM analytics)

### Server (`posthog-node`), the source of truth for product events

- One module-level client, created lazily when `POSTHOG_KEY` is set:
  `new PostHog(key, { host, flushAt: 20, flushInterval: onVercel ? 0 : 10_000, disableGeoip: true })`. Exception
  autocapture stays off (Sentry owns errors).
- Flush through `telemetry.flush()` in `after()`, so the response never waits on PostHog. Use `flush()`, not
  `shutdown()`; `shutdown()` runs only on `SIGTERM` in Docker. Flush errors are caught and logged once, and never
  replace an app error.
- **Identity:** `distinctId = user.id` (Better Auth id, never email). `groups: { workspace: organizationId }` on every
  workspace-scoped event. Call `groupIdentify` once on `workspace_created` with `{ plan, personal }` and no name, since
  names can be personal ("Bhim's receipts").
- **Impersonation:** when `session.impersonatedBy` is set, skip product events (admins would pollute the funnels). The
  wide event still records it as it does today.
- Server-side capture covers events that ad-blockers would drop client-side, which is most of the catalogue.

### Client (`posthog-js`), optional and separately switchable

- Enabled by `NEXT_PUBLIC_POSTHOG_KEY` only. This makes a "server-only PostHog" mode possible: no cookies, no consent
  banner, and still the full funnel from the server.
- `apps/web/instrumentation-client.ts`:
  `if (process.env.NEXT_PUBLIC_POSTHOG_KEY) import("./lib/telemetry/posthog-client").then((m) => m.init())`.
  `NEXT_PUBLIC_*` is inlined at build, so with the key unset the branch is `if (undefined)`, gets dead-code-eliminated,
  and the chunk is never emitted. A CI check enforces this (see Testing).
- **Reverse proxy:** when the key is set, `next.config.ts` adds these rewrites (US or EU host from `POSTHOG_HOST`):
  - `/_r/static/:path*` → `https://us-assets.i.posthog.com/static/:path*`
  - `/_r/array/:path*` → `https://us-assets.i.posthog.com/array/:path*`
  - `/_r/:path*` → `https://us.i.posthog.com/:path*`

  The SDK uses `api_host: "/_r"` and `ui_host: "https://us.posthog.com"`. PostHog needs `skipTrailingSlashRedirect: true`;
  set it only when the key is set, because it changes trailing-slash behaviour app-wide. On Vercel, external rewrites
  are proxied by the CDN (no function invocation). In Docker, Next proxies them (small extra load).

- **Init options:** `defaults: "2026-08-30"` (the current docs value), `person_profiles: "identified_only"`,
  `autocapture: false` (click text could include merchant names and amounts shown in the UI),
  `disable_session_recording: true` (replay would capture receipt images), `disable_surveys: true`,
  `capture_exceptions: false`, `persistence` per the consent decision, and `before_send` that strips the query string and
  hash from `$current_url` / `$referrer` and rewrites `/accept-invitation/<id>` and `/reset-password…` to their route
  pattern. This matters because reset tokens and invitation ids are bearer secrets.
- **Identity:** a small client component in `app/app/layout.tsx` calls `posthog.identify(user.id)` when the session
  user differs from `posthog.get_distinct_id()`. Sign-out calls `posthog.reset()`. Never send email or name as person
  properties (owner decision below).
- Client events are limited to `$pageview` / `$pageleave` (from `defaults`) and a few UI-only intents that the server
  can't see (`pricing_cta_clicked`, `support_opened`).

### LLM analytics: our own `$ai_generation`, not `@posthog/ai`

- `@posthog/ai` `withTracing` doesn't accept AI SDK v7 models. Its v7 path requires an OTel `NodeSDK` plus
  `@ai-sdk/otel` `registerTelemetry`, which Sentry's docs warn produces duplicate spans next to Sentry's integration.
  It's also a second source of token and cost numbers.
- **Instead:** for each OCR attempt (we're already adding per-attempt token and cost tracking to the DB), emit one
  `$ai_generation` from the same data:

  ```
  $ai_trace_id = request_id         $ai_span_id = attempt id (or `${request_id}:${i}`)
  $ai_model    = "gemini-…"         $ai_provider = "google"
  $ai_input_tokens / $ai_output_tokens / $ai_total_cost_usd  (from our pricing table, so PostHog == DB)
  $ai_latency  = attempt.ms / 1000  $ai_is_error = kind !== "ok"   $ai_error = kind (e.g. "timeout"), never the message
  $ai_input = null, $ai_output_choices = null   ← privacy mode: receipts are customer data
  receipt_id, mode ("instant"|"queued"), attempt_index, fallback (bool), $groups.workspace
  ```

- Emitted at one place: the HTTP adapter (`recordOcr` and the `OcrError` branch of `failureResponse` in
  `lib/http.ts`), which already sees `attempts` for instant, queued (`runBackground`) and failed reads. `packages/core`
  stays provider-free; a future `apps/worker` gets the same events by reusing the same adapter.
- The fixture model is skipped (no cost, and it would only add noise in e2e and dev).

## 3. Sentry (errors, optional performance)

**Recommendation:** use `@sentry/nextjs` 11 for server errors (plus optional client errors), with tracing off by default.
Don't enable Replay, Logs or Metrics.

- **Server:** `instrumentation.ts`
  - `register()`: `if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) await import("./sentry.server.config")`.
    It goes before `loadEnvOrExit`, so boot errors are captured too.
  - `export const onRequestError = async (...a) => { if (!process.env.SENTRY_DSN) return; (await import("@sentry/nextjs")).captureRequestError(...a) }`.
    The export has to be static; the body is a no-op when unset, and the module is never loaded.
- **Our own failures:** Effect catches route failures, so they never reach `onRequestError`. `lib/http.ts` calls
  `telemetry.captureError(cause, event)` in `failureResponse` for 5xx and defects only (the same rule as `logFailure`),
  and in `runBackground`'s failure branch. This gives one capture site, and expected 4xx errors never become Sentry
  issues.
- **Init:**

  ```ts
  Sentry.init({
    dsn,
    environment,
    release: VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0), // errors-only by default
    dataCollection: {
      userInfo: false,
      cookies: false,
      urlQueryParams: false,
      httpBodies: [],
      databaseQueryData: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
    },
    sendClientReports: false,
    beforeSend: scrub, // shared with log.ts: Drizzle `params:` redaction (same regex as causeDetail), drop request.data
  });
  ```

  `Sentry.setUser({ id })` only, and tag `workspace_id`. When tracing is on, `vercelAIIntegration` is automatic for v7
  `generateText` (our call). With `genAI` collection off it records only model, tokens and latency, which overlaps
  PostHog. Turn it off with `integrations: (d) => d.filter((i) => i.name !== "VercelAI")` unless the owner wants AI spans
  in traces.

- **Client (optional, `NEXT_PUBLIC_SENTRY_DSN`):** the same dead-code-eliminated dynamic import in
  `instrumentation-client.ts`, with errors only (no `browserTracingIntegration`, no Replay, no Feedback) to keep it to the
  smallest bundle. `app/global-error.tsx` and `app/app/error.tsx` call `telemetry.captureError` on the client, which is a
  no-op when unset.
- **Tunnel:** `withSentryConfig({ tunnelRoute: "/_e" })`, so the browser posts to our origin, `connect-src 'self'` holds
  and ad-blockers don't drop events. Cost: one function invocation per client error (cheap when errors-only). Exclude
  `/_e` from `proxy.ts` (it doesn't match today, but don't widen the matcher over it).
- **next.config:** wrap conditionally with an async config:
  `export default async () => dsn ? (await import("@sentry/nextjs")).withSentryConfig(config, opts) : config`.
  Unconfigured builds are byte-identical in behaviour.
- **Source maps:** need `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` / `SENTRY_PROJECT` at build. CI currently gives the
  `vercel build` step no token on purpose ("it runs repository code"). Options (owner decision):
  - (a) Give the build step a Sentry token scoped to `project:releases` / source-map upload only.
  - (b) Build without a token, then run `sentry-cli sourcemaps inject` + `upload` in a separate step that has the token
    and doesn't run repo code. This is safer, but one more pinned dependency.

  Either way, set `sourcemaps.deleteSourcemapsAfterUpload: true`, so maps aren't served publicly.

- **Bun in Docker:** `@sentry/nextjs` runs `@sentry/node`, whose auto-instrumentation relies on Node module hooks and
  diagnostics channels. Sentry doesn't document Next-on-Bun (open issues #14718 and #19179). Expect `captureException`,
  `onRequestError` and our explicit captures to work, and auto spans (http, pg, AI) to be partial or missing. Plan:
  errors-only in Docker (`SENTRY_TRACES_SAMPLE_RATE` unset), plus a smoke test in the Sentry track that throws a test
  error in the compose stack and checks that it arrives (or checks the envelope with a local sink).

## 4. One telemetry interface

`apps/web/lib/telemetry/` (server-only), plus a tiny `client.ts`:

```ts
// index.ts
export type ProductEvent =
  | { name: "user_signed_up"; userId: string; props: { method: "email" | "google" | "github" } }
  | { name: "receipt_read"; userId: string; workspaceId: string; props: { model: string; attempts: number; fallback: boolean; ms: number } }
  | …;                                   // typed catalogue below, so no free-form props (keeps PII out by type)

export interface Telemetry {
  log(level: "info" | "error", event: WideEvent): void;          // stdout always; Axiom if configured
  track(event: ProductEvent): void;                                // PostHog if configured
  generation(g: AiGeneration): void;                               // PostHog $ai_generation if configured
  captureError(error: unknown, ctx: { requestId?: string; userId?: string; workspaceId?: string }): void; // Sentry
  flush(): Promise<void>;                                          // awaits every enabled sink, swallows sink errors
}
```

- `config.ts` reads env once. `enabled = { axiom, posthog, sentry }`. If nothing is enabled, `track`, `generation`,
  `captureError` and `flush` are bound to a shared `noop` and `log` is today's `emit`. No imports, no promises, no
  `after()` registration.
- Each adapter (`axiom.ts`, `posthog.ts`, `sentry.ts`) is loaded with `await import()` on first use and memoised. Calls
  made before load are queued in a small array (capped at 500, oldest dropped).
- `lib/log.ts` keeps its `logger` export as a thin alias, so existing call sites don't change.
- **Flush wiring:** the `respond()` helpers in routes, `runRoute`, and `runBackground` call `scheduleFlush()`. That
  calls `after(telemetry.flush)` at most once per request (tracked with a per-request flag), and only when some sink is
  enabled. Better Auth hooks run inside the `/api/auth` route handler, so `after()` is available there too. If `after()`
  throws (outside request scope), it falls back to the adapter's own timer.
- **Scrubbing** lives in `telemetry/scrub.ts`: Drizzle `params:` redaction (moved from `causeDetail`), URL
  query/hash stripping and secret-path normalisation. It's shared by the Sentry `beforeSend`, PostHog `before_send` and
  wide-event `path`.
- **Why not `packages/core`:** core stays free of provider SDKs and HTTP concerns, and the events are derived where the
  wide event is built. When `apps/worker` arrives, move `lib/telemetry` (minus `after()`) to a `packages/telemetry` and
  have the worker flush per job. The interface is already shaped for that.

## 5. Event catalogue

Server-side unless marked. All carry `$groups.workspace` when scoped. There are no emails, names, merchants, amounts or
file names anywhere.

| Event                                   | Where                                                                                        | Props                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `user_signed_up`                        | `databaseHooks.user.create.after`                                                            | `method` (from the account's `providerId`)                                                     |
| `workspace_created`                     | `organizationHooks.afterCreateOrganization` (+ `ensurePersonalWorkspace`)                    | `personal`, `plan`; plus `groupIdentify`                                                       |
| `invite_sent`                           | `afterCreateInvitation`                                                                      | `role`                                                                                         |
| `invite_accepted`                       | `afterAcceptInvitation`                                                                      | `role`                                                                                         |
| `receipt_uploaded`                      | `POST /api/receipts` after ingest                                                            | `mode`, `mime`, `size_kb` (bucketed), `plan`                                                   |
| `receipt_read`                          | instant success / `runBackground` success                                                    | `model`, `attempts`, `fallback`, `duration_ms`, `items_count`, `confidence_bucket`, `category` |
| `receipt_read_failed`                   | the `OcrError` branch                                                                        | `kind`, `attempts`, `last_model`                                                               |
| `receipt_retried`                       | `POST /api/receipts/[id]/retry`                                                              | `previous_kind`                                                                                |
| `receipts_exported`                     | `GET /api/receipts/export`                                                                   | `format`, `count`                                                                              |
| `plan_limit_hit`                        | `QuotaExceeded` in `failureResponse`, `organizationLimit` returning true, `limitInvitations` | `limit` (`uploads` / `workspaces` / `invites`), `plan`                                         |
| `$ai_generation`                        | each OCR attempt (see §2)                                                                    | `$ai_*` with null input and output                                                             |
| `$pageview`, `$pageleave`               | client, if enabled                                                                           | sanitised URL                                                                                  |
| `pricing_cta_clicked`, `support_opened` | client, if enabled                                                                           | `plan` / `topic`                                                                               |

The key funnel is `$pageview(/)` → `user_signed_up` → `receipt_uploaded` → `receipt_read` → (`receipts_exported` |
`invite_sent`). `plan_limit_hit` is the upgrade signal.

## 6. CSP, consent, privacy page

- **CSP stays as it is** (`connect-src 'self'`, `script-src 'self' …`): PostHog goes through the `/_r` rewrite and
  Sentry through the `/_e` tunnel. We don't need `worker-src blob:`, because recording is off. If the owner later wants
  direct hosts instead of proxies, add `https://us.i.posthog.com https://us-assets.i.posthog.com` and
  `https://*.ingest.sentry.io`. When CSP moves to nonces, the dynamic chunks are same-origin `_next/static` and are
  covered by `'self'`.
- **Consent:**
  - Server-side PostHog (user id, no IP or GeoIP, no cookies) and Sentry (errors, no PII) fall under legitimate interest
    for a SaaS. Disclose them on `/privacy`.
  - Client PostHog sets an identifier in cookie/localStorage, so in the EU/UK it needs consent unless it runs in a
    cookieless or memory mode. The options are an owner decision (see below). Implement opt-in with
    `opt_out_capturing_by_default: true` + `posthog.opt_in_capturing()` from a small banner, or start with
    `persistence: "memory"` and switch with `set_config` after consent. Verify the exact option names
    (`cookieless_mode`, `opt_out_capturing_by_default`) against posthog-js 1.442.1 typings when implementing; the
    fetched docs pages didn't cover them.
- **`/privacy` and terms:** list PostHog, Sentry and Axiom as sub-processors only when enabled. Data region: pick EU
  hosts if users are EU (`eu.i.posthog.com`, Sentry EU org, Axiom EU edge).

## 7. Env vars (`.env.example`, all optional, commented as such)

```bash
# --- Observability (all optional; unset = off, zero overhead) ---
# Axiom: ships the wide-event log lines. Both required together.
AXIOM_TOKEN=            # ingest-only token scoped to one dataset
AXIOM_DATASET=
AXIOM_URL=              # optional: regional edge / self-hosted endpoint
# PostHog: server events + LLM analytics. Client analytics is a separate switch.
POSTHOG_KEY=            # project token (phc_…)
POSTHOG_HOST=https://us.i.posthog.com   # or https://eu.i.posthog.com; also drives the /_r rewrite
NEXT_PUBLIC_POSTHOG_KEY=                # set (same value) to enable browser analytics; build-time
# Sentry: errors. Tracing off unless a rate is set.
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=                 # optional browser errors; build-time
SENTRY_TRACES_SAMPLE_RATE=              # e.g. 0.05; default 0
# Build/CI only (never runtime): source-map upload
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
```

- `lib/env.ts` validation: every var is optional. A **partial** config (`AXIOM_TOKEN` without `AXIOM_DATASET`, or
  `NEXT_PUBLIC_POSTHOG_KEY` without `POSTHOG_HOST`) fails boot in production, matching `loadEnvOrExit`, and warns in dev.
- **Docker gotcha:** `NEXT_PUBLIC_*` is inlined at `next build`, so the client switches must be build args in
  `docker/Dockerfile.prod`. Setting them at `docker run` does nothing. The server vars work at runtime.
- **Vercel:** add the vars to the Production/Preview envs. Set the `SENTRY_AUTH_TOKEN` handling per the source-map
  decision.

## 8. Efficiency notes

- With everything unset, no adapter module is imported, `track`, `generation` and `captureError` are a no-op call, no
  `after()` is registered, and the client bundle has no PostHog or Sentry code (enforced by a CI check).
- With everything set, the request path does in-memory enqueues only. Network work happens in one `after()` flush per
  request (Axiom batch + PostHog batch in parallel, each bounded by a 2 s timeout). Sentry sends asynchronously on capture.
- Cold start: lazy imports load on the first event, not at boot. Sentry is the exception, since it must init in
  `register()` to hook modules, and only when `SENTRY_DSN` is set.
- PostHog volume: about 3–5 events per upload. `$ai_generation` is one per attempt (usually one).
- Sentry cost: errors only by default. Expected 4xx are never captured. `ignoreErrors` covers the Next control-flow
  errors (`NEXT_REDIRECT`, `NEXT_NOT_FOUND`).

## 9. Testing

- **Unit (vitest):**
  - With no env set, `telemetry` never imports adapters. Mock `@axiomhq/js`, `posthog-node` and `@sentry/nextjs` with
    factories that throw on load, run a route through `runRoute`, and assert that nothing throws and nothing was loaded.
  - With fake keys, adapters receive the expected payloads. Assert that `$ai_input` is null and that no prop key
    matches `/email|merchant|amount|name/`.
  - `scrub.ts`: Drizzle `params:` redaction, query and hash stripping, `/reset-password` and `/accept-invitation/:id`
    normalisation.
  - Partial-config validation in `env.test.ts`.
- **Bundle guard (CI, after `bun run build` with all unset):** `! grep -rqE "posthog|sentry" apps/web/.next/static`.
  This proves the dead-code elimination holds.
- **e2e:** the compose stack runs with every observability var unset. The Playwright suite must pass unchanged, with no
  test edits. Optionally, add one spec under a `OBSERVABILITY_E2E=1` flag that builds with a fake
  `NEXT_PUBLIC_POSTHOG_KEY`, intercepts `/_r/**`, and asserts that there is no email and no query string in the payloads.
- **Sentry on Bun:** a compose smoke test (see §3).

## 10. Tracks (PR-sized)

**Track A: telemetry core + Axiom + server PostHog** (sonnet; touches `lib/log.ts`, `lib/http.ts`, `lib/auth.ts`, the
routes, `lib/env.ts`)

- Add `lib/telemetry/{index,config,scrub,axiom,posthog}.ts`, make `logger` an alias, and add `scheduleFlush` in
  `runRoute`, `runBackground` and route `respond`.
- Emit the server event catalogue and `$ai_generation`. If the per-attempt cost work hasn't landed, send tokens only;
  PostHog then computes the cost.
- Update `.env.example` with the Axiom and PostHog server vars, add the unit tests and the bundle guard.
- Pins: `@axiomhq/js@2.0.0`, `posthog-node@5.60.1`.

**Track B: Sentry** (opus, because of the scrubbing and the Bun and source-map behaviour; it builds on A's interface)

- Add `sentry.server.config.ts`, the `instrumentation.ts` changes, `captureError` from `failureResponse` and
  `runBackground`, `global-error.tsx`, the conditional `withSentryConfig` + tunnel, optional client init, the CI
  source-map step per the owner decision, and the Bun smoke test.
- Pin: `@sentry/nextjs@11.10.0`.

**Track C: client PostHog + consent** (sonnet; independent of B, after A)

- Conditional `instrumentation-client.ts`, the rewrites and `skipTrailingSlashRedirect`, identify/reset, `before_send`
  URL sanitising, the consent mechanism per the owner decision, the two UI-intent events, `/privacy` updates, and the
  Docker build args.
- Pin: `posthog-js@1.442.1`.

B and C can run in parallel once A merges. Re-check the pins at implementation time: newer patch versions will have
cleared the 7-day window.

## Owner decisions

1. **Client PostHog at all?** Server-only covers the whole funnel except landing-page traffic, with no consent banner.
   Recommended start: server-only, then add the client later.
2. **If client:** consent banner (opt-in) or cookieless/memory mode. Also US or EU region.
3. **Person properties:** user id only (recommended), or also email for support lookups (PII in PostHog).
4. **Sentry source maps:** a scoped token in the build step, or a separate `sentry-cli` upload step.
5. **Sentry tracing:** off (recommended) or a low rate on Vercel (0.05). Keep `VercelAI` spans or drop them.
6. **Client-side Sentry:** worth the bundle (about 30 KB gzip, errors only), or server-only.
7. **Vercel plan:** if we move to Pro, use a Vercel Drain to Axiom instead of the in-app sink (the code path stays and
   just remains unset).
8. **Workspace names** in PostHog groups: off (recommended) or on.
