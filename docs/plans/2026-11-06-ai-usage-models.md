# AI usage/cost tracking and multi-provider models (2026-11-06)

Base: `receipt-ocr-backend` @ `fix/receipt-processing` (e8e3962). Installed: `ai@7.0.154`, `@ai-sdk/google@4.0.106`,
`@ai-sdk/provider-utils@5.0.69`, `@ai-sdk/provider@4.0.34`, `@ai-sdk/gateway@4.0.127` (transitive, inside `ai`).

## 1. What the SDK gives us (verified in installed `ai@7.0.154` dist, not recalled)

`generateText(...).usage: LanguageModelUsage`:

```ts
inputTokens: number | undefined                // total, includes cached
inputTokenDetails: { noCacheTokens, cacheReadTokens, cacheWriteTokens }   // each number | undefined
outputTokens: number | undefined               // total, INCLUDES reasoning
outputTokenDetails: { textTokens, reasoningTokens }
totalTokens: number | undefined
raw?: JSONObject                               // provider's own shape
```

- v7 has no top-level `cachedInputTokens` / `reasoningTokens` any more; they live in the `*Details` objects.
- Google mapping (`convertGoogleUsage` in `@ai-sdk/google@4.0.106`): input = `promptTokenCount + toolUsePromptTokenCount`,
  cacheRead = `cachedContentTokenCount`, output = `candidatesTokenCount + thoughtsTokenCount`, reasoning = thoughts.
  `providerMetadata.google.usageMetadata` repeats the raw counts (plus `trafficType`, `serviceTier`).
- Anthropic: cache counts surface as `inputTokenDetails.cacheReadTokens` / `cacheWriteTokens` (ai-sdk.dev). OpenAI:
  reasoning in `outputTokenDetails.reasoningTokens`; cached prompt tokens in `cacheReadTokens`.
- Rule that follows: **cost = noCache x input + cacheRead x cached + cacheWrite x write + outputTokens x output**.
  Never add `reasoningTokens` on top of `outputTokens` (double count). Use `noCacheTokens` when present, else
  `input - cacheRead - cacheWrite`, so we don't depend on whether a provider's total includes cache.

Usage on failure (from the dist source):

| Failure                                    | Usage available?                                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON parse / schema mismatch               | Yes: `NoObjectGeneratedError.usage` (+ `finishReason`, `text`) — the call was billed                                                                      |
| `finishReason: "length"` or empty text     | `generateText` resolves; reading `result.output` throws `NoOutputGeneratedError` (no usage on the error). **Read `result.usage` before `result.output`.** |
| `APICallError` (4xx/5xx/429), `RetryError` | No usage (generally not billed)                                                                                                                           |
| Our timeout / abort                        | No usage. The provider may still bill a request it finished; unknowable, so tokens and cost stay `null`, not 0                                            |

`onLanguageModelCallEnd` exists too (usage per raw call, before output parsing), but the two cases above cover it
without a callback.

Gateway: inline `providerMetadata.gateway` carries `generationId` and `routing`, **not** cost; cost needs an extra
`gateway.getGenerationInfo({ id })` call. So even with the gateway we compute cost from our own price table.

## 2. Models and providers

### Packages (exact pins; cooldown cut-off = published on/before 2026-10-30)

Pick the versions built on the same `@ai-sdk/provider-utils@5.0.69` as the installed `ai`/`google` so Bun keeps one copy:

| Package                                         | Pin         | Published  | Notes                                                                                                        |
| ----------------------------------------------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `@ai-sdk/anthropic`                             | **4.0.89**  | 2026-10-26 | pu 5.0.69                                                                                                    |
| `@ai-sdk/openai`                                | **4.0.103** | 2026-10-26 | pu 5.0.69                                                                                                    |
| `@ai-sdk/mistral` (later, optional)             | 4.0.73      | 2026-10-26 | pu 5.0.69                                                                                                    |
| `@ai-sdk/xai` (later, optional)                 | 5.0.31      | 2026-10-26 | pu 5.0.69                                                                                                    |
| Vercel AI Gateway                               | none        | —          | `gateway` / `createGateway` already exported by `ai@7.0.154` (bundles `@ai-sdk/gateway@4.0.127`, 2026-10-26) |
| `@openrouter/ai-sdk-provider` (not recommended) | 3.1.0       | 2026-09-19 | peer `ai ^7.0.0`; third-party                                                                                |

