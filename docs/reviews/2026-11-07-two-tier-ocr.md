# Research review: two-tier OCR (LiteParse, OCRia-1) and what fits receipts

2026-11-07. The owner shared a LinkedIn post by Jerry Liu (LlamaIndex CEO). It describes "two types of OCR": a fast,
cheap first pass (pypdf, pymupdf, LlamaIndex's open-source LiteParse with open-weight OCR models) and accurate VLM
parsing for complex, business-critical documents (OCRia-1, which powers LlamaParse, benchmarked on ParseBench). This
review checks whether that split applies to ReceiptOCR. It also covers two LlamaIndex sources the owner added:
OpenDocRouter and the Document Parsing Protocol. The post, its chart and both sources come from a vendor, so all are
treated as claims. Nothing was installed, downloaded or run. Our numbers come from the 31-receipt benchmark in
[PR #85](https://github.com/bhimrazy/receipt-ocr-app/pull/85) (`bench/results/2026-11-07-real.md` on
`bench/results-2026-11-07-real`).

## Verdict

The split is right for LlamaIndex's market: long, born-digital PDFs where most pages have a text layer and a few need
a VLM. It doesn't fit ours. We get one phone photo per receipt and there is no text layer to read for free. Our whole
"accurate" call already costs less than LlamaParse's cheapest page: Haiku 5.5 reads a receipt for about $0.0006
(measured), and LlamaParse Fast is $0.0015 a page. The useful version of "two tiers" for us is **a cheap VLM first,
then escalation on deterministic checks**. We don't have that yet.

| When      | What                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Now**   | Deterministic checks on every extraction (items vs subtotal, subtotal + tax + tip vs total, date sanity). First measure their false-alarm rate on our ground-truth JSONs, which costs no model calls. Then wire them to "needs review".                                                                                                                                                                                         |
| **Now**   | Owner decision on the cheap first tier: Haiku 5.5, then Flash-Lite, as #85 suggests (both match Sonnet on these 31 receipts at 1/8 to 1/18 of its cost).                                                                                                                                                                                                                                                                     |
| **Next**  | Quality escalation: re-read with a stronger model (Sonnet or Opus 5.5) only when the checks fail. Benchmark it before shipping, to get the escalation rate and whether the second read fixes anything.                                                                                                                                                                                                                       |
| **Next**  | An on-device photo check (blur, darkness, no receipt outline) in the capture review step, built on the existing `detect-quad` luma code with no new dependency. It warns and doesn't block. The value is quicker feedback for the user, not saved cost.                                                                                                                                                                      |
| **Later** | One open-weight OCR model in the benchmark as an "OCR text, then a cheap LLM" comparator: **LightOnOCR-3-1B** (Apache-2.0, multilingual, 1B parameters). This is to learn, not to ship. It wins only if it beats one Haiku call on the Nepal set.                                                                                                                                                                           |
| **Never** | LiteParse, LlamaParse/OCRia-1 or OpenDocRouter in the receipt pipeline (the router is fine for bench runs on public sets). The Document Parsing Protocol as our provider interface: it is a markdown style guide with no API. tesseract.js as an OCR tier. Self-hosted GPU OCR at today's volume. Chandra, Surya or Indra weights in production without a Datalab licence.                                                                                                                                                                                                                       |

## Findings

### 1. Our chain is not a two-tier design yet

- The admin's model chain (`packages/core/src/ocr.ts`, `runChain`) is **availability fallback**. The next model runs
  only on `timeout`, `rate-limited`, `provider-error`, `not-configured`, `refused` or `unsupported-file`.
  `invalid-output` and `bad-image` stop the chain. A wrong but well-formed answer never escalates.
- "Needs review" comes from the model's own `confidence` score (see
  [review state](2026-11-07-review-state-and-flagging.md)). It doesn't come from a check we compute.
- The default chain today is Sonnet 5.5 first, then the env's Gemini model (`packages/core/src/settings.ts`). On the
  31 real receipts, Haiku 5.5 ($0.0006) and Flash-Lite ($0.0014) scored the same as Sonnet ($0.011) on total,
  merchant and items. So **the cheap first tier already exists in the allowlist.** What's missing is the signal that
  decides when to escalate.
