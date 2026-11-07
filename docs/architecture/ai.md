# packages/ai

The provider boundary. It makes **one** extraction call with **one** model through the
[AI SDK](https://ai-sdk.dev), validates the output against a Zod schema, reports token usage, and classifies any
failure into a small set of kinds. It also holds the list of models an admin may choose and their prices.

It does not choose models, retry across models, enforce deadlines across a chain or write anything. That is
[packages/core](core.md)'s job.

## Checking a provider key

`checkProvider(providerId, { apiKey, models })` in [`check.ts`](../../packages/ai/src/check.ts) calls the provider's
free model-list endpoint (Gemini `GET /v1beta/models` with `x-goog-api-key`, Anthropic `GET /v1/models` with
`x-api-key`, Groq `GET /openai/v1/models` and OpenAI `GET /v1/models`, each with a bearer token), so no tokens are spent. It returns a status only (`ok`, `invalid-key`, `no-billing-or-quota`,
`rate-limited`, `unreachable`, `model-not-available`) and a latency; response bodies are read for keywords and
dropped, because they can echo the key. The AI SDK providers expose no model-list call, hence plain `fetch` with a
5 s timeout. Used by Admin → Settings → Connections.

## Contents

- [Public API](#public-api)
- [Key modules](#key-modules)
- [Data flow](#data-flow)
- [The prompt](#the-prompt)
- [Design principles and invariants](#design-principles-and-invariants)
- [How to test it](#how-to-test-it)
- [Common changes](#common-changes)

## Public API

| Entry point                  | Exports                                                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@receipt-ocr/ai`            | `extractReceipt`, `receiptExtractionSchema`, `ReceiptExtraction`, `PROMPT_VERSION`, `OcrCallError`, `classifyOcrError`, `OCR_FAILURE_KINDS`, `ModelId`, plus everything below |
| `@receipt-ocr/ai/models`     | `OCR_PROVIDERS`, `OCR_MODELS`, `ocrModel`, `priceAt`, `costOf`, `priceCall`, `ExtractionUsage`. No runtime imports                                                            |
| `@receipt-ocr/ai/categories` | `RECEIPT_CATEGORIES`, `CATEGORY_DESCRIPTIONS`, `normalizeCategory`, `parseCategory`. No runtime imports                                                                       |

The two sub-entry points are dependency-free so client components can import them without pulling the AI SDK into
the browser bundle.

```ts
extractReceipt({
  model: "google:gemini-3.8-flash", // `provider:model`, or "fixture"
  file: { data, mediaType },
  keys: { google: googleKey, anthropic: anthropicKey },
  timeoutMs,
  maxRetries,
  abortSignal,
  promptVersion, // optional, defaults to PROMPT_VERSION; the benchmark passes "v1" for an A/B
}): Promise<{ extraction; usage; model; promptVersion }> // throws OcrCallError
```

## Key modules

| File                                                   | What it holds                                                                                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`prompt.ts`](../../packages/ai/src/prompt.ts)         | `PROMPT_VERSION`, the versioned prompts (`promptFor`) and the sources they follow                                                                                       |
| [`extract.ts`](../../packages/ai/src/extract.ts)       | The provider registry (one per key set, in a 16-entry LRU keyed by a SHA-256 of the keys), per-model Claude options, `generateText` with `Output.object`, usage mapping |
| [`schema.ts`](../../packages/ai/src/schema.ts)         | `receiptExtractionSchema`: the single definition of an extraction, with length caps and field definitions (`FIELD_DESCRIPTIONS`)                                        |
| [`errors.ts`](../../packages/ai/src/errors.ts)         | `OCR_FAILURE_KINDS`, `classifyOcrError`, `OcrCallError`                                                                                                                 |
| [`models.ts`](../../packages/ai/src/models.ts)         | Providers, the model allowlist, effective-dated prices, `costOf`                                                                                                        |
| [`categories.ts`](../../packages/ai/src/categories.ts) | The twelve canonical categories and their descriptions (fed to the model)                                                                                               |
| [`fixture.ts`](../../packages/ai/src/fixture.ts)       | Offline provider: same bytes give the same canned receipt; bytes containing `FIXTURE_FAIL` fail                                                                         |

## Data flow

Both outcomes go back to core: a result, or an `OcrCallError` that core turns into an attempt and decides whether
to try the next model.

```mermaid
flowchart LR
  core[core Ocr.extract] -- "model id, file,<br/>key, timeout" --> extract[extractReceipt]
  extract -- "model = fixture" --> fixture[fixtureExtraction]
  extract -- "provider:model" --> sdk[AI SDK generateText<br/>with the Zod schema]
  sdk -- HTTPS --> gemini[Gemini API]
  sdk -- HTTPS --> claude[Anthropic Messages API]
  sdk -- HTTPS --> groq[Groq chat completions]
  sdk -- HTTPS --> openai[OpenAI Responses API]
  sdk -- "valid object" --> ok([extraction, usage, model])
  fixture --> ok
  fixture -- "FIXTURE_FAIL" --> classify
  sdk -- "any error" --> classify[classifyOcrError]
  classify --> err([OcrCallError: kind, usage])
```

Failure kinds and how they are decided ([`errors.ts`](../../packages/ai/src/errors.ts)):

| Kind               | From                                                                                                                                                                | Core falls back?    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `timeout`          | HTTP 408, `TimeoutError` or `AbortError`                                                                                                                            | Yes                 |
| `rate-limited`     | HTTP 429                                                                                                                                                            | Yes                 |
| `provider-error`   | HTTP 5xx (Anthropic 529 overloaded included), network errors, the fixture's simulated failure, anything unrecognised                                                | Yes                 |
| `not-configured`   | HTTP 401, 402 (Anthropic billing), 403, 404, missing key, unknown model or provider                                                                                 | Yes                 |
| `refused`          | A `content-filter` finish (Claude's refusal, Gemini's safety stop), whether its text parses, is prose or is empty                                                   | Yes (job: dead now) |
| `unsupported-file` | HTTP 413, or before any request: a type or size this model can't take (HEIC, a PDF on Groq, an image over 10 MB base64 on Claude, or over 30,000 patches on OpenAI) | Yes (job: dead now) |
| `invalid-output`   | No object, no content, schema or JSON parse failure (Groq `json_validate_failed`; an OpenAI 2xx the SDK cannot parse, such as a refusal)                            | Yes                 |
| `bad-image`        | Any other 4xx (400, 422): the provider refused the input                                                                                                            | No                  |

## The prompt

[`prompt.ts`](../../packages/ai/src/prompt.ts) holds each prompt version; the app always uses `PROMPT_VERSION`
(`v2`). The version goes back in every result as `promptVersion`, on the wide event as `ocr.prompt_version` (only
when a model was called) and in the benchmark's raw results. It is not stored per receipt yet (no column).

v2, the request both providers get:

- **System prompt / system instruction:** a one-paragraph role and task, then the rules in XML tags (`<general>`,
  `<amounts>`, `<items>`, `<dates>`, `<currency>`, `<merchant>`). XML is one consistent delimiter, which Gemini's
  guide asks for, and Claude's guide recommends for exactly this mix of rules.
- **User turn:** the file, then one line: today's date (for the no-future-dates rule) and "Extract the receipt
  above." Claude works best with the image before the text; Gemini wants text before a single image, which the
  system instruction already is.
- **Field definitions in the JSON schema** (`.describe()`), so both providers read the same definitions next to
  each field. They follow the benchmark's key rules: total is the printed grand total, subtotal a printed pre-tax
  goods line or null (never a sum of the items), tax every VAT/GST line summed, service charge, discounts and
  rounding in no field, tip only a printed tip, items as printed, merchant the trading name. The Anthropic SDK
  appends the bounds Claude's structured outputs don't enforce (`max length: 300.`) to the description.
- **Dates:** the Gregorian date; with both an AD date and a Bikram Sambat Miti, the AD date with the Miti settling
  day and month order; Nepali POS dates are often MM/DD/YYYY; a BS-only receipt gives null for now (a code BS to AD
  conversion is planned); no date after today or before 2000 without a four-digit year.
- **Prompt injection:** text in the image is data, never instructions (`INJECTION_GUARD`, checked by a test).
- **Kept from v1:** the separator rules (field-tested on IDR and KWD), the length caps and the item cap.
- **Not used:** example images (each would cost an image's tokens on every call), CAPS or MUST.

Sources, checked 2026-11-07: Anthropic's [prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices),
[vision](https://platform.claude.com/docs/en/build-with-claude/vision) and
[structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs); Google's
[prompting strategies](https://aistudio.google.com/docs/prompting-strategies),
[image understanding](https://aistudio.google.com/docs/image-understanding) and
[structured output](https://aistudio.google.com/docs/structured-output).

v1 (one text block before the file, no system prompt, no field definitions) stays selectable for the benchmark:
`bun run bench:ocr --prompt v1`. Results: [`bench/results/2026-11-07-prompt-v1-vs-v2.md`](../../bench/results/2026-11-07-prompt-v1-vs-v2.md).

### Change the prompt

Add a version to `PROMPT_VERSIONS` and its branch in `promptFor` (and in `receiptRequestSchema` if the schema's
definitions change), run the benchmark with `--prompt` on the old and new version, and switch `PROMPT_VERSION`
only if the new one is better or equal on totals.

## Design principles and invariants

- **One call, no routing.** `extractReceipt` never tries a second model. Core decides from the failure kind.
- **Usage is read before output.** Reading `result.output` throws on an empty or truncated reply, which was still
  billed, so `usage` is captured first. A schema failure's usage is recovered from `NoObjectGeneratedError`.
- **Reasoning tokens are inside output tokens.** `priceCall` charges `outputTokens` only; adding `reasoningTokens`
  would double-count. Cached input is charged at the cached rate and subtracted from input.
- **Unknown is not free.** `costOf` returns `null` (not 0) when the model, a price for that day, or the token counts
  are missing. Core stores the null.
- **Prices are effective-dated.** Each model lists price rows newest first; `priceAt` picks the first row whose
  `from` day is on or before the call's UTC day. A price change is a new row, so old calls keep their old price.
- **Error messages never contain receipt contents.** `OcrCallError.message` is the kind plus an HTTP status; the AI
  SDK's own messages can embed model output. The original error is kept as a non-enumerable `cause`.
- **Output is bounded.** `maxOutputTokens` is 16,384, the schema caps string lengths and allows at most 300 items, so
  a crafted image can't produce unbounded cost or rows.
- **A refusal is a failure.** A `content-filter` finish (Claude's `stop_reason: "refusal"`, Gemini's safety stop) is
  `refused` with its usage, never an extraction. Text that parses is caught after the call; prose or empty text fails
  parsing first, so `classifyOcrError` reads the finish reason off `NoObjectGeneratedError`.
- **The model list is an allowlist.** Admin settings validate model ids against `OCR_MODELS`; a typo can't reach a
  provider.

## Anthropic (Claude)

Three models, none in the default chain: `anthropic:claude-haiku-5-5`, `anthropic:claude-sonnet-5-5`,
`anthropic:claude-opus-5-5` (bare ids, never date-suffixed). An admin adds them in **Admin → Settings → OCR models**
once `ANTHROPIC_API_KEY` is set. The request settings live in `ANTHROPIC_OPTIONS` in
[`extract.ts`](../../packages/ai/src/extract.ts), one entry per model:

- **Structured output** through `output_config.format` (a JSON schema), set explicitly with
  `structuredOutputMode: "outputFormat"`. The SDK's older path was a forced `json` tool call, and Sonnet 5.5 and
  Opus 5.5 answer forced `tool_choice` with HTTP 400. The request has no `tools` and no `tool_choice`.
- **Effort `low`** on all three. Reading a receipt is transcription; the API defaults are `medium` (Haiku 5.5,
  Opus 5.5) and `high` (Sonnet 5.5). Raise it per model only if the benchmark shows a gain worth the tokens.
- **No `thinking` field, no sampling parameters.** Thinking stays adaptive (Sonnet 5.5 and Opus 5.5 reject
  `disabled` and `budget_tokens`); non-default temperature, top-p or top-k are a 400. No assistant prefill.
- **Skipped steps:** a pre-flight skip throws an `OcrCallError` with `skipped: true` (its cause is an
  `UnsupportedFileError`): no request was sent. Core records it with no model (see
  [data model](data-model.md)). A 413 is `unsupported-file` but not skipped: the request reached the provider.
- **Files:** images as base64 image blocks (JPEG, PNG, GIF, WebP); PDFs as a base64 `document` block, inside the
  32 MB request and 600-page limits (uploads are at most 10 MB and 10 pages). An image may be at most 10 MB
  base64-encoded ([vision docs](https://platform.claude.com/docs/en/build-with-claude/vision), checked 2026-11-07),
  about 7.5 MB raw, while uploads may be 10 MB raw, and at most 8000 px on either edge (read from the PNG, JPEG,
  WebP or GIF header by [`image-size.ts`](../../packages/ai/src/image-size.ts); a larger image is a 400). HEIC/HEIF
  and over-limit images fail before any request as `unsupported-file`, so the chain moves on to a model that can
  read them.
- **Errors:** 429 is `rate-limited` with its `retry-after`; 529 and other 5xx `provider-error`; 400 `bad-image`
  (the SDK does not retry it); 401/402/403 `not-configured`; 413 `unsupported-file`; a refusal `refused`.
- **Usage:** Anthropic's `input_tokens` exclude cache reads and writes; the ledger's `inputTokens` is their sum,
  with `cache_read_input_tokens` and `cache_creation_input_tokens` split out, and thinking tokens inside output.
- **Prices:** Haiku 5.5 $0.10 / $0.50 per MTok up to a 100K-token prompt and $0.50 / $2.50 for the whole call
  beyond (`longContext`); Sonnet 5.5 $2 / $10 and Opus 5.5 $4 / $20, cache reads $0.20 for both. Haiku 5.5 cache reads
  are 0.1x input ($0.01, $0.05 past 100K). 5-minute cache writes are 1.25x input on all three. No request sets
  `cache_control`, so there are no cache reads or writes today. A row without a cache rate charges those tokens as
  input.
- **Not used:** Anthropic's server-side refusal `fallbacks`. Core's chain is the fallback, and a fallback served by
  another model inside one call would be recorded under the wrong model and price.

## Groq

One model, not in the default chain: `groq:qwen/qwen3.8-27b` ("Qwen 3.8 27B (Groq, preview)"). An admin adds it in
**Admin → Settings → OCR models** once `GROQ_API_KEY` is set. It uses `@ai-sdk/groq` 4.0.74 (Vercel, `vercel/ai`).
Facts below are from Groq's docs ([vision](https://console.groq.com/docs/vision),
[models](https://console.groq.com/docs/models), [structured outputs](https://console.groq.com/docs/structured-outputs),
[rate limits](https://console.groq.com/docs/rate-limits)), checked 2026-11-07. Nothing here has run against the real
API yet; the first benchmark is the check.

- **Which models.** Groq lists two with image input: `qwen/qwen3.8-27b` (a preview model, "for evaluation only", 3
  images a request, 2,048 tokens an image, 131K context, 16K max output) and `meta-models/muse-spark-open` (limited
  preview, access by contacting Groq, so not offered). Every other model on the models page is text-only or audio.
  Prices for Qwen: $0.80 input / $4.00 output per MTok. The free plan bills nothing, so the ledger's cost there is an
  upper bound.
- **Free plan limits** (rate-limits page): `qwen/qwen3.8-27b` 30 requests a minute, 1K a day, 8K tokens a minute, 200K
  a day. A receipt is about 2,048 image tokens plus the v2 prompt (~3.5K) plus the reply, so one read nearly fills a
  minute's token budget: expect `rate-limited` under any concurrency. Limits are per organization.
- **Structured output:** `response_format: json_schema` with `strict: false` (best-effort), set by `GROQ_OPTIONS`.
  Qwen also supports `strict: true` (constrained decoding), which needs every keyword in the schema to be supported;
  switch to it only after a benchmark shows the schema is accepted. `maxItems` is dropped from the request
  (`schemaMode: "no-bounds"`: no `maxItems`, `maxLength`, `minimum` and the like; Groq's docs list no supported keywords for best-effort mode), and the reply is validated against the full zod schema either way. No tools.
- **Reasoning:** `reasoning_effort: "none"` (instruct mode) so transcription does not burn the token-per-minute budget.
- **Files:** images only (JPEG, PNG, GIF, WebP); the SDK rejects other file parts. PDFs and HEIC fail before any
  request as `unsupported-file`, so the chain moves on. Groq documents a 20 MB limit on a request with an image (a
  400 beyond it), checked on the base64 size; it states no pixel limit or base64-specific limit.
- **Errors:** 429 is `rate-limited` with `retry-after` (seconds), which makes the provider cool; 5xx `provider-error`;
  401/403/404 `not-configured`; 413 `unsupported-file`. A 400 is read by its `error.code`: `json_validate_failed`
  (best-effort output broke the schema) is `invalid-output`, which now falls through to the next model;
  `model_decommissioned` (Groq answers 400, not 404, for a retired model) and any other `invalid_request_error` that
  doesn't blame the image are `not-configured`; a 400 that names the image is `bad-image`. The key check treats a 429 naming a daily
  cap (TPD, RPD) as `no-billing-or-quota`.
- **Benchmark:** `GROQ_API_KEY=... bun run bench:ocr --models groq:qwen/qwen3.8-27b --concurrency 1`.

## OpenAI

Two models, not in the default chain: `openai:gpt-6-luna` ("GPT-6 Luna", cheap and fast) and `openai:gpt-6.1-terra`
("GPT-6.1 Terra", stronger). An admin adds them in **Admin → Settings → OCR models** once `OPENAI_API_KEY` is set. It
uses `@ai-sdk/openai` 4.0.106 (Vercel, `vercel/ai`, published 2026-10-30) over the Responses API, the provider's default.
Facts below are from OpenAI's docs ([models](https://developers.openai.com/api/docs/models),
[images and vision](https://developers.openai.com/api/docs/guides/images-vision),
[PDF files](https://developers.openai.com/api/docs/guides/pdf-files),
[structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[error codes](https://developers.openai.com/api/docs/guides/error-codes),
[your data](https://developers.openai.com/api/docs/guides/your-data)), checked 2026-11-07. Nothing here has run
against the real API yet; the first benchmark is the check.

- **Which models and prices** (per MTok, standard): Luna $0.10 input / $0.01 cached / $0.50 output; Terra $1.00 /
  $0.05 / $5.00. Both take text and image input, 1.05M context, 128K max output. Prompts over 272K input tokens cost
  2x input and cache and 1.5x output, as `longContext` rows. Batch and Flex are half price (not used). `gpt-6.1-sol`
  ($2 / $10) and `gpt-6-astra` ($10 / $50) are not offered: too dear for transcription.
- **Reasoning:** `reasoning.effort: "none"` (`OPENAI_OPTIONS`). Luna and Terra accept `none`, `low`, `medium`, `high`,
  `xhigh`, `max`; the default is `medium`. Receipt reading is transcription, so no reasoning tokens are billed.
  "none" is not benchmarked against "low" yet; compare them before relying on it.
- **Structured output:** `text.format` `json_schema` with `strict: true`. Strict mode wants every key in `required`
  and `additionalProperties: false`, which the zod schema already gives. The docs list `pattern`, `format`,
  `minimum`/`maximum` and `minItems`/`maxItems` as supported and length bounds as unsupported "for fine-tuned models
  only", which is not proof for these models, so `schemaMode: "no-bounds"` sends none of them and the reply is
  validated against the full zod schema. Loosen to `"full"` after a live check.
- **Data:** `store: false`, so the response is not kept as application state (otherwise 30 days).
- **Files:** JPEG, PNG, WebP and GIF (non-animated; not checked). The docs set no per-file byte cap on an image
  (512 MB a request) but reject one over 30,000 patches of 32 px after processing; a larger one is skipped as
  `unsupported-file` before any request (checked from the header). PDFs are accepted on vision-capable models through
  the Responses API (`input_file`), up to 50 MB; the API reads both the text and the page images. HEIC is skipped.
- **Errors** (body `{ error: { message, type, param, code } }`, read only when the request URL is `api.openai.com`):
  429 `rate_limit_exceeded` / `slow_down` is `rate-limited` with `retry-after`, which makes the provider cool; a 429
  with `insufficient_quota`, `credit_balance_exhausted` or a spend/usage-limit code is `not-configured` (waiting does
  not help); 5xx (`server_is_overloaded` is 503) `provider-error`; 401/403/404 `not-configured`; 413 and 400
  `context_length_exceeded` `unsupported-file`; any other 400 that doesn't name the image (a schema keyword, an effort
  value) is `not-configured`; a 400 that names the image is `bad-image`. The SDK's Responses schema has no refusal
  part, so a refusal is a 2xx it cannot parse; any 2xx parse failure is `invalid-output`, which falls to the next
  model. The key check treats a 429 naming a quota as `no-billing-or-quota`.
- **Retention (privacy policy):** not used for training unless opted in; abuse-monitoring logs up to 30 days;
  zero data retention only with OpenAI's prior approval. Use a project key with a spend limit.
- **Benchmark:** `OPENAI_API_KEY=... bun run bench:ocr --models openai:gpt-6-luna,openai:gpt-6.1-terra`. The dry run
  counts one token per 32 px patch (the docs give no multiplier for these models).

## How to test it

`bun run test` runs [`extract.test.ts`](../../packages/ai/src/extract.test.ts) (with a mock model through
`extractWith`), [`extract.anthropic.test.ts`](../../packages/ai/src/extract.anthropic.test.ts) (the real Anthropic
provider over a mocked `fetch`: the request body each Claude model gets, usage, refusal and HTTP error mapping),
[`extract.groq.test.ts`](../../packages/ai/src/extract.groq.test.ts) and [`extract.openai.test.ts`](../../packages/ai/src/extract.openai.test.ts) (the same for Groq and OpenAI), [`errors.test.ts`](../../packages/ai/src/errors.test.ts),
[`models.test.ts`](../../packages/ai/src/models.test.ts) and
[`categories.test.ts`](../../packages/ai/src/categories.test.ts). None calls a provider. For real accuracy, latency
and cost, use the [OCR benchmark](tooling.md#ocr-benchmark).

## Common changes

### Add a model from an existing provider

1. Add an entry to `OCR_MODELS` in [`models.ts`](../../packages/ai/src/models.ts) with its id
   (`google:<model>`), label and a price row dated the day you checked the provider's pricing page.
2. Run the benchmark against it: `bun run bench:ocr --models google:<model>`.
3. Deploy. An admin turns it on and orders it in **Admin → Settings → OCR models**; nothing else changes.

### Add a provider

1. Install the AI SDK provider package (exact pin, at least 7 days old).
2. In [`models.ts`](../../packages/ai/src/models.ts): add the id to `OcrProviderId`, an entry to `OCR_PROVIDERS` with
   its `keyEnv`, and its models.
3. In [`extract.ts`](../../packages/ai/src/extract.ts): add it to `buildRegistry` (the `satisfies` clause makes this
   a type error until you do).
4. In core: nothing for a provider with a `keyEnv`; `Ocr.Live` ([`ocr.ts`](../../packages/core/src/ocr.ts)) and
   `providerAvailability` ([`settings.ts`](../../packages/core/src/settings.ts)) read every `keyEnv`.
5. Add the key variable to both `.env.example` files, `docker-compose.yml`, [deployment.md](../deployment.md) and the
   [runbook](../runbook.md) rotation table.
6. Add new failure mappings to `classifyOcrError` if the provider reports errors differently.

Core reads keys and availability by looping over `OCR_PROVIDERS[].keyEnv`, so step 4 is only needed for a provider
with no key env var.

**Planned:** OpenAI and a capabilities field per model (file types, so core can skip a step instead of failing it)
([AI usage and models](../plans/2026-11-06-ai-usage-models.md)).

### Change the extraction schema

Change [`schema.ts`](../../packages/ai/src/schema.ts). If a field is stored in a column, update `ReceiptRepo.complete`
([`repository.ts`](../../packages/core/src/repository.ts)), the receipts table (a migration) and the CSV export. The
whole extraction is also stored as `receipts.raw_json`.