Too new (all 2026-11-05, do not take): `ai@7.0.163`, `@ai-sdk/google@4.0.112`, `openai@4.0.109`,
`anthropic@4.0.97`, `mistral@4.0.80`, `xai@5.0.39`, `gateway@4.0.136`. Also avoid `openai@4.0.106` (2026-10-30 15:39Z,
under 7 days). If we'd rather bump everything together, the coherent 8-day-old set is pu 5.0.71: `ai@7.0.157`,
`google@4.0.108`, `openai@4.0.105`, `anthropic@4.0.92`, `mistral@4.0.75`, `xai@5.0.33` (all 2026-10-28/29).

### Candidates (prices USD per 1M tokens, from the providers' pages today)

| Registry id                                 | Image | PDF                                | Structured output                                               | Input / cached / output                                           | Quirks                                                                                                                                                                             |
| ------------------------------------------- | ----- | ---------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `google:gemini-3.8-flash`                   | yes   | yes                                | native `responseSchema`                                         | 0.75 / 0.075 / 3.75 **until 2026-12-31, then 1.50 / 0.15 / 7.50** | `thinkingLevel` (Gemini 3+); very large schemas rejected                                                                                                                           |
| `google:gemini-3.5-flash-lite`              | yes   | yes                                | native                                                          | 0.30 / 0.03 / 2.50                                                | cheapest current Lite                                                                                                                                                              |
| `google:gemini-3.1-flash-lite`              | yes   | yes                                | native                                                          | 0.25 / 0.025 / 1.50                                               | SDK table lists `-preview` id; confirm id                                                                                                                                          |
| `google:gemini-3.7-flash` (current default) | yes   | yes                                | native                                                          | **not on Google's pricing page**                                  | see owner decisions                                                                                                                                                                |
| `anthropic:claude-haiku-5-5`                | yes   | yes                                | native (`output_config.format`, `structuredOutputMode: "auto"`) | 0.10 / 0.01 / 0.50 (write 0.125; prompts ≤100k)                   | adaptive thinking, default effort `medium`: set effort low                                                                                                                         |
| `anthropic:claude-sonnet-5-5`               | yes   | yes                                | native                                                          | 2.00 / 0.10 / 10.00 (write 2.50)                                  | thinking can't be disabled; default effort `high` — expensive for OCR                                                                                                              |
| `openai:gpt-6-luna`                         | yes   | yes (file part, `application/pdf`) | strict JSON schema (`strictJsonSchema` default true)            | 0.10 / 0.01 / 0.50                                                | reasoning `none` allowed; strict mode needs `.nullable()` not `.optional()` (our schema already complies); check `z.string().length(3)` / min/max survive strict mode in the bench |
| `openai:gpt-6.1-terra`                      | yes   | yes                                | strict                                                          | 1.00 / 0.05 / 5.00                                                | `temperature` unsupported (dropped with a warning)                                                                                                                                 |
| `mistral:mistral-small-latest`              | yes   | URL only in docs (we send bytes)   | `json_schema`                                                   | not listed on pricing page                                        | skip for now                                                                                                                                                                       |
| `xai:grok-4.7`                              | yes   | not documented                     | yes                                                             | —                                                                 | skip (no PDF)                                                                                                                                                                      |

