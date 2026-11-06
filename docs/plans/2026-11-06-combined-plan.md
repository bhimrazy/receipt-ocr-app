# Combined plan — usage, models, cost, observability, product (2026-11-06)

Sources (same folder / ../reviews): ai-usage-models, observability, extraction-cost-accuracy, members-admin-plan,
reviews/2026-11-06-{cto,ceo,market}.md.

## Positioning (market + CEO)

Freelancers and sole traders first, especially cross-border (many currencies/languages). Sell clean, importable rows:
line items + tax + category on every plan, per-currency totals, big allowance for a small price. Models are an internal
cost/quality lever, not a customer picker.

## Architecture decisions

1. **One append-only `ocr_calls` table**, one row per model call (success or failure): receipt_id (no FK, survives
   deletes), organization_id (cascade), user_id (set null), round, step, model, provider, status/error kind,
   latency_ms, input / cached / output / reasoning tokens (null = unknown), cost_micro_usd, price_from, created_at.
   Written in the existing complete/fail transaction as one multi-row insert. Indexes (organization_id, created_at),
   (created_at), (receipt_id).
2. **Quota and `OCR_DAILY_CAP` count from `ocr_calls`/attempts, not `receipts`** — closes the delete-to-reset P0.
3. **Price table in `packages/ai/models.ts`** with effective dates; pure `costOf(usage, model, at)`; cost stored at
   write time in micro-USD, never silently recomputed. `bench/prices.json` replaced by the same table.
4. **`packages/ai` returns usage on success and on its error type** (`OcrCallError {kind, usage, cause}`); read
   `result.usage` before `result.output`. Never double-count reasoning tokens (already inside output in ai v7).
5. **Model registry with capabilities** (pdf, heic, providerOptions such as low thinking). Providers keyed by `keyEnv`;
   only booleans leave the server. Ship Gemini 3.8 Flash + 3.5 Flash-Lite now; Anthropic Haiku 5.5 next, OpenAI after.
   Each model admitted by the benchmark.
6. **Telemetry interface `apps/web/lib/telemetry/`**: log / track (typed events, ids only) / generation / captureError
   / flush. Lazy adapters, no-op when unset, flushed in `after()`. Axiom = logs (`@axiomhq/js`), Sentry = errors only,
   PostHog = product events + our own `$ai_generation` (no inputs/outputs), server-side first.
7. **Client-side image prep**: EXIF rotate, long edge ≤ 2000px, JPEG 0.85 → fixes Vercel 4.5 MB 413s and strips GPS.
   Accept PDF in the upload panel (server already does).
8. **Accuracy**: deterministic checks in core (items→subtotal, subtotal+tax+tip→total, qty×price, date, currency
   magnitude) drive "needs review"; later a cheap-first cascade (Flash-Lite → Flash when checks fail).
9. **No Docling / OCR-first pipeline / cloud receipt APIs.** No BullMQ yet (Postgres queue first when triggers fire).
10. **Delete**: design-lab code (`app/(lab)`, `components/marketing`, ~41% of TS), unused BYOK table/column,
    `lib/receipt-permissions.ts` duplicate (after homepage decision).

## Surfaces

- Customer: receipts used / remaining (workspace), per-receipt confidence and fields to check, model in details line.
- Admin: tokens, cost per receipt, by model (failures, fallback rate, p50/p95 latency), by workspace, daily cost chart.

## Tracks (order)

1. Usage capture: `ocr_calls` migration, ai usage/error types, cost table, quota from ocr_calls, bench reads table.
2. Upload: client image prep + PDF in upload panel.
3. Usage surfaces: admin usage pages + customer usage summary (after design review).
4. Telemetry A (interface + Axiom + server PostHog), then Sentry, then optional browser PostHog.
5. Accuracy checks + thinking level + benchmark set of 20–30 real PII-free receipts; then cascade.
6. Second provider (Anthropic), then OpenAI.
7. Members/seats + per-workspace quota (members plan); monthly limits + billing after owner decisions.
8. Product: fix landing claims, free no-signup tool, duplicate detection, per-currency totals, accounting exports.

## Security requirements (reviews/2026-11-06-security-plan.md)

- T1: quota ledger row written at claim time + per-user advisory lock; `organization_id` SET NULL (not cascade) so
  deleting a workspace can't reset quota; `OcrCallError.message` = kind only (AI SDK causes embed receipt JSON);
  no free-text columns; privacy page updated (usage record kept after receipt deletion).
- T2: re-encode every image (not only large ones) or strip metadata server-side; don't claim GPS stripping otherwise.
- T4: Sentry gets synthetic `ocr_failed:<kind>` errors, `beforeSend` drops AI_* values, never extraErrorData;
  `/_r` and `/_e` as route handlers forwarding body + content-type only (no cookies/IP), pinned host, size cap,
  rate limit, Sentry tunnel pinned to our DSN; scrub tokens in URL paths, PostHog URL props, breadcrumbs;
  scrub every event in `emit()` before Axiom; no browser capture on /admin or while impersonating; no remote config;
  IP discard on; no `category` in events; browser analytics opt-in; source maps uploaded only in production.yml.
- T6: OpenAI `store: false`; paid Gemini project; privacy page names every provider in the chain.
- T5/T6: PDF page cap, `maxOutputTokens`, `.max()` lengths in the schema.
- T8: every export format through `cell()`.

## Owner decisions

Cost visibility (admins only?), second provider, direct keys vs AI Gateway, PostHog browser or server-only, daily vs
monthly limits + prices + payment provider, workspace-owned plans, Classic homepage, branch protection on main.
