# Receipt OCR: extraction cost, server cost, accuracy (2026-11-06)

Scope: code read from `receipt-ocr-backend` (read-only). No `GOOGLE_GENERATIVE_AI_API_KEY` in the environment and no
committed results in `bench/results/`, so **no live benchmark was run**. Token and dollar figures below come from
provider docs plus the measured size of our prompt and schema. Treat them as estimates until `bun run bench:ocr` runs
on real receipts.

## TL;DR

1. The LLM call is about 98% of cost per receipt. Vercel compute is about $0.00005 per receipt, R2 is close to zero.
   Spend effort on the model call, not on infrastructure.
2. The biggest cost lever is **thinking tokens**. Gemini 3.6/3.8 Flash think at `medium` by default and bill thinking
   as output ($3.75/M, **$7.50/M from 2027-01-01**). Setting `thinkingLevel` to `minimal` or `low` probably halves cost.
3. **Check the model id now.** `google:gemini-3.7-flash` is not on Google's models or pricing page (both checked
   today; they list `gemini-3.6-flash` and `gemini-3.8-flash`). The 2026-11-04 market review flagged the same thing.
4. For accuracy, add **deterministic arithmetic checks** and use them both for "needs review" and to decide when to
   escalate to a stronger model. Today "needs review" relies only on the model's own confidence score.
5. **Docling and other OCR pre-passes: no.** They save about $0.0002 per receipt in tokens. They cost a Python worker,
   cold starts, and measurably worse text on photographed receipts.
6. **Vercel caps request bodies at 4.5 MB**, but the app advertises and accepts uploads up to 10 MB. On Vercel, a 5–10 MB
   phone photo fails with 413. Client-side downscaling fixes this and also cuts storage, latency and EXIF/GPS leakage.

## Baseline: what one receipt costs today (estimate)

Measured inputs: the prompt is about 1,300 chars, about 660 of them the category list. The JSON schema is about 1,080
chars. Together that is about **600 text tokens**. Gemini 3 bills an image at a fixed **1,120 tokens** at the default
`media_resolution` (`unspecified`, which is `high`), whatever its pixel size. Output is about 150–250 tokens for a
short receipt and about 900 for a 34-line one (from the size of the fixture JSON). Thinking tokens at `medium` are
unknown, assumed 500–1,000. The bench already counts `thoughtsTokenCount`, so a single run will measure them.

| Model (Standard tier, per 1M tokens)                | In / Out        | Input $ | Output+thinking $ | ≈ $/receipt      |
| --------------------------------------------------- | --------------- | ------- | ----------------- | ---------------- |
| gemini-3.6 / 3.8 Flash, thinking medium (today)     | $0.75 / $3.75   | 0.0013  | 0.0028–0.0047     | **~0.004–0.006** |
| same, from 2027-01-01                               | $1.50 / $7.50   | 0.0026  | 0.0056–0.0094     | **~0.008–0.012** |
| same, thinking `low`/`minimal`, media `medium`      | $0.75 / $3.75   | 0.0009  | ~0.0010           | ~0.002           |
| gemini-3.5 Flash-Lite (thinking minimal by default) | $0.30 / $2.50   | 0.0005  | ~0.0006           | **~0.001**       |
| gemini-3.1 Flash-Lite                               | $0.25 / $1.50   | 0.0004  | ~0.0004           | ~0.0008          |
| Flex or Batch tier                                  | −50%            |         |                   | half of above    |
| AWS Textract AnalyzeExpense / Azure DI receipt      | $0.01 / page    |         |                   | 0.010            |
| Veryfi API                                          | $0.08 / receipt |         |                   | 0.080            |

Vercel Fluid (iad1, Standard instance about 2 GB): with no request concurrency, roughly 8 s wall time times 2 GB at
$0.0106/GB-h gives $0.000047. Add about 150 ms active CPU at $0.128/h, which is $0.000005, plus $0.0000006 for the
invocation. That is **≈ $0.00005 per receipt**, and less in practice because Fluid shares one instance across
concurrent requests. CPU is not billed while the function awaits Gemini.