Recommendation: **ship Gemini (existing) + Anthropic Haiku 5.5 first**, as a cross-provider fallback (the chain's job is
surviving one provider's outage). OpenAI `gpt-6-luna` next — same PR is fine, it's one entry and one package. Mistral,
xAI, OpenRouter: no. Default chain order is decided by a bench run, not by these tables.

### Gateway vs direct keys

- Direct (recommended now): one env key per provider, our chain already does fallback/deadline, no extra processor for
  receipt images (PII), works the same in the Docker/Bun image.
- AI Gateway: one `AI_GATEWAY_API_KEY`, no new package, its own provider fallback. Costs: receipts pass through Vercel
  (privacy policy/DPA), cost not returned inline, two fallback layers to reason about. Easy to add later as just
  another provider row (`gateway:google/gemini-3.8-flash`, key `AI_GATEWAY_API_KEY`) because the registry is generic.

### Registry (`packages/ai/src/models.ts`), config-driven

```ts
export type OcrProviderId = "google" | "anthropic" | "openai" | "fixture";

export const OCR_PROVIDERS = [
  { id: "google", label: "Google Gemini", keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY" },
  { id: "anthropic", label: "Anthropic", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY" },
  { id: "fixture", label: "Offline fixture", keyEnv: null },
] as const;

/** USD per 1M tokens, which is also micro-USD per token. Newest first; `from` is the UTC day it applies. */
type Price = {
  from: string;
  input: number;
  cachedInput: number;
  cacheWrite?: number;
  output: number;
};

export interface OcrModel {
  id: `${OcrProviderId}:${string}` | "fixture";
  provider: OcrProviderId;
  label: string;
  pdf: boolean; // images are required of every entry
  providerOptions?: ProviderOptions; // e.g. low thinking; passed straight to generateText
  prices: readonly Price[];
}
```

- `buildRegistry` adds `anthropic: createAnthropic({ apiKey })`, `openai: createOpenAI({ apiKey })`; the existing
  `satisfies Record<RegistryProviderId, unknown>` keeps it exhaustive.
- `providerAvailability` and the keys in `Ocr.Live` loop over `OCR_PROVIDERS[].keyEnv` instead of hard-coding Google.
  Only booleans leave the server; key values are read only inside `Ocr.Live`.
- `activeChain(routing, available, mediaType)` also drops steps whose model has `pdf: false` for a PDF upload.
- Admin settings: no schema change (`ocrStepSchema` already validates against the allowlist; save already refuses an
  enabled model without a key). UI groups models by provider and shows "no key" rows disabled.
- `GEMINI_MODEL` env default stays for the no-settings-row case.

## 3. Pricing source

Hard-coded, effective-dated table in `packages/ai` (above), not fetched:

- None of Google/OpenAI/Anthropic publishes a stable price API; the gateway's `getAvailableModels()` is the gateway's
  price, not ours, and fetching adds a runtime dependency to a write path.
- Prices change on schedule (Gemini 3.8 Flash doubles 2027-01-01; Gemini 4 Argon 2026-12-01), so each model holds a
  list of `{ from, ... }` rows; `priceAt(model, date)` picks the newest `from <= date`.
- `costOf(model, usage, at) -> { microUsd: number | null; priceFrom: string | null }`, pure and unit-tested.
  `null` when tokens are unknown or no price row covers `at`. Rounded once with `Math.round` (error ≤ 0.5 µUSD per call).
- Stored at write time with `price_from`, never recomputed. A price correction is an explicit, dated backfill script.
- Unit test: every non-fixture model has a price row covering today. `bench/prices.json` goes away; the bench uses
  `costOf` and the returned usage (works for every provider, no more scraping `usageMetadata` off HTTP bodies).
- Long-context tiers (Haiku >100k, 3.1 Pro >200k) are ignored: a receipt is a few thousand tokens. Note it in the
  table's comment.

## 4. Schema

```ts
export const ocrAttempts = pgTable(
  "ocr_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // No FK: deleting a receipt must not erase what its calls cost.
    receiptId: uuid("receipt_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** receipts.attempts at the time: 1 = the upload, 2+ = retries. */
    round: smallint("round").notNull(),
    /** Position in the chain: 0 = primary, >0 = a fallback. */
    step: smallint("step").notNull(),
    model: text("model").notNull(), // `provider:model`
    provider: text("provider").notNull(),
    status: text("status").notNull(), // "ok" | OcrFailureKind
    latencyMs: integer("latency_ms").notNull(),
    inputTokens: integer("input_tokens"), // null = unknown (timeout/abort/API error)
    cachedInputTokens: integer("cached_input_tokens"),
    outputTokens: integer("output_tokens"), // includes reasoning
    reasoningTokens: integer("reasoning_tokens"),
    costMicroUsd: integer("cost_micro_usd"), // null = unknown; sums cast to bigint
    priceFrom: text("price_from"), // which price row was used
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ocr_attempts_org_created_at_idx").on(t.organizationId, t.createdAt), // workspace usage page
    index("ocr_attempts_created_at_idx").on(t.createdAt), // admin windows
    index("ocr_attempts_receipt_id_idx").on(t.receiptId), // cost on the results view
  ],
);
```

- `integer` for cost is fine per row ($2,147 max per call); aggregate as `sum(...)::bigint`.
- **No denormalized totals on `receipts`.** Per-receipt cost is one indexed lookup; usage pages aggregate this table.
  Revisit only if a list page needs cost per row.
- Size: ~150 B/row + indexes; 1M calls ≈ 250 MB. Retention: keep forever for now (it's the billing record); add a
  13-month prune or monthly rollup when the job runner (BullMQ) lands.
- Workspace deletion cascades (consistent with receipts). Account deletion keeps rows with `user_id = null`.
- Migration `0007_ocr_attempts.sql` via `drizzle-kit generate`. No backfill: old receipts have no token data; usage
  starts at deploy (show "since <date>").

## 5. Capture and write path

`packages/ai`:

- `ExtractionUsage` becomes `{ inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens }`
  (all `number | null`), mapped from `LanguageModelUsage` once.
- `extractReceipt` reads `result.usage` before `result.output`, and on any failure throws one error type:

```ts
export class OcrCallError extends Error {
  constructor(readonly kind: OcrFailureKind, readonly usage: ExtractionUsage | null, readonly cause: unknown) { ... }
}
```

`usage` comes from `NoObjectGeneratedError.usage` (unwrap `RetryError.lastError`) or the captured `result.usage` on
the `NoOutputGeneratedError` path; otherwise `null`. `classifyOcrError` stays, used inside.

`packages/core`:

- `StepFailure` gains `usage`; `OcrAttempt` becomes `{ model, step, kind, ms, usage }`. `runChain` already records
  every attempt with timing; it just carries usage. `OcrError.attempts` already reaches the failure path.
- `extractStored` turns attempts into rows (`costOf(model, usage, now)`, scope ids, `round = row.attempts`) and writes
  them **in the same transaction** as `repo.complete` / `repo.fail`: one multi-row insert, no extra round trip.
  Written even when `complete` finds the receipt superseded or deleted (the calls were still billed) — that's why
  `receipt_id` has no FK.
- Wide event: add `cost_micro_usd` next to `usage`.

## 6. Queries

Workspace usage (Settings > Usage; members of the workspace):

```sql
select date_trunc('day', created_at at time zone 'UTC') as day,      -- or 'month'
       count(distinct receipt_id) filter (where status = 'ok') as receipts,
       count(*) as calls,
       sum(input_tokens)::bigint as input_tokens,
       sum(output_tokens)::bigint as output_tokens,
       sum(cost_micro_usd)::bigint as cost_micro_usd,
       count(*) filter (where cost_micro_usd is null) as unpriced_calls
from ocr_attempts
where organization_id = $1 and created_at >= $2
group by 1 order by 1;
```

Admin by model (window `$1`):

```sql
select model,
       count(*) as calls,
       count(*) filter (where status <> 'ok') as failed,
       percentile_cont(0.5)  within group (order by latency_ms) filter (where status = 'ok') as p50_ms,
       percentile_cont(0.95) within group (order by latency_ms) filter (where status = 'ok') as p95_ms,
       sum(cost_micro_usd)::bigint as cost_micro_usd
from ocr_attempts where created_at >= $1
group by model order by cost_micro_usd desc nulls last;
```

Admin headline numbers (same window): fallback rate =
`count(*) filter (where status='ok' and step > 0) / nullif(count(*) filter (where status='ok'), 0)`; cost per receipt =
`sum(cost_micro_usd) / nullif(count(distinct receipt_id) filter (where status='ok'), 0)` (includes failed calls);
failure rate by `status`. By workspace: same aggregate grouped by `organization_id`, joined to `organization.name`,
top N by cost. All served by `created_at` / `(organization_id, created_at)`.

## 7. Tracks (PR-sized)

1. **Usage capture** (blocks the rest): `OcrCallError` + full usage + effective-dated prices + `costOf` in
   `packages/ai`; `ocr_attempts` table + migration; chain carries usage; attempts inserted in the complete/fail
   transactions; bench switches to `costOf`. Tests: `costOf` (cache, reasoning, null, price switch date), chain
   attempts on success/fallback/invalid-output, int test that rows are written for success, failure and superseded.
2. **Usage views**: workspace usage page (day/month) and an admin Usage section (by model, by workspace, failure and
   fallback rate, cost per receipt, p50/p95). Queries in `packages/core`, pages are thin.
3. **Multi-provider**: `@ai-sdk/anthropic@4.0.89`, `@ai-sdk/openai@4.0.103`; registry entries with `pdf` and
   `providerOptions` (low thinking/effort); generic key/availability; PDF filter in `activeChain`; bench across
   Gemini 3.8 Flash / 3.5 Flash-Lite / Haiku 5.5 / gpt-6-luna to set the default chain. Can run in parallel with 2.

## Owner decisions

1. `gemini-3.7-flash` (current default) is not on Google's pricing page: confirm its price or move the default to
   `gemini-3.8-flash` (note its 2027-01-01 doubling) or `gemini-3.5-flash-lite`.
2. Second provider first: Anthropic Haiku 5.5 (recommended) or OpenAI gpt-6-luna, or both in track 3.
3. Direct provider keys (recommended) vs Vercel AI Gateway (receipts go through Vercel).
4. Show estimated cost to workspace members, or tokens/receipts only (cost visible to admins)?
5. Retention: keep forever until the job runner exists (recommended) vs a fixed window now.
6. Pin new providers to the installed pu-5.0.69 line (recommended) vs bump everything to the pu-5.0.71 line.