- The deterministic checks were planned on 2026-11-06 ([extraction cost and accuracy](../plans/2026-11-06-extraction-cost-accuracy.md),
  change #3) and have not shipped. A trap to design around: the prompt puts service charge, discounts and rounding
  in **no field** (`packages/ai/src/prompt.ts`), and a 10% service charge is common on Nepali restaurant bills. A
  strict `total = subtotal + tax + tip` check would therefore fire on correct reads. Measure the check against
  ground truth before trusting it. Options are a tolerance band, a "residual" that is flagged rather than failed, or
  explicit `serviceCharge`/`discount` fields (a schema change).
- Where a stronger model helped in #85: Opus 5.5 got dates right more often (90% vs 74%), mainly by converting
  Bikram Sambat dates itself. The [dual-calendar dates plan](https://github.com/bhimrazy/receipt-ocr-app/pull/86)
  fixes that in code, which is cheaper than escalating. After it lands, the open question is whether escalation helps
  items and subtotal (Haiku 89% / 84%). **That needs a benchmark run.** Six Nepal receipts are too few to decide on.

### 2. LiteParse is a PDF parser with pluggable OCR, not a receipt reader

- Repo: [run-llama/liteparse](https://github.com/run-llama/liteparse), created 2026-02-09, Apache-2.0, about 13k
  stars (GitHub API, checked 2026-11-07).
  - Core in Rust. Bindings for Node/TypeScript (napi-rs), Python (PyO3) and WebAssembly (it runs in the browser),
    plus the `lit` CLI.
  - PDFs are parsed with PDFium. Office files need LibreOffice. Images (JPG, PNG, WebP and more) are accepted.
  - Output: markdown, JSON text with bounding boxes, or plain text.
  - The README states "no LLM features". It also says the markdown is heuristic, and that LlamaParse is more accurate
    for dense tables, multi-column layouts and scans. Nothing about receipts or phone photos.
  - Docs: [developers.llamaindex.ai/liteparse](https://developers.llamaindex.ai/liteparse/).
- OCR: built-in Tesseract by default, or any HTTP server that implements its
  [OCR API spec](https://github.com/run-llama/liteparse/blob/main/OCR_API_SPEC.md) (image in, text plus boxes out).
  The [`ocr/`](https://github.com/run-llama/liteparse/tree/main/ocr) folder ships five example servers. They are
  presumably the post's "5 open-weight OCR models":
  - **EasyOCR**: 80+ languages.
  - **PaddleOCR**: PP-OCRv5. LiteParse's benchmarks run it on ONNX Runtime.
  - **Surya OCR 2**: 91 languages, GPU recommended.
  - **Indra OCR**: about 18 MB of ONNX weights, CPU only. Covers Devanagari among ~55 languages.
  - **MiniCPM-OCR 1.0**: Chinese and English only. Needs a separate vLLM, SGLang, llama.cpp or Ollama server, and its
    README quotes about 1.2 pages/s on a GPU. The integration landed in PR #536.
  - All five are Python servers run with `uv`.
- Fit: wrong shape for us. A receipt photo has no text layer, so LiteParse's fast path (PDF text extraction) never
  applies. Its OCR path gives text and boxes, not fields, so a second LLM call would still be needed.
  - It also means running a Python OCR server next to Vercel, which breaks the "packages/ai is the one provider
    boundary" rule unless it's wrapped as a provider.
  - Possible later use: long born-digital PDF statements, where the text layer is free. Gemini already reads native
    PDF text without billing for it, too ([cost plan](../plans/2026-11-06-extraction-cost-accuracy.md)).

### 3. OCRia-1 and LlamaParse parse layout; they don't extract receipt fields

- OCRia-1 is "a 4-billion-parameter vision-language model" that is "powering LlamaParse today"
  ([LlamaIndex blog](https://www.llamaindex.ai/blog/parse-ocria-1)).
  - The post gives no licence and no weights. No OCRia model is listed under
    [huggingface.co/llamaindex](https://huggingface.co/llamaindex/models). **API-only as far as we can verify.**
  - Output is markdown and HTML (tables, LaTeX, charts as HTML tables). The post doesn't mention receipts or photos.
  - Pricing: "all at the same price" as LlamaParse, with no figure given. **Which LlamaParse tier uses OCRia-1 is
    unverified.**
  - [OpenDocRouter](https://www.opendocrouter.ai/models) lists it at $13.04 per 1,000 pages ($0.013 a page),
    84.67 ParseBench overall and 2.2 s a page (checked 2026-11-07). That is lower than the blog's 87.4.
    OpenDocRouter is also made by LlamaIndex, so this isn't an independent run, though
    [AlphaSignal](https://alphasignal.ai/news/llamaindex-s-ocria-1-parses-pdfs-75x-faster-than-gemini-at-a-third-the-cost)
    calls it one. See section 6.
- LlamaParse pricing ([pricing page](https://developers.llamaindex.ai/llamaparse/general/pricing/), checked
  2026-11-07):
  - Credits cost $1.50 per 1,000 on pay as you go and $1.25 on Pro.
  - Parse: Fast 1 credit a page ($0.0015), Cost-effective 3 ($0.0045), Agentic 10 ($0.015), Agentic Plus 25
    ($0.0375).
  - LlamaExtract, the schema-extraction product and the one that would return our fields: Cost-effective 8 credits
    ($0.012), Agentic 25 ($0.0375), Agentic Plus 60 ($0.09), Turbo 35.
- Data retention ([retention page](https://developers.llamaindex.ai/llamaparse/general/data_retention/)): uploaded
  sources and the parse cache are kept 48 hours, and `disable_cache` exists. Job-result retention is not published.
  The page doesn't say whether data is used for training (**unverified**). It would be a new processor for receipt
  photos, so the privacy page would need to name it.
- The [parsers landscape](../plans/2026-11-06-parsers-landscape.md) already set LlamaExtract as "try in bench, not
  for production" and LlamaParse as "no for receipts". Nothing in OCRia-1 changes that: it improves the parse step,
  and parsing is the step we don't have.

### 4. ParseBench measures enterprise page parsing, not receipts

- [parsebench.ai](https://www.parsebench.ai/) is "an open benchmark by LlamaIndex for evaluating document parsing and
  OCR systems on enterprise documents".
  - Five dimensions: tables, charts, content faithfulness, semantic formatting and visual grounding.
  - Deterministic rules, with a public dataset ([HF](https://huggingface.co/datasets/llamaindex/ParseBench)), code
    and a paper.
  - About 2,000 pages and 167k rules, published 2026-04-13
    ([LlamaIndex blog](https://www.llamaindex.ai/blog/parsebench), per the parsers landscape).
  - The site doesn't mention receipts.
- **The author of the benchmark also sells the leading entry.** That is a reason for caution, not proof the result is
  wrong.
- The other three benchmarks on the owner's chart are also document-to-markdown tests:
  - [olmOCR-bench](https://huggingface.co/datasets/allenai/olmOCR-bench): Ai2's unit tests over about 1,400 PDFs.
  - [PulseBench-Tab](https://arxiv.org/pdf/2606.07534): 1,820 multilingual tables, from Pulse, another parsing
    vendor.
  - [fr-bench-pdf2md](https://arxiv.org/html/2602.11960): French PDF-to-markdown.
- What that implies: a high score means faithful markdown of dense pages. It says nothing about getting `total`,
  `date` and `currency` right on a crumpled thermal photo, and nothing about Devanagari or Bikram Sambat dates. **Only
  our own benchmark answers that.**

### 5. A cheap on-device first pass: useful for UX, not for cost

- What one rejected bad photo saves: one Haiku call, about $0.0006, and failed reads are already free up to 5 a day.
  So on-device checks pay off in **speed of feedback**. The user hears "too blurry" in the review step, not 3 s later
  after an upload.
- The capture flow (#47) already runs an on-device pass. `apps/web/lib/capture/detect-quad.ts` downscales to about
  256 px luma, thresholds it and finds the receipt outline in a few milliseconds, and returns a confidence.
  - Two checks can be built on the same luma code with no dependency: a sharpness score (variance of a Laplacian)
    and a darkness score.
  - The 256 px detection image is probably too small to judge blur, so sample a larger crop.
  - **Thresholds need measuring** on the real set (false rejects of usable faded thermal receipts are the risk), so
    the checks warn rather than block.
- **tesseract.js** ([repo](https://github.com/naptha/tesseract.js), Apache-2.0, WebAssembly) could test for "is there
  text at all". Nepali (`nep`) and a Devanagari script model exist in
  [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast).
  - Costs: a multi-megabyte download of the WASM core and language data on phones (**size unmeasured**), CPU time on
    low-end Android, and no published accuracy on thermal receipt photos.
  - It isn't worth it to save $0.0006. **No**, unless non-receipt uploads turn out to be a measurable share of
    traffic. The ledger can show that: count `bad-image` failures.
- The browser's built-in `TextDetector` (Shape Detection API) is still "in progress" and behind
  `#enable-experimental-web-platform-features` in Chrome ([web.dev](https://web.dev/shape-detection)). It isn't
  usable on iOS or most users' phones.

### 6. OpenDocRouter: a LlamaIndex router in front of the parsers

- What it is: [opendocrouter.ai](https://www.opendocrouter.ai/models). The footer reads "Made by LlamaIndex". You
  pass a model id (for example `anthropic/claude-opus-5-5`) and it parses the page with that model.
  - Pricing is per token used ("Failed pages are never charged"), and each request must hold enough balance to cover
    the most a page could cost.
  - Sync requests take up to 50 pages, async up to 500.
  - The hosted open models (LightOn, NVIDIA, OpenDataLab, PaddlePaddle, rednote, infly, xingchen) can take up to
    45 s to cold-start, and fail with `model_starting` (not charged) if it runs longer.
- **Output is markdown, plus optional layout boxes** (`layout: true`) ([docs](https://www.opendocrouter.ai/docs)).
  There is no schema or field extraction, so our fields would still need a second LLM call. Inputs: PDF, PNG, JPEG.
- Privacy ([terms](https://www.opendocrouter.ai/terms), Addendum C; [privacy](https://www.opendocrouter.ai/privacy)):
  - Documents and results of sync requests aren't stored unless `cache` is on. Cached results are kept encrypted for
    24 hours. Uploaded files are deleted once read, or after an hour.
  - "We do not train any models on User Content". Third-party model providers handle pages "under their own data
    policies".
  - No DPA, no full subprocessor list, no region and no SLA are stated. Liability is capped at the greater of fees
    paid or $100. The privacy notice is dated 2024-03-30 and doesn't cover processing on a customer's behalf.
  - For receipt photos that means a second processor in front of Anthropic or Google, under weaker terms than our
    direct contracts. **No for production.**
- Lock-in: low technically (one HTTP call), but the scores, the prices and the router all come from the same vendor.
  The router also adds a hop and a markup decision we can't see. For Claude and Gemini we'd pay the router instead
  of the provider directly.

ParseBench scores on its models page (checked 2026-11-07), cheapest and most relevant first:

| Model (router id)                     | Open weights (see below)    | Overall | Tables | Faithfulness | $ / 1K pages | Typical page |
| ------------------------------------- | --------------------------- | ------- | ------ | ------------ | ------------ | ------------ |
| nvidia/nemotron-3.5-parse             | Yes, OpenMDW-1.1            | 73.00   | 80.66  | 87.77        | 0.73         | 3.9 s        |
| openai/gpt-6-luna                     | No                          | 72.07   | 82.05  | 86.16        | 0.80         | 7.6 s        |
| opendatalab/mineru2.5-pro             | Yes, Apache-2.0             | 70.05   | 76.90  | 88.25        | 0.86         | 3.9 s        |
| anthropic/claude-haiku-5-5            | No (in our app directly)    | 70.94   | 87.25  | 90.29        | 1.22         | 3.9 s        |
| paddlepaddle/paddleocr-vl-1.6         | Yes, Apache-2.0             | 65.50   | 68.38  | 86.89        | 2.11         | 2.4 s        |
| xingchen-agi/teleocr                  | not checked                 | 57.25   | 73.98  | 85.99        | 2.70         | 2.4 s        |
| lightonai/lightonocr-3-1b             | Yes, Apache-2.0             | 73.84   | 83.89  | 88.63        | 3.19         | 2.4 s        |
| rednote-hilab/dots.mocr               | Yes, MIT                    | 61.92   | 82.78  | 89.82        | 3.97         | 5.2 s        |
| mistral/mistral-ocr-4-1               | No                          | 62.22   | 85.40  | 89.23        | 4.00         | 1.8 s        |
| infly/infinity-parser2-flash          | not checked                 | 67.28   | 76.22  | 87.40        | 4.34         | 5.2 s        |
| mistral/mistral-ocr-4-1-annotations   | No                          | 69.14   | 85.68  | 89.02        | 5.00         | 2.9 s        |
| google/gemini-3.8-flash-low           | No (in our app directly)    | 73.85   | 88.25  | 88.58        | 5.91         | 6.3 s        |
| meta/muse-spark-1.3-minimal           | No                          | 78.62   | 89.43  | 90.54        | 9.56         | 8.4 s        |
| llamaindex/ocria-1                    | No (API only)               | 84.67   | 91.24  | 89.90        | 13.04        | 2.2 s        |
| google/gemini-4-argon                 | No                          | 84.23   | 92.85  | 89.85        | 19.26        | 13.5 s       |
| google/gemini-3-flash                 | No                          | 80.65   | 91.76  | 89.15        | 19.67        | 16.4 s       |
| openai/gpt-5.6-terra                  | No                          | 76.92   | 85.17  | 86.35        | 19.89        | 6.9 s        |
| meta/muse-wonder-1.0-minimal          | No                          | 84.73   | 91.83  | 91.43        | 39.41        | 12.3 s       |
| anthropic/claude-opus-5-5             | No                          | 84.27   | 93.53  | 91.03        | 48.82        | 11.2 s       |

How to read it for receipts:

- **These are document-parsing scores, not receipt-field accuracy.** The overall score is pulled around by charts,
  where Haiku scores 36.81, Mistral OCR 1.51 and dots.mocr 0.84. Receipts have no charts. On the parts that matter
  for a receipt, the spread is narrow: content faithfulness runs 86–91 for every model, and tables 68–94.
- **Our default (Claude Sonnet 5.5, effort low) isn't listed.** Neither is Flash-Lite. Haiku 5.5 at 70.94 sits below
  OCRia-1 at 84.67 here, yet matched Sonnet on our 31 receipts. Parsing rank doesn't predict receipt rank.
- Cost per page here is for enterprise pages of markdown output. Our measured Haiku cost is $0.0006 a receipt,
  half the router's $1.22 per 1K pages, because a receipt's JSON is shorter than a page of markdown.
- On price alone, no parser plus Haiku-for-fields beats one Haiku call:
  - Nemotron-3.5-Parse at $0.00073 plus ~$0.0002 for the text call is about $0.0009 (estimate), against $0.0006.
- So an OCR-model tier is worth benchmarking only to learn whether a dedicated OCR model **reads Devanagari, thermal
  and handwritten receipts better**. It isn't a way to save money.

Which cheap entries to add to our receipt benchmark:

| Model                           | Route                                                                                       | Why, or why not                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Claude Haiku 5.5                | Direct (already in the bench and the app)                                                   | Done: $0.0006, matches Sonnet on the 31. The baseline everything else must beat                                                |
| Gemini 3.8 Flash, thinking low  | Direct (in the app; needs a paid key and a `thinkingLevel` bench option)                    | Yes. The #85 run failed on the free tier                                                                                       |
| LightOnOCR-3-1B                 | Router, bench only, public sets only; or self-hosted                                        | **Yes, first open-weight pick**: Apache-2.0, 1B, best open parse score in the cheap band                                       |
| Nemotron-3.5-Parse              | Router, bench only                                                                          | Yes, second: cheapest listed and 0.63B. Read the OpenMDW-1.1 text first                                                        |
| MinerU2.5-Pro                   | Router, bench only                                                                          | Maybe: Apache-2.0, cheap, but weak on formatting (47.29)                                                                       |
| Mistral OCR 4.1 (annotations)   | Mistral directly, as the parsers landscape planned                                          | Maybe: closed, $0.004–0.005 a page, but `annotations` returns schema fields in one call                                        |

Send only the public sets through the router (CORD, Wikimedia Commons, AI-generated, synthetic fixtures). The
owner's Nepal receipts show customer names and stay off third-party processors unless the owner approves it. That
leaves the Nepal question, the one that matters, to a self-hosted run.

### 7. The Document Parsing Protocol is an output style guide, not a provider interface

- What it is ([LlamaIndex blog](https://www.llamaindex.ai/blog/introducing-the-document-parsing-protocol),
  2026-10-28; [parseprotocol.com](https://parseprotocol.com);
  [repo](https://github.com/run-llama/document_parsing_protocol)):
  - "Shared conventions for turning a page into structured Markdown": what to keep, how to write it, and how to
    flag what the page doesn't settle.
  - Working draft 0.1, 140 rules in 13 chapters (layout, text, tables, forms, charts, images and more), each with
    example pages.
  - It grew out of ParseBench's annotation rules.
  - Examples of rules: HTML tables when headers span columns, `[blank]` for empty fields, `[x]`/`[ ]` for
    checkboxes, `[illegible]` for unreadable text, charts turned into tables of printed values.
- Governance and licence: published by LlamaIndex alone, with issues and PRs invited. No foundation or other
  members are named. The rules are CC BY 4.0, the site code MIT (repo `LICENSE-docs` and `LICENSE`). Repo created
  2026-10-19, 24 stars (checked 2026-11-07).
- **There is no request or response format.** No endpoint, no transport, no field schema. The blog names no parser,
  provider or router that implements it. Its "Try it" is a Claude skill and a ChatGPT reference file that put the
  rules in a prompt. A code search of the repo for "receipt" finds a few table and form rules (for example "Bottom
  Edge Totals and Islands") but nothing on receipt fields.
- Against what we already have:
  - Our provider boundary is `packages/ai`. The AI SDK registry gives one `generateText` call across Anthropic and
    Google, our Zod schema (`schema.ts`) is the response contract, and every model is checked against it.
  - That contract already does what DPP can't: typed fields (`total`, `currency`, `receiptDate`, `items[]`),
    validation, and per-call usage for the ledger.
  - Swapping a model is an allowlist entry in `models.ts`. Swapping a non-LLM parser would mean writing a provider
    adapter, and DPP would not shorten that, because it defines no API.
- **Verdict: don't adopt it as an interface.** It covers document-to-markdown only, not structured field extraction.
  Two ideas are worth borrowing in our own prompt if the benchmark shows the need:
  - The explicit "unreadable" convention. Our schema already returns `null` for an unreadable field, plus a
    legibility `confidence`.
  - Its table rules, if we ever ask a parser for markdown before extraction.

## Options

Cost per receipt for a one-image receipt. "Measured" means our bench; the rest are list prices or estimates.

| Option                                                         | Cost per receipt                                                                                                    | Accuracy evidence                                                                                                         | Privacy                                                                          | Hosting fit (Vercel, small team)                                    | Verdict                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------- |
| Today's default: Sonnet 5.5                                    | $0.011 (measured)                                                                                                   | 31 real receipts: total 97%, date 74%, items F1 ~89%                                                                      | Anthropic (named processor)                                                      | Fits (API call)                                                     | Replace as first tier         |
| Haiku 5.5, then Flash-Lite (cheap tier)                        | $0.0006 / $0.0014 (measured)                                                                                        | Same as Sonnet on total, merchant, items; dates 65–74%                                                                    | Anthropic, Google (both named)                                                   | Fits                                                                | **Now** (owner decision)      |
| + deterministic checks, escalate to Sonnet/Opus on failure     | $0.0006 + escalation rate × $0.011–0.022. At 15%, about $0.0023–0.0039 (estimate)                                   | None yet. Opus better on dates (90%), and the date fix is in code (#86)                                                   | Same                                                                             | Fits (`packages/core` logic)                                        | **Now** checks, **next** escalation after a bench run |
| On-device blur/darkness warning (own code)                     | $0                                                                                                                  | None; thresholds need the real set                                                                                        | Best: nothing leaves the phone                                                   | Fits (browser, no dependency)                                       | **Next**                      |
| tesseract.js "has text" gate in the browser                    | $0 per call; MBs of download per device                                                                             | None on thermal photos                                                                                                    | Good                                                                             | Poor on low-end phones                                              | No                            |
| LiteParse (Tesseract or an OCR server) + LLM for fields        | ≈ LLM text call (~$0.0002, estimate) + OCR server hosting                                                           | None on receipts. README says scans are its weak case                                                                     | Good if self-hosted                                                              | Poor: Python OCR server, PDF-first tool                             | Never for photos              |
| LlamaParse (OCRia-1) + our LLM for fields                      | $0.0015–0.0375 parse + ~$0.0002 LLM                                                                                 | ParseBench (vendor). Nothing on receipts                                                                                  | New processor, 48 h source retention, training use unstated                      | Fits (API, async jobs)                                              | Never for receipts            |
| LlamaExtract (fields directly)                                 | $0.012–0.09                                                                                                         | None on receipts                                                                                                          | As above                                                                         | Fits                                                                | Bench only, as planned        |
| Open-weight OCR model on a hosted API + cheap LLM (olmOCR-2)   | ~$0.0001–0.0003 OCR (third-party token prices, estimate) + ~$0.0002 LLM                                             | olmOCR-bench only. **English only**                                                                                       | Another processor (DeepInfra and others)                                         | Fits (API), but two calls                                           | No (fails Nepal)              |
| OpenDocRouter (any listed parser) + our LLM for fields         | $0.0007–0.049 parse (list) + ~$0.0002 LLM                                                                           | ParseBench (vendor-run) only                                                                                              | Second processor; no DPA or subprocessor list; 24 h cache only if turned on       | Fits (API), cold starts up to 45 s on open models                   | Bench only, public sets       |
| Self-hosted open-weight OCR (LightOnOCR-3, dots.mocr) on a GPU | Fixed GPU cost per hour; cheaper than Haiku only at high, steady volume (not modelled)                              | Document benchmarks only                                                                                                  | Best (own infra)                                                                 | Poor: no GPU on Vercel, a second deploy target, on-call             | Later, as a benchmark comparator |

## Open-weight models: which are efficient and minimal to run

The owner's chart (vendor claims, from the [OCRia-1 post](https://www.llamaindex.ai/blog/parse-ocria-1)), overall
scores on ParseBench / olmOCR-bench / PulseBench-Tab / fr-bench-pdf2md:

- OCRia-1 4B: 87.4 / 83.5 / 84.1 / 72.1
- LightOnOCR-3-4B: 75.3 / 81.2 / 82.4 / 71.4
- Chandra-OCR-2: 74.8 / 81.2 / 80.0 / 65.5
- dots.mocr: 55.6 / 80.1 / 82.4 / 56.8
- olmOCR-2: 43.3 / 82.3 / 79.5 / 56.9

Model cards report other numbers for some of these. LightOnOCR-3-4B's card gives 86.3 on olmOCR-bench and 75.1 on
ParseBench.

Below, from each model card or repo. "Est." means VRAM computed at about 2 bytes per parameter (bf16), 1 (int8) or 0.5
(int4), weights only, plus KV cache. Parameter counts are the safetensors totals from the Hugging Face API (`/api/models/<id>`, checked 2026-11-07). None of these repos lists a pickle weight file (`.bin`, `.pt`, `.ckpt`); the weight files themselves weren't opened. No
card publishes CPU seconds per page. No model here has an MLX or in-browser (ONNX/WebGPU) build that we could find
(unverified).

| Model                                                                         | Weights and licence                                                                                                                    | Params, format                                     | VRAM (est.) bf16 / int8 / int4 | Runtimes                                                          | Hosted API, price                                                                                                                                                                                            | Output, base, languages                                                                                                    |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| OCRia-1 ([post](https://www.llamaindex.ai/blog/parse-ocria-1))                | **Not released** (no licence, no HF repo)                                                                                              | 4B (vendor); format n/a                            | n/a                            | None                                                              | LlamaParse (tier unverified); OpenDocRouter $13.04 / 1K pages                                                                                                                           | Markdown/HTML; base unverified                                                                                             |
| [LightOnOCR-3-4B](https://huggingface.co/lightonai/LightOnOCR-3-4B)           | Apache-2.0, "research and commercial use"                                                                                              | 4.54B; BF16 safetensors                            | ~9 / 4.5 / 2.3 GB               | transformers, vLLM, SGLang; community GGUF (llama.cpp, Ollama)    | None ("not deployed by any Inference Provider")                                                                                                                                                              | Markdown, optional boxes; Qwen3.5 VLM architecture; card mentions receipts (SROIE example image), no Devanagari claim      |
| [LightOnOCR-3-1B](https://huggingface.co/lightonai/LightOnOCR-3-1B)           | Apache-2.0                                                                                                                             | 1.01B; BF16 safetensors                            | ~2 / 1 / 0.5 GB                | vLLM, SGLang, GGUF                                                | OpenDocRouter $3.19 / 1K pages                                                                                                                                                                                                        | Markdown; "multilingual"; olmOCR-bench 84.5, ParseBench 71.4 (card)                                                       |
| [Chandra-OCR-2](https://huggingface.co/datalab-to/chandra-ocr-2) (Datalab)    | **Restricted**: modified OpenRAIL-M, free for research, personal use and startups under $2M funding or revenue, not to compete with Datalab's API (summary; read the licence text) | 5.30B; BF16 safetensors                            | ~11 / 6 / 3–4 GB (third-party calculators) | vLLM (recommended), transformers, SGLang; community GGUF          | Datalab API, per page ([billing](https://documentation.datalab.to/platform/billing)); rate card not read (unverified)                                                                                       | Markdown/HTML/JSON with layout; Qwen 3.5 based; 90+ languages claimed; 1.44 pages/s on an H100 (vendor)                   |
| [dots.mocr](https://huggingface.co/rednote-hilab/dots.mocr) (rednote)         | MIT (card tag; licence file not checked)                                                                                               | 3.04B; BF16 safetensors; needs `trust_remote_code` (runs the repo's Python) | ~6 / 3 / 1.5–2 GB              | vLLM ≥ 0.11, SGLang, GGUF                                         | OpenDocRouter $3.97 / 1K pages                                                                                                                                                                                            | Layout JSON with boxes, markdown, HTML tables; "multilingual", no Devanagari named                                        |
| [olmOCR-2-7B-1025](https://huggingface.co/allenai/olmOCR-2-7B-1025) (Ai2)     | Apache-2.0 (fine-tune of Qwen2.5-VL-7B-Instruct; check the base licence too)                                                          | 8.29B; BF16 safetensors, FP8 build                  | ~16 / 8 / 4 GB                 | transformers, vLLM, SGLang; GGUF                                  | DeepInfra ~$0.09/$0.19 per M tokens, Parasail $0.10/$0.20, Cirrascale $0.07/$0.15 (relayed from the [olmocr README](https://github.com/allenai/olmocr); unverified at each provider)                        | Plain text with a YAML header; **English only** per the card                                                               |
| [MiniCPM-OCR 1.0](https://huggingface.co/openbmb/MiniCPM-OCR-1.0) (OpenBMB)   | Apache-2.0 (card)                                                                                                                      | 1.30B; BF16 safetensors, AWQ/GPTQ/GGUF             | ~2.6 / 1.3 / <1 GB             | vLLM, SGLang, llama.cpp, Ollama                                   | Free on the ModelBest platform (no price found)                                                                                                                                                              | Markdown/JSON; **key-field extraction to JSON** with user-given fields; MiniCPM-V-4.6 base; **Chinese and English only**  |
| Surya OCR 2 ([repo](https://github.com/datalab-to/surya))                     | Code Apache-2.0; **weights modified OpenRAIL-M** (free under $5M funding or revenue; broader use needs a Datalab licence)              | not checked                                        | not checked                    | llama.cpp (CPU) or vLLM (GPU) via LiteParse's server              | Datalab API                                                                                                                                                                                                  | HTML blocks; 90+ languages                                                                                                 |
| Indra OCR ([card](https://huggingface.co/datalab-to/indra-ocr))               | Code Apache-2.0; **weights modified OpenRAIL-M** (as above)                                                                            | ~18 MB ONNX                                        | CPU only                       | ONNX Runtime                                                      | Datalab API                                                                                                                                                                                                  | Line text; ~55 languages **including Devanagari**; straightens skewed pages                                               |
| [Nemotron-3.5-Parse](https://huggingface.co/nvidia/Nemotron-3.5-Parse) (NVIDIA) | OpenMDW-1.1 (HF tag; a permissive open-model licence, text not read). Earlier Nemotron Parse used `trust_remote_code` (third party, unverified for 3.5) | 0.63B; safetensors | ~1.3 / 0.6 / 0.3 GB | transformers (not checked further) | OpenDocRouter $0.73 / 1K pages (cheapest listed) | Document parsing; languages not checked |
| [MinerU2.5-Pro-2605](https://huggingface.co/opendatalab/MinerU2.5-Pro-2605-1.2B) (OpenDataLab) | Apache-2.0 (HF tag) | 1.16B; safetensors | ~2.3 / 1.2 / 0.6 GB | not checked | OpenDocRouter $0.86 / 1K pages | Page to structured text; Qwen2-VL architecture ([llmrun.dev](https://llmrun.dev/model/opendatalab-mineru2-5-pro-2605-1-2b), third party) |
| [PaddleOCR-VL-1.6](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6) (Baidu) | Apache-2.0 (HF tag) | 0.96B; safetensors | ~1.9 / 1 / 0.5 GB | PaddleOCR toolkit, vLLM (per the parsers landscape) | OpenDocRouter $2.11 / 1K pages | Markdown; needs a second LLM step |
| EasyOCR / PaddleOCR PP-OCRv5                                                  | Apache-2.0 (licence files not checked in this pass)                                                                                    | small detector + recogniser models                 | CPU feasible                   | Python; PaddleOCR on ONNX Runtime in LiteParse's benchmarks       | Self-host                                                                                                                                                                                                    | Line text and boxes; 80+ languages                                                                                         |

Sources for the cards above are linked in the table. Hardware figures and third-party prices are as summarised from
those pages and the [LiteParse OCR servers README](https://github.com/run-llama/liteparse/tree/main/ocr). None of these
cards publishes SROIE, CORD or any receipt score. None mentions handwritten bill books or Bikram Sambat.

What the benchmarks imply for us: they score markdown fidelity on document pages. To get our fields, a markdown model
would need **two calls**: OCR text, then a cheap LLM to map text to fields.

- What the second step saves (estimate): replacing the image with ~500 tokens of text saves Haiku about $0.0003 of
  the $0.0006.
- What the first step costs: at least that much on a hosted API, or a GPU we'd run ourselves.
- What it loses: the layout cues (which number belongs to which line) that one VLM call uses for line items and for
  locale decimals.
- The 2026-11-06 plan reached the same conclusion for Docling and OCR-first pipelines, with SROIE evidence.
- **Pairing beats one VLM call on cost only if the OCR step is nearly free.** That means self-hosted at high
  utilisation, or on the device. Even then, accuracy has to be measured on our set.

Ranked for our case (phone photos, Nepal, no GPU on Vercel, small team):

1. **LightOnOCR-3-1B.**
   - Licence: Apache-2.0, safe for a paid SaaS.
   - Size: 1B, the smallest strong document model here; a GGUF build exists.
   - Fit: multilingual, and the 4B card mentions receipts.
   - Benchmarking it is feasible without buying a GPU. Public sets can go through OpenDocRouter ($3.19 per 1K pages,
     ParseBench 73.84, the best open score in the cheap band). The private Nepal set needs a rented GPU for an hour,
     or CPU llama.cpp at this size (speed unmeasured).
   - **The one to add to the benchmark first**, as an "OCR text, then Haiku" comparator. Devanagari is unclaimed, so
     the Nepal set decides.
2. **Nemotron-3.5-Parse**: 0.63B, OpenMDW-1.1 (read the text first), the cheapest router entry ($0.73 per 1K
   pages) with a ParseBench score close to LightOnOCR-3-1B. A second comparator on the public sets.
3. **LightOnOCR-3-4B**: same licence as the 1B and stronger on paper. Run it only if the 1B shows promise.
   **MinerU2.5-Pro** and **PaddleOCR-VL-1.6** (both Apache-2.0, about 1B) are similar options, weaker on formatting.
4. **dots.mocr**: MIT, 3B, layout JSON. But `trust_remote_code` runs repo code when the model loads, so pin a commit
   and review it first.
5. **olmOCR-2**: the only one sold cheaply by hosted APIs, but English-only and 8B.
6. **MiniCPM-OCR 1.0**: the only one that extracts fields itself. Chinese and English only, so it fails our core
   market.
7. **Chandra-OCR-2, Surya, Indra**: encumbered weights. Indra's 18 MB CPU model with Devanagari is interesting for an
   on-device or server text check, but only after a licence talk with Datalab.
8. **OCRia-1**: not open.

Separate track, already planned: **Qwen3-VL-8B** on an OpenAI-compatible host
([parsers landscape](../plans/2026-11-06-parsers-landscape.md)) is the better open-weight comparator for our real
design. It's a general VLM that returns our JSON in one call, and it can join the chain as a provider in
`packages/ai`.

## Next steps

1. **Checks before models** (no spend): implement the arithmetic and date checks in `packages/ai` or `packages/core`
   as pure functions. Run them over the 31 ground-truth JSONs and the six fixtures, and record how often they fire on
   correct data. Service charge and discounts are the known false alarm. Then run them over the #85 raw results
   (local, gitignored) to see how many real misses they catch.
2. **Escalation bench**: add a `--cascade haiku,sonnet` mode (or `haiku,opus`) to `bench/ocr.ts` that re-reads only
   when step 1's checks fail. Report escalation rate, fields fixed and $/receipt. Run after
   [#86](https://github.com/bhimrazy/receipt-ocr-app/pull/86) lands, so dates don't dominate. The spend estimate comes
   from `--dry-run`; the owner approves the spend first.
3. **Grow the Nepal set** past six receipts ([benchmark set plan](../plans/2026-11-07-receipt-benchmark-set.md)).
   Every decision above turns on that set.
4. **On-device photo check**: sharpness and darkness scores in `apps/web/lib/capture/`. Log the scores (as new
   wide-event fields, with the field audit) against read outcome before choosing thresholds.
5. **Later, one open-weight comparator**: a bench-only `ocr-text` engine that sends LightOnOCR-3-1B markdown to Haiku
   as text. Run the public sets through OpenDocRouter first (needs `OPEN_DOC_ROUTER_API_KEY` and plain `fetch`, no
   SDK), and add Nemotron-3.5-Parse in the same run. Only then decide whether the Nepal set is worth a self-hosted
   run. That run needs a GPU or CPU host for an hour and the owner's approval to download weights (supply-chain
   rules: safetensors only, pinned revision). For the Gemini 3.8 Flash "thinking low" row, call Google directly, not
   through the router.
6. **Watch, don't adopt**: LiteParse for long born-digital PDF statements, if that feature comes. OCRia-1, in case
   open weights are released under a commercial licence. The Document Parsing Protocol, in case it grows an API that
   other vendors implement.
