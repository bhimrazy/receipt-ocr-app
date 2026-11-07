# Full architecture review (2026-11-07, `main` at 2b5c57c)

Read-only review of the code against [AGENTS.md](../../AGENTS.md), [docs/architecture](../architecture/README.md),
[STATUS](../STATUS.md) and the recent plans (BYOK, jobs queue, usage design, dual-calendar, two-tier OCR). Numbers
are from `wc`, `git log` and `knip` (clean) on this checkout.

## Verdict

The boundaries hold. Every route handler runs one Effect program through `runRoute`/`withRequestEvent`, nothing
outside `packages/ai` imports the AI SDK, storage keys are built only by `receiptObjectKey`, and every `after()`
drives a recorded job row. The weak spots are (a) a default model chain that contradicts the docs and the
benchmark, (b) a provider boundary whose per-model settings are hard-coded constants, which blocks BYOK and
escalation, (c) 23k lines of dead landing variants, and (d) a STATUS page a day behind a very fast day.

## 1. Code boundaries: findings, ranked

1. **Default chain is Sonnet 5.5 first; docs and benchmark say otherwise.**
   `packages/core/src/settings.ts:124` (`DEFAULT_PRIMARY_MODEL = "anthropic:claude-sonnet-5-5"`, from #93).
   [ai.md:162](../architecture/ai.md) says no Claude model is in the default chain; STATUS says "Gemini stays the
   default"; the two-tier review notes Haiku 5.5 ($0.0006) and Flash-Lite ($0.0014) scored the same as Sonnet
   ($0.011) on 31 receipts. Until an admin saves a chain, every unconfigured deployment pays ~10x for no measured
   gain. Decide (owner), then make code and docs agree.
2. **Provider-specific tuning lives in constants, not in the model table.** `packages/ai/src/extract.ts:95-105`
   (`ANTHROPIC_OPTIONS`, effort `low` per model), `:125` (`GROQ_OPTIONS`), `:148-171` (`checkFile` with
   per-provider type and size limits as `if (model.startsWith(...))`). `OcrStep` is `{ model, enabled, timeoutMs }`
   (`settings.ts:79`). Adding OpenAI means a fourth branch in three places; per-step effort has nowhere to go.
3. **Keys are env-only and plumbed as a provider map.** `ocr.ts:166` (`providerKeys` from `keyEnv`),
   `extract.ts:22` (`ProviderKeys = Partial<Record<RegistryProviderId, string>>`), `extract.ts:76` (registry cache
   keyed by a hash of the key set, bounded LRU: fine for platform keys, wrong unit for workspace keys as the BYOK
   plan §4.7 says). `connections.ts:94` casts `provider.id` to the three literal providers.
4. **Gemini's image budget leaks into the browser encoder.** `apps/web/lib/upload-prep.ts:7-17` derives
   `PIXEL_BUDGET` from Gemini tile maths. Harmless today, but it is provider knowledge outside `packages/ai`; move
   the budget to the model table (`OcrModel.maxPixels`) and let core pick the minimum over the active chain.
5. **Direct DB access from `apps/web` beyond the allowed places.** Allowed: `lib/auth.ts:71` (adapter).
   Grey: `lib/workspaces.ts:24,43` and `app/app/settings/page.tsx:40-47` run their own Drizzle queries for
   membership counts and names. The architecture page lists this as a known exception; a `listMemberships`
   in core's `workspace.ts` would close it in 30 lines.
6. **`console.*` outside the logger.** Acceptable by design (boot, build, client): `instrumentation-node.ts:10`,
   `lib/env.ts:47,114,140,344,363`, `components/pwa.tsx:66`, the three `error.tsx` boundaries. Questionable:
   `packages/email/src/index.ts:46-47,84` has its own console sink and `email.not_configured` line instead of
   taking the core logger; the web app passes `log` so production is fine, but tests and scripts bypass the schema
   allowlist.
7. **`after()` is used only to run recorded jobs** (`api/receipts/route.ts:82`, `[id]/route.ts:54`,
   `retry/route.ts:54`, `admin/jobs/actions.ts:104`) plus `lib/page-event.ts:29` (the page wide event). Compliant.
8. **Thick-ish adapters.** `app/admin/actions.ts` (543 lines) wraps Better Auth admin calls with audit rows in the
   action file; `api/contact/route.ts` (130 lines) does rate limit, honeypot, Turnstile and mail inline. Both are
   HTTP/auth glue rather than domain logic, but `contact` is the one route that bypasses `runRoute`.
9. **Storage key logic**: only `packages/storage/src/index.ts:52`. Clean.

## 2. Stale documentation

- `docs/STATUS.md`: header says "Last updated 2026-11-06 (after #36)"; the **In flight** table lists eleven
  branches that merged on 11-07 (#43, #46, #47, #59, #70, #73, #87, #91, #92, #96, #106). "Groq… not run against the
  real API yet" and "Gemini stays the default" are both wrong after #93/#106.
- `docs/architecture/README.md:22` "There is no separate worker or queue today" (the queue shipped in #37, the
  drain route in #96); `:174` lists "worker app and cron drain" as planned (the drain exists; only `apps/worker`
  is missing); `:178` "Second AI provider — planned" (Anthropic and Groq are in the allowlist).
- `docs/architecture/ai.md:162,198`: "none in the default chain" for Claude is false since #93.
- `docs/architecture/web.md`: no mention of the SEO host logic from #103 (`lib/seo-hosts.ts`, `app/robots.ts`,
  `app/sitemap.ts`, `llms.txt`, the `www` redirect in `next.config.ts`); only the lab `noindex` line.
- `docs/architecture/flows/deployment.md`: does not describe label-only previews (#80, #104) or the
  "skip a production deploy that ships nothing" gate.
- Current and accurate: `flows/jobs.md` (drain route, pg_cron, worker loop), `email.md` (build-time prerender),
  `flows/upload-and-extraction.md` and `web.md` (capture pipeline), `data-model.md` (`numeric(12,2)` is right).

## 3. Provider abstraction: ready for what?

`extractReceipt` is a clean one-call boundary: one model, classified failure, usage even on failure, chain owned
by core. What is not ready:

- **OpenAI**: a registry entry (`extract.ts:76`), a `check.ts` adapter, a models-table block, and new branches in
  `providerOptionsFor` and `checkFile`. Two of those should not exist. Move `providerOptions`, accepted media
  types, max bytes/edge and `schemaMode` onto `OcrModel` so a provider is data plus a factory.
- **Per-step effort**: add `effort?: "low" | "medium" | "high"` to `OcrStep` (zod at `settings.ts:65`) and pass it
  through `ExtractReceiptInput`; the admin form grows one select. Today effort is fixed `low` per Claude model.
- **BYOK**: `Ocr.extract` must take a key source (plan §4.6). The `ProviderKeys` map keyed by provider cannot hold
  two keys of one provider; the registry cache should be bypassed for workspace keys; cooldowns need a
  `key:<id>` scope (`receipt-extract.ts:46-49` keys them by provider). None of this is hard, but do the
  `OcrModel` refactor first so the key work does not touch the same lines twice.
- **Escalation on failed checks**: `runChain` (`ocr.ts:111`) is availability fallback only; `FALLBACK_KINDS`
  (`ocr.ts:37`) never includes "well-formed but wrong". There is no checks module yet (grep for arithmetic/cascade
  finds nothing). Add `packages/ai/src/checks.ts` (pure, with the service-charge trap from the two-tier review),
  return `checks` on `ExtractReceiptResult`, and let `runChain` take a `shouldEscalate(result)` predicate. The
  bench needs `--cascade` before this ships.

Order: (1) `OcrModel` carries options and limits; (2) checks as pure functions with a bench run; (3) `effort` on
`OcrStep`; (4) key source and per-key cooldowns; (5) OpenAI.

## 4. Jobs and worker

`drainOnce`/`runWorkerLoop` (`packages/core/src/jobs/drain.ts`) are framework-free, abort-aware and finish the pass
in progress on shutdown; `tick` fences every write on `locked_by`+`attempts`. An `apps/worker` is ~60 lines:
build the runtime, `runWorkerLoop({ registry: JOB_REGISTRY, worker: "worker:<host>", idleMs: 2000, signal })`,
plus a health port. Ready.

Vercel Hobby fit: upload and retry routes declare `maxDuration = 300` (`api/receipts/route.ts:32`) and drain to
290 s after the request; the drain route is 60 s to match pg_net; `vercel.json` uses the one daily cron for
recovery and pg_cron for the minute tick. Every budget is derived from one constant per route, which is right.
Move off Vercel for execution (not hosting) when any of these happen: pg_cron drains hit `capped: true`
regularly (10 jobs/minute ceiling), a model step needs more than 50 s (PDF batches), or BYOK makes per-workspace
concurrency matter. Then `apps/worker` on the existing 1 vCPU box; the web routes keep `after()` as a warm start
only. The 100 deploys/day limit is already handled by label-only previews.

## 5. Dependency weight and build

`node_modules` is 938 MB, mostly Playwright, sharp, React Email dev tooling and three AI SDK providers. Runtime
deps in `apps/web` are lean (Next 16, Better Auth, Effect, lucide, recharts, zod). CI builds Next three times per
run (checks, e2e, e2e-turnstile) with a Turbopack cache per job and no Turbo remote cache; the only bundle check is
the React Email grep. Add a server-bundle size budget (`du -sh .next/server` is already printed; assert on it) and
reuse one build artefact across the e2e jobs.

## 6. Simplicity: delete and simplify

- `apps/web/components/marketing` (12.6k lines, of which `v2` 11.1k) plus `app/(lab)` (117 lines): eleven landing
  variants reachable only with `LAB_PAGES=1`; the live homepage imports none of them. That is 17% of all TS and
  the largest directory in the repo. STATUS decision 2 has been open since 11-06; pick Classic or keep the current
  page, then delete the rest.
- `packages/ai` model-specific branches (above). `packages/core/src/admin-ops.ts` (881 lines) and
  `admin-queries.ts` (599) are the two largest files; both are SQL for admin charts, fine for now.
- Not over-engineered: the job queue (one table, one kind), telemetry allowlist, settings cache. The Effect usage is
  consistent and shallow.

## Action list (priority order)

1. Owner decision on the default chain; align `settings.ts:124`, `ai.md`, STATUS (cost is 10x today).
2. Update STATUS (header, In flight → Shipped), README.md lines 22/174/178, `ai.md:162`, `web.md` SEO section,
   `flows/deployment.md` preview label.
3. Move provider options, media types and size limits onto `OcrModel`; delete the `startsWith` branches.
4. Pure `checks.ts` + bench `--cascade`; run on the 31 receipts before any escalation code.
5. `effort` on `OcrStep` and through `ExtractReceiptInput`.
6. `KeySource` in `Ocr.extract`, per-key cooldown scope, uncached registry for workspace keys (BYOK phase 1).
7. Decide the homepage; delete `components/marketing` and `app/(lab)`.
8. `apps/worker` skeleton on the compose stack; keep Vercel `after()` as warm start.
9. Core `listMemberships`/`workspaceSummary`; remove Drizzle from `lib/workspaces.ts` and `settings/page.tsx`.
10. CI: one Next build artefact shared by e2e jobs; assert a server-bundle size budget; move `upload-prep.ts`
    pixel budget onto the model table.