R2: storing a 4 MB original for a year costs about $0.0007, and a 400 KB downscaled copy about $0.00007. Egress is
free. Writes are $4.50 per million Class A operations ($0.0000045 per receipt).

## Ranked changes

| #   | Change                                                                                                                | $/receipt impact                                                       | Accuracy impact                                                                               | Effort | Do          |
| --- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ | ----------- |
| 0   | Verify the model id (`gemini-3.7-flash` is not listed; pin `gemini-3.6-flash` or `3.8-flash`)                         | n/a (avoids failed calls)                                              | Avoids silent fallback or failure                                                             | XS     | **now**     |
| 1   | Fill `bench/prices.json` and add ~20–30 real, PII-free photos (faded thermal, skewed, crumpled, HEIC, multi-currency) | 0                                                                      | Prerequisite: the 5 synthetic 420 px PNGs cannot tell models apart                            | S      | **now**     |
| 2   | `thinkingConfig.thinkingLevel: "low"` (3.8 has no `minimal`) or `"minimal"` (3.6, 3.5-Lite)                           | **−40 to −60%** (−$0.002 to −0.004 now, double that in 2027)           | Expected neutral for transcription. Bench it, since thinking can help with locale decimals    | XS     | **now**     |
| 3   | Deterministic validation: items ≈ subtotal, subtotal+tax+tip ≈ total, date sanity, currency/locale sanity             | 0                                                                      | **High.** Catches the IDR `31.000 → 31.00` class of error. Gives "needs review" a real signal | S      | **now**     |
| 4   | Client-side downscale: EXIF-orient, long edge ≤ 2,000 px, JPEG q≈0.85, strip metadata                                 | ~0 Gemini tokens (flat 1,120 per image). −90% storage and upload bytes | Neutral if ≥ ~1,600 px long edge. Correct rotation helps                                      | S      | **now**     |
| 5   | `mediaResolution: MEDIA_RESOLUTION_MEDIUM` (560 tokens per image)                                                     | −$0.0004 now / −$0.0008 in 2027 (~10–15%)                              | Risk on long, dense receipts. Bench first; keep `high` for escalation                         | XS     | after bench |
| 6   | Cheap-first cascade: Flash-Lite first, escalate to Flash only when #3 fails or a required field is missing            | **~−60 to −75%** if ≤ 20% escalate (≈$0.0015 vs $0.005)                | Neutral or better, since failures get a second, stronger look                                 | M      | after #1–#3 |
| 7   | Duplicate detection: SHA-256 of bytes (exact) plus fuzzy match on merchant/date/total                                 | Saves a whole call per exact dupe                                      | Fewer double-counted expenses (user-visible)                                                  | S      | soon        |
| 8   | Send PDFs natively (don't rasterize). Enable PDF on the client (`ACCEPT` omits it today)                              | Native PDF text is **free** on Gemini 3; 560 tokens/page               | Better than raster for born-digital receipts                                                  | XS     | soon        |
| 9   | Presigned direct-to-R2 PUT for originals > 4.5 MB (mostly PDFs after #4)                                              | ~0                                                                     | Removes 413 failures                                                                          | M      | when needed |
| 10  | Flex tier or Batch API for bulk/queued uploads (via a worker)                                                         | −50%                                                                   | Same model, same accuracy. Latency 1–15 min (Flex) or ≤ 24 h (Batch)                          | M–L    | with worker |
| 11  | Trim schema/prompt (drop per-item `confidence`; shorter category text)                                                | −$0.0002 or less                                                       | Slight risk to category consistency                                                           | XS     | optional    |
| —   | Prompt caching                                                                                                        | none                                                                   | —                                                                                             | —      | skip        |
| —   | Docling / Tesseract / Paddle / Surya / docTR pre-pass                                                                 | −$0.0002 tokens, plus worker hosting                                   | Worse on photos                                                                               | L      | **no**      |
| —   | Cloud receipt APIs (Textract, Azure, Document AI, Veryfi, Mindee, Taggun)                                             | **+2 to 20×**                                                          | Comparable on clean receipts, no locale-decimal advantage                                     | M      | no          |

### Suggested order

**Week 1:** #0, #1, #2, #3, #4 are all small and independent. **Next:** run the bench on real photos with thinking
`low` vs `medium` and media resolution `medium` vs `high`, then decide #5 and #6. **Later:** #7, #8, and #9/#10 once
bulk upload or a worker becomes real.

## 1. Docling and OCR pre-passes: verdict **No**

<details><summary>Why</summary>

- **Token savings are tiny.** A text pre-pass replaces about 1,120 image tokens with about 300–800 OCR-text tokens.
  On Flash-Lite that saves about $0.0002 per receipt, or $20/month at 100k receipts. A Python worker running Docling
  (PyTorch plus layout, TableFormer and OCR models, around 1–2 GB of image and RAM) costs more than that before ops.
- **Accuracy gets worse on photos.** Receipts are photographed thermal paper, not born-digital documents, and that is
  where Docling is weakest. The ImageToTable 2026 SROIE benchmark (vendor-run, 361 receipts, RTX 4090) measured:
  - Docling CER 0.591, against 0.19–0.20 for docTR, PaddleOCR and Surya2.
  - Field F1 of about 0.57–0.62 for the best OCR-then-LLM pipelines, with Tesseract at 0.44.
  - Docling took 732 ms/page on GPU. The Docling paper reports **3.1 s/page on x86 CPU** for general documents.

  A text pre-pass also discards layout cues (columns, which number belongs to which line) that the vision model uses
  for line items and for the locale-decimal problem we already hit.

- **Ops burden.** A separate Python service, model downloads, cold starts measured in seconds to tens of seconds, and
  a second deploy target. It breaks the "packages/ai is the one provider boundary" rule unless wrapped as yet another
  provider.
- **Docling's main strength is already covered.** Its value is layout/table parsing of born-digital PDFs. Gemini 3
  already extracts native PDF text and does not bill for it.
- **Cloud OCR/receipt APIs** cost about $0.01/page (Textract AnalyzeExpense, Azure DI prebuilt receipt). Veryfi is
  $0.08/receipt. That is 2–80× our Flash-Lite cost, and they return their own schema, which we would still have to map
  and categorise.
- **Revisit only if:** a customer needs on-prem/no-LLM processing, we need word-level bounding boxes for field
  highlighting (Gemini can return boxes too), or we take on large multi-page born-digital invoices.

</details>

## 2. Image handling

<details><summary>Details and estimates</summary>

- **Tokens by provider for a 12 MP phone photo (3024×4032):**
  - Gemini 3: a flat 1,120 at default/`high`, 560 at `medium`, 280 at `low`. Pixel size does not change the bill.
    PDFs are 560 tokens/page by default, and the embedded text is free.
  - Anthropic: `⌈w/28⌉×⌈h/28⌉`. Images are downscaled to a 1,568 px long edge / 1,568 tokens on the standard tier,
    and to 2,576 px / 4,784 tokens on 4.7+ high-res models.
  - OpenAI patch models: `⌈w/32⌉×⌈h/32⌉ × multiplier` (gpt-4.1-mini 1.62, gpt-5-mini 1.2). A 1000×2000 image is about
    2.4–3.3k tokens. Community reports say `detail: low` has no effect on patch models.
  - Downscaling matters for token cost only if non-Gemini providers join the chain. It matters for bytes everywhere.
- **Client pipeline (upload-panel.tsx):**
  1. `createImageBitmap(file, { imageOrientation: "from-image" })` applies the EXIF rotation.
  2. Draw to an `OffscreenCanvas` with the long edge at ≤ 2,000 px. Receipts are tall, so this keeps width around
     700–1,000 px and text legible.
  3. `convertToBlob({ type: "image/jpeg", quality: 0.85 })`. WebP is a few percent smaller, but JPEG is universal
     across providers.
  4. Skip grayscale. It barely saves bytes in JPEG, gives no token saving, and colour helps on stamps and highlighters.

  A 3–6 MB photo becomes about 250–600 KB. That puts it well under Vercel's 4.5 MB body cap and shortens upload time
  on mobile. Re-encoding also **strips EXIF GPS**, a privacy win.

- **HEIC:** Safari decodes HEIC in `createImageBitmap`, Chrome and Firefox do not. Try to decode. If that fails, upload
  the original, since Gemini accepts `image/heic` natively. OpenAI and Anthropic **do not accept HEIC**, so a
  non-Gemini fallback step would need server-side conversion. Note that in the allowlist when adding a provider.
- **PDF:** send it natively to Gemini (cheaper and more accurate than rasterizing, and multi-page works in one call).
  Rasterize only for a provider without PDF support. The client `ACCEPT` and `rejectionFor` currently block PDFs even
  though the server accepts them.
- **Server:** keep magic-byte sniffing and the size limit on whatever bytes arrive. Never trust client-side resizing.
  Set the advertised limit to ≤ 4.5 MB on Vercel until #9 exists.

</details>

## 3. Prompt, schema, thinking, caching

<details><summary>Details</summary>

- **Prompt plus schema** is about 600 tokens, roughly 26% of input. Trimming the category descriptions saves about
  165 tokens ($0.00012). Dropping per-item `confidence` saves about 6 output tokens per line (~20% of item output).
  Both are low priority.
- **Caching:** Gemini implicit caching needs ≥ 4,096 input tokens on 3.6/3.8 Flash. OpenAI's automatic caching needs
  ≥ 1,024. Anthropic `cache_control` minimums are higher than our prefix. The shared prefix is about 600 tokens, and
  the image differs on every call, so **nothing is cacheable**. Don't pad the prompt to reach the threshold.
- **Thinking:** this is the main lever. The AI SDK sets it with `providerOptions.google.thinkingConfig.thinkingLevel`.
  `thinkingBudget` only applies to 2.5 models. Defaults are `medium` on 3.6/3.8 Flash and `minimal` on 3.5 Flash-Lite;
  3.8 Flash has no `minimal`. Google advises "minimal thinking for fact retrieval or classification". Thinking tokens
  are billed as output even though only summaries are returned.
- **Usage recording:** `extract.ts` returns only `inputTokens` and `outputTokens`. Record reasoning tokens as well
  (`providerMetadata.google.usageMetadata.thoughtsTokenCount`) so production cost per receipt is visible, not only in
  the bench.
- **Temperature:** leave the default. Google recommends the default for Gemini 3, and structured output with low
  thinking is already near-deterministic. Bench it if variance shows up.

</details>

## 4. Accuracy

<details><summary>Validation, confidence, cascade, duplicates</summary>

- **Checks (pure function in `packages/core`, unit-tested):**
  - Σ items ≈ subtotal, or ≈ total when there is no subtotal. Allow ±0.02 or ±1% to cover rounding and discount lines.
  - subtotal + tax + tip − discounts ≈ total. Also accept tax-inclusive receipts (VAT included), where
    subtotal ≈ total.
  - `quantity × unitPrice ≈ totalPrice` per item.
  - The date parses, is ≤ today + 1 day, and is ≥ 10 years old at most.
  - The currency is ISO 4217, and the magnitude fits it. For example, an IDR/JPY/KRW total under 100 with decimals is
    suspicious, which is exactly the earlier IDR bug.
  - total > 0.
- **Confidence:** model self-reported confidence is poorly calibrated. Derive the stored score as
  `min(model confidence, rule score)`, and set "needs review" when any rule fails. Today the flag comes from
  `NEEDS_REVIEW_BELOW` on model confidence only.
- **Cascade (#6):** run the cheap model first. On a failed check or missing total, rerun once on the stronger model at
  `mediaResolution: HIGH` and pass the failed check as a hint ("items sum to X but total is Y"). Keep whichever result
  passes. Add this to `runChain` as an "escalate" kind next to `FALLBACK_KINDS`, so it stays a core workflow. Cap it at
  one escalation. Bench the escalation rate on real photos. It will likely be 5–20%.
- **Duplicates:**
  - Store `sha256(original bytes)` per workspace. On an exact match, return the existing receipt and skip OCR.
  - Hash before client resizing, or send the client's hash along. Otherwise re-encoding changes the bytes.
  - After extraction, flag (don't block) as a possible duplicate when the same workspace, currency and total
    (±0.01), a date within ±1 day, and merchant similarity ≥ 0.8 match. That similarity function already exists in
    bench `score.ts`.

</details>

## 5. Batch / async

<details><summary>When it pays</summary>

- **Gemini Batch:** −50%, up to a 24 h target, JSONL input up to 2 GB. **Flex:** −50%, synchronous interface,
  **1–15 min** latency, best-effort (it can be shed), and Google recommends client timeouts of 10 min or more. Neither
  fits the 60 s `maxDuration` route or the `after()` queued mode.
- At $0.001–0.005 per receipt, 50% off saves $50–250 per 100k receipts. A BullMQ + Redis worker is worth building when
  any of these holds:
  1. Bulk import (hundreds of receipts, or email/integration ingestion) becomes a feature.
  2. Volume exceeds about 100k receipts/month, so the discount pays for the worker and Redis.
  3. Provider rate limits or latency spikes start failing synchronous uploads.

  `extractStored(receiptId)` is already worker-ready, so the worker is mostly plumbing.

- Vercel Queues/Workflows are an option before standing up BullMQ, but AGENTS.md picks BullMQ, so stay with that.

</details>

## 6. Server cost

<details><summary>Details</summary>

- **Vercel Fluid:** active CPU is billed only while code runs, so it is not billed while awaiting Gemini. Memory is
  billed for the instance lifetime and shared across concurrent requests. That puts a synchronous 5–20 s call at about
  $0.00003–0.0001 per receipt. **Not worth optimizing.**
  - Keep `maxDuration = 60`. The 50 s OCR deadline is fine.
  - Don't raise memory.
  - Avoid CPU-heavy work in the function, such as server-side image resizing with sharp. That is another reason to
    resize on the client.
- **Presigned R2 upload:** this saves function bandwidth and removes the 4.5 MB cap. It adds a two-step flow (sign,
  PUT, then finalize) and orphan cleanup. Do it when large PDFs matter. Client downscaling solves the photo case first.
- **R2 vs S3:** R2 egress is free, which matters for history and image views served via signed URLs. S3 egress would
  be about $0.09/GB. Stay on R2. Consider deleting or downscaling originals after N days if storage ever matters.
- **Postgres:** already a single small pool per process with `prepare: false` for the Supabase transaction pooler.
  That is correct for Fluid. No change.
- **Caching:** nothing to cache on the extraction path. Exact-hash dedupe (#7) is the only result cache worth having.

</details>

## Sources

- Gemini pricing (Standard/Batch/Flex, 2027 price change): https://aistudio.google.com/docs/pricing
- Gemini models list (no 3.7 Flash): https://aistudio.google.com/docs/models
- Gemini media resolution tokens: https://aistudio.google.com/docs/media-resolution
- Gemini image understanding (HEIC support, tiling): https://aistudio.google.com/docs/image-understanding
- Gemini PDF (native text not billed, page tokens): https://aistudio.google.com/docs/document-processing
- Gemini thinking levels and defaults: https://aistudio.google.com/docs/thinking
- Gemini implicit caching minimums: https://aistudio.google.com/docs/caching
- Gemini Batch API: https://aistudio.google.com/docs/batch-api · Flex: https://aistudio.google.com/docs/flex-inference
- AI SDK Google provider options (thinkingConfig, mediaResolution, serviceTier): https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai
- Anthropic image tokens and formats: https://platform.claude.com/docs/en/build-with-claude/vision
- OpenAI image tokens and formats: https://developers.openai.com/docs/guides/images-vision
- Vercel Fluid pricing: https://vercel.com/docs/functions/usage-and-pricing · defaults: https://vercel.com/docs/fluid-compute
- Vercel 4.5 MB body limit: https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- AWS Textract pricing: https://aws.amazon.com/textract/pricing/ · Azure DI: https://azure.microsoft.com/en-us/pricing/details/document-intelligence/ (rates not rendered; $10/1k pages per secondary sources) · Veryfi: https://veryfi.com/pricing
- Receipt OCR benchmarks (vendor-run, directional): https://imagetotable.ai/references/traditional-ocr-vs-document-parsing-vlm
- Docling paper (CPU 3.1 s/page): https://arxiv.org/pdf/2501.17887

Not verified: Google Document AI Expense Parser price (the page didn't render), and Mindee/Taggun prices.
