# Document parsers, extractors, open models and benchmarks for Receipt OCR (2026-11-06)

Scope: hosted parsers and extractors, LangChain's tools, small open-weight OCR/VLM models, and the public benchmarks and
receipt datasets we could use. Read alongside `plans/2026-11-06-extraction-cost-accuracy.md`, which already rejected
Docling, OCR-first pipelines (Tesseract, Paddle, Surya, docTR) and cloud receipt APIs (Textract, Azure, Document AI,
Veryfi). Those are not repeated here.

How the sources were checked: vendor pages were fetched or searched on 2026-11-06 and read through a summariser.

- **(3P)** means the figure comes only from a third party.
- **(conflict)** means sources disagree.
- **(vendor)** means the vendor published the benchmark and also tops it.
- **(est.)** means my own arithmetic or estimate.

Check any number against the vendor's page before it goes on our site.

Baseline used throughout:

- Gemini 3.5 Flash-Lite: about **$0.001** per receipt.
- Gemini 3.8 Flash: about **$0.004–0.006** per receipt now, and about **$0.008–0.012** from 2027-01-01.
- Both run as one synchronous call through the AI SDK with our Zod schema.

## TL;DR

1. **The "LangChain company" parsers are LlamaIndex's.** LlamaIndex is a separate company from LangChain. Its LlamaParse
   (parsing), **LlamaExtract** (schema extraction) and LlamaClassify/LlamaSplit are now sold as the "LlamaParse
   Platform", formerly LlamaCloud.
   - LlamaExtract is the closest fit to what we do.
   - Per one-page receipt it costs **$0.012** at its cheapest tier and **$0.0375** at the default Agentic tier. That is
     **12–37×** Flash-Lite and **2–8×** Gemini 3.8 Flash.
   - It runs as an asynchronous upload, then a job you poll.
   - It is not a production fit. It is **worth one benchmark run**, because the 10K free credits per month cover about
     400–1,250 receipts.
2. **LangChain itself adds nothing we need.**
   - Its structured-output extraction does the same job as the AI SDK's `Output.object`.
   - LangSmith evals overlap our `bench/` plus the PostHog LLM analytics already in the plan. **No.**
3. **The other hosted extractors are all priced per page at 4–50× Flash-Lite.**
   - Reducto $0.02, Extend about $0.05 (3P), Unstructured $0.015 (3P), Datalab $0.004–0.006.
   - They target long born-digital PDFs and RAG pipelines, not phone photos of receipts. **No** for receipts.
   - **Mistral OCR 4 with annotations** (about $0.005 per receipt, 3P) is the only one worth a benchmark slot. It is an
     independent engine and an EU-hosted option for a future EU or bookkeeper segment.
4. **Open-weight models:** add **Qwen3-VL-8B-Instruct** to the benchmark through an OpenAI-compatible host (Together or
   Fireworks, about $0.0005–0.0007 per receipt). **Gemma 4 26B-A4B** on DeepInfra (about $0.0003) is the optional
   second.
   - Self-hosting only beats Gemini above about **0.6–1.4M receipts per month** against Flash-Lite. Against 3.8 Flash
     the threshold is about **115–285k per month** (est., always-on L40S).
   - OCR-to-markdown specialists need a second LLM step. These are PaddleOCR-VL, DeepSeek-OCR 2, dots.mocr, olmOCR 2
     and Chandra, and that second step cancels their cost advantage.
5. **Benchmarks:**
   - **ParseBench is real.** LlamaIndex published it on 2026-04-13. It measures page parsing, not field extraction,
     and LlamaParse wins it (vendor).
   - The leaderboard closest to our job is the **Nanonets IDP leaderboard's KIE column**, where Gemini-3-Flash leads at
     91.1 (vendor). Watch it together with **ExtractBench**.
   - Build our own set from **CORD v2** (CC-BY-4.0, so it can be committed), **CORU/ReceiptSense** (MIT), **SROIE**
     (licence unverified, so local only) and **20–30 of our own receipts**.

## 1. Comparison table

Costs are for a one-page receipt (est.). The Flash-Lite multiple is taken against $0.001.

| Option                                               | What it is                                                                                 | Receipt fit (photos, line items, locales)                                                                                                          | $/receipt (multiple of Flash-Lite)                                                                                                                            | Latency                                                            | Hosting                                                                             | Privacy / retention                                                                                                                                                                               | TS effort                                                    | Verdict                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **Gemini 3.5 Flash-Lite / 3.8 Flash (today)**        | VLM, one call with our schema                                                              | Good on photos; native PDF; locale prompt tuned                                                                                                    | 0.001 / 0.004–0.006 (1× / 4–6×)                                                                                                                               | One synchronous call                                               | API                                                                                 | Paid tier: no training                                                                                                                                                                            | Done                                                         | **Keep**                                                                                 |
| **LlamaExtract** (LlamaIndex)                        | Schema extraction over its own parse step; targets per document, per page or per table row | General documents. Photo quality is not documented. Accepts our JSON Schema                                                                        | Cost-effective 8 cr = **$0.012**; Agentic 25 cr = **$0.0375**; Turbo 35 cr = $0.0525; Agentic Plus 60 cr = $0.09 (12–90×). Pro plan rates are about 17% lower | Asynchronous job with polling. No published latency, so measure it | SaaS (NA or EU), Enterprise hybrid                                                  | Source files and parse cache kept 48 h; `disable_cache` option; job-result retention unpublished; training use not stated; SOC 2 Type II; EU region in eu-central-1 with a DPA; BAA on Enterprise | `@llamaindex/llama-cloud` SDK, or plain `fetch`              | **Try in bench** (free credits). Not for production                                      |
| **LlamaParse**                                       | PDF/image to markdown or JSON layout                                                       | Parsing only, so it needs our LLM call after it                                                                                                    | Fast 1 cr $0.0015; Cost-effective 3 cr $0.0045; Agentic 10 cr $0.015; Agentic Plus 25 cr $0.0375                                                              | Asynchronous                                                       | SaaS                                                                                | Same as LlamaExtract                                                                                                                                                                              | Same SDK                                                     | **No** for receipts. **Later** for long PDF statements, if Gemini's native PDF struggles |
| **LlamaClassify / LlamaSplit**                       | Page classification; splitting a multi-document PDF by page                                | Splits by **page**, not by region within one photo                                                                                                 | Classify 1–2 cr; Split 3 cr + parse (about $0.006)                                                                                                            | Asynchronous                                                       | SaaS                                                                                | Same                                                                                                                                                                                              | Same SDK                                                     | **Later**, for bulk PDFs that hold many receipts. Gemini can return an array for now     |
| **LangChain.js extraction** (`withStructuredOutput`) | Framework wrapper around provider structured output                                        | Same models we already call                                                                                                                        | The model's cost                                                                                                                                              | Same                                                               | Library                                                                             | Our providers                                                                                                                                                                                     | New framework that duplicates the AI SDK                     | **No**                                                                                   |
| **LangSmith**                                        | Tracing, datasets, evaluators, prompt hub                                                  | Not an extractor                                                                                                                                   | Free: 1 seat, 5k traces/mo. Plus $39/seat/mo, 10k traces. Overage $2.50–7.50 per 1k traces (conflict, 3P)                                                     | n/a                                                                | SaaS (self-host on Enterprise)                                                      | Traces include receipt JSON, so it would be another processor                                                                                                                                     | `langsmith` JS SDK; works with the AI SDK through OTel       | **No.** Use `bench/` plus PostHog LLM analytics/evals, which are already planned         |
| **Mistral OCR 4.x + document annotations**           | VLM OCR to markdown, then an LLM fills a JSON Schema (it uses the first 8 image boxes)     | Handles images and handwriting. Two-stage, so the layout risk is the same as the OCR-first pipelines rejected earlier, though the OCR is VLM-grade | **$0.004** OCR, **$0.005** with annotations, about half on batch (3P, raised from $2/$3 in July 2026; Mistral's pricing page shows no OCR figure) (4–5×)      | Synchronous                                                        | SaaS (EU company), on-prem by contract                                              | Not verified. Check ZDR and DPA before use                                                                                                                                                        | `@ai-sdk/mistral` covers chat, not `/v1/ocr`, so use `fetch` | **Try in bench** (low priority): an independent engine and an EU-hosting option          |
| **Reducto**                                          | Parse, Extract, Split API                                                                  | Long enterprise PDFs; claims strength on tables                                                                                                    | Extract **$0.02/page** all-in (new from 2026-09-01); Deep Extract $0.04/page + $0.001/field (20–40×)                                                          | Asynchronous or synchronous                                        | SaaS, VPC                                                                           | Enterprise-oriented; not checked                                                                                                                                                                  | REST/SDK                                                     | **No.** Maybe later for an enterprise invoice tier                                       |
| **Extend**                                           | Parse, Extract, Classify, Split, credit-billed                                             | Invoices and forms; workflow UI                                                                                                                    | About **$0.05/page**, $300/mo minimum (3P, from a competitor) (about 50×)                                                                                     | n/a                                                                | SaaS                                                                                | n/a                                                                                                                                                                                               | REST                                                         | **No**                                                                                   |
| **Unstructured** (API + OSS)                         | Partitioning for RAG (elements, chunks)                                                    | Not schema extraction; weak on photos                                                                                                              | **$0.015/page** (3P, cut from $0.03 on 2026-08-28; conflict)                                                                                                  | Asynchronous                                                       | SaaS or OSS (Python)                                                                | n/a                                                                                                                                                                                               | Python-first                                                 | **No**                                                                                   |
| **Datalab** (Marker, Surya, Chandra API)             | OCR/layout to markdown; JSON extraction mode                                               | Strong page OCR; Chandra is #1 on olmOCR-Bench (vendor)                                                                                            | $0.004/page base; structured about $0.006 (3P) (4–6×)                                                                                                         | Asynchronous                                                       | SaaS; the OSS models have restrictive licences (Chandra uses a modified OpenRAIL-M) | n/a                                                                                                                                                                                               | REST                                                         | **No.** It is page OCR, and Gemini already does the reading                              |
| **Google LangExtract**                               | Python library: LLM extraction from **text**, with character-offset grounding              | Text in, not images. A community TS port exists (`@divinci-ai/langextract-ts`, not official)                                                       | Model cost                                                                                                                                                    | n/a                                                                | Library (Apache-2.0)                                                                | Our providers                                                                                                                                                                                     | Python, or an unofficial port                                | **No.** A grounding idea for email-in receipts later; Gemini can do it directly          |
| **Chunkr**                                           | Layout chunking for RAG                                                                    | RAG, not receipts                                                                                                                                  | Cloud $375–2,000/mo (3P); AGPL-3.0 OSS                                                                                                                        | n/a                                                                | SaaS or OSS                                                                         | n/a                                                                                                                                                                                               | REST                                                         | **No**                                                                                   |
| **Unstract**                                         | No-code LLM ETL platform that uses your own LLM                                            | Has a receipt template                                                                                                                             | Per page (amount not shown) plus your LLM                                                                                                                     | n/a                                                                | SaaS or OSS                                                                         | n/a                                                                                                                                                                                               | Platform, not a library                                      | **No.** It wraps what we already built                                                   |
| **Sensible**                                         | Template and LLM extraction, priced per document                                           | Forms and insurance documents                                                                                                                      | Price not shown                                                                                                                                               | n/a                                                                | SaaS                                                                                | n/a                                                                                                                                                                                               | REST                                                         | **No**                                                                                   |
| **Open-weight VLMs**                                 | See §3                                                                                     |                                                                                                                                                    | 0.0003–0.0007 hosted                                                                                                                                          |                                                                    |                                                                                     |                                                                                                                                                                                                   | `@ai-sdk/openai-compatible`                                  | **Try in bench** (Qwen3-VL-8B)                                                           |

Sources: [LlamaParse pricing](https://developers.llamaindex.ai/llamaparse/general/pricing/), [llamaindex.ai/pricing](https://www.llamaindex.ai/pricing), [data retention](https://developers.llamaindex.ai/llamaparse/general/data_retention/), [enterprise readiness](https://developers.llamaindex.ai/llamaparse/general/enterprise-readiness/), [regions](https://developers.llamaindex.ai/llamaparse/general/regions/), [Extract TS SDK](https://developers.llamaindex.ai/llamaparse/extract/sdk/), [Mistral annotations](https://docs.mistral.ai/capabilities/document_ai/annotations/), [Mistral OCR price (3P)](https://productbuilder.net/models/mistral-ocr-4-1), [Mistral rate rise (3P)](https://www.usagepricing.com/blueprint/activity/mistral-ai-2026-07-06-api-rate-increase), [Reducto pricing migration](https://docs.reducto.ai/reference/pricing-migration), [Reducto blog](https://reducto.ai/blog/reducto-simple-transparent-document-processing-pricing), [Extend (3P)](https://dev.thedrive.ai/blog/true-cost-document-processing-2026), [Unstructured (3P)](https://www.usagepricing.com/blueprint/activity/unstructured-2026-08-28-per-page-rate-halved), [Datalab billing](https://documentation.datalab.to/platform/billing), [LangSmith (3P)](https://costbench.com/software/ai-observability/langsmith/), [LangExtract TS port](https://www.pkgstats.com/pkg:@divinci-ai/langextract-ts), [Chunkr (3P)](https://costbench.com/software/rag-pipelines/chunkr/), [Unstract receipts](https://unstract.com/ai-accounts-payable-procurement-document-processing/receipt-data-extraction/), [Sensible](https://www.sensible.so/pricing).

<details><summary>Conflicting numbers</summary>

- **LlamaIndex credit price:**
  - The pricing page says $1.50 per 1k on PAYG and $1.25 on Pro.
  - Trackers report $1.00 → $1.25 in February 2026 (3P).
  - An older page split it by region: $1.00 NA and $1.50 EU.
- **LlamaIndex included credits:** the Pro plan says "800k bonus" while the comparison table says 400K. Our numbers use
  $1.50 PAYG.
- **LlamaExtract tiers:** there are two sets, and both exist. The v2 tiers (cost_effective, agentic, agentic_plus,
  turbo) total 8, 25, 60 and 35 credits per page with the default parse tier. The v1 modes are Fast 5, Balanced 10,
  Multimodal 20 and Premium 60.
- **Mistral OCR:** $2 per 1k pages plus $3 for annotations (OCR 3), against $4 plus $5 (OCR 4.x, July 2026). The
  official pricing page lists neither.
- **Unstructured:** $0.03/page, then $0.015/page (2026-08-28). The page's structured data still shows $0.03 (3P).
- **LangSmith overage:** $0.50, $2.50, $5 and $7.50 per 1k traces all appear in 3P sources.

</details>

## 2. Per-option notes

<details><summary>LlamaIndex: LlamaExtract, LlamaParse, platform</summary>

- **Fit.**
  - `client.extract.create({ file_input, configuration: { data_schema: z.toJSONSchema(schema), extraction_target: "per_doc", tier } })`,
    then poll `client.extract.get(id)` until `COMPLETED`. The result is in `job.extract_result`.
  - It takes our Zod schema as JSON Schema, so the output maps 1:1.
  - The `per_table_row` target suits bank statements and line-item-heavy invoices later.
  - Its schema docs list restrictions on the schema shape. Check that our `z.enum` category and nullable numbers pass.
- **Cost against our pipeline.** The cheapest real extraction tier costs $0.012, which is 2–3× today's Gemini 3.8 Flash
  call and 12× Flash-Lite. Auto Mode ("saves up to 80%", vendor claim) routes tiers per page. It does not reach
  Flash-Lite on a one-page receipt.
- **Latency.** The flow is upload, then create the job, then poll every 2 s. That adds 2 s or more of polling on top of
  model time. It fits the queued `after()` path, not a snappy synchronous upload. No latency is published.
- **Privacy.**
  - It would be one more sub-processor alongside Google.
  - Retention is 48 h for source files and the cache. Job-result retention is unpublished.
  - The docs do not say whether customer data is used for training, and I found no ZDR commitment.
  - It holds SOC 2 Type II. There is an EU region with an EU DPA. A BAA is available on Enterprise.
- **Where it could help later.**
  - (a) An accuracy reference in the benchmark: an independent "agentic" extractor with a different stack.
  - (b) Bulk multi-page PDFs (statements, invoice batches) through Split plus per-row extract.
  - (c) If a future API product needs a premium "agentic" tier, it sets the price ceiling: generalists charge
    $0.012–0.09 per page, so a receipt-specialised API at $0.005–0.01 undercuts them.
- **TS.** The package is `@llamaindex/llama-cloud`; the older `llama-cloud-services` and `llama-parse` are deprecated.
  For the benchmark, call it with plain `fetch` so we add no dependency (the 7-day cooldown and exact pins would apply).

</details>

<details><summary>LangChain (the company)</summary>

- **LangChain.js document loaders and extraction.** These wrap PDF loaders and provider structured output. The AI SDK
  already gives us `Output.object` with Zod, a provider registry and usage data. A second framework adds bundle size
  and new concepts for no new capability. **No.**
- **LangGraph.** Our workflow is Effect in `packages/core`. **No.**
- **LangSmith** (datasets, experiments, evaluators, prompt versioning).
  - It is useful for teams iterating on prompts with many people.
  - Our needs are met by two things:
    - `bench/`: versioned fixtures, deterministic scoring and committed `results/<date>.md`.
    - PostHog LLM analytics, already in the combined plan, which offers datasets and evaluations if we want hosted
      dashboards.
  - It would also be another processor that sees receipt JSON. **No for now.**
  - Revisit only if we iterate prompts across many people and want a hosted UI. Even then, compare it with Langfuse,
    which can be self-hosted.

</details>

<details><summary>Mistral OCR / Document AI</summary>

- **How it works.** `/v1/ocr` with `mistral-ocr-latest` takes a PDF or image. A `document_annotation_format` JSON Schema
  plus `document_annotation_prompt` asks an LLM to fill the schema from the OCR markdown and the first 8 image boxes.
- **Why benchmark it.**
  - It is an independent, VLM-grade OCR at about $0.005, roughly Gemini 3.8 Flash's price today and half of it after
    the 2027 doubling.
  - It is an EU vendor, which matters for the "privacy/residency, revisit for EU bookkeepers" line in the market
    review.
- **Risk.** It is two-stage (text first). The locale-decimal problem and the mapping of numbers to lines are where
  text-first pipelines lost before, and the benchmark will show whether that holds here.
- **Unverified.** ZDR, DPA terms, which model `-latest` points to, and limits.

</details>

<details><summary>Beyond per-receipt extraction: where these tools could matter</summary>

| Need                                 | Best tool today                                                                                                  | When an external tool earns its place                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Benchmark and ground-truth labelling | `bench/` with JSON fixtures. Label by having Gemini 3.8 Flash at high thinking pre-fill, then correcting by hand | Never needs a vendor. The LlamaExtract and Mistral runs act as second opinions when we disagree with a label                              |
| Bulk PDF statements and invoices     | Gemini native PDF (text is free, 560 tokens/page)                                                                | When documents run to 20+ pages with complex tables. Then try LlamaParse Agentic or Reducto, and watch ParseBench and RD-TableBench       |
| Several receipts in one photo        | Gemini: return `receipts[]`, with optional boxes for cropping                                                    | LlamaSplit splits by page, not by region, so it does not help here                                                                        |
| Bank-statement reconciliation        | Gemini PDF, then our own matcher (amount ±0.01, date ±3 d, merchant similarity from `score.ts`)                  | LlamaExtract `per_table_row` if statement layouts defeat Gemini                                                                           |
| API product                          | `packages/core` behind an API key                                                                                | The vendors are the competition. They charge $0.004 (Mistral) to $0.02–0.09 (Reducto, LlamaExtract) per page with general-purpose schemas |

</details>

## 3. Small open-weight models

Evidence is thin. I found **no CORD or SROIE scores** for current small models that I could cite. Receipt-specific
numbers below are vendor-reported or come from small third-party studies.

| Model                                                                                                               | Params             | Licence                                         | Reported scores                                                                                                                                                                                                                 | Output                                                                                    | Hosted $/receipt (est.; ~1,800 in / 600 out tokens)                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Qwen3-VL-8B-Instruct**                                                                                            | 8B (2B/4B also)    | Apache-2.0                                      | ReceiptBench zero-shot 0.65, 0.80 after SFT+GRPO ([ACL 2026](https://aclanthology.org/2026.acl-long.2135.pdf), 3P). 30B scored 90.6% on 3 SROIE fields ([Doubleword](https://docs.doubleword.ai/batches/structured-extraction)) | Schema JSON in one step (structured outputs or JSON mode). Use **Instruct**, not Thinking | Fireworks $0.20/$0.20 → **$0.00048**; Together $0.18/$0.68 → $0.00073 ([3P aggregator](https://pricepertoken.com/pricing-page/model/qwen-qwen3-vl-8b-instruct), 2026-11-05) |
| **Gemma 4 26B-A4B** (E4B, 12B, 31B also)                                                                            | 26B MoE, 4B active | Gemma terms (re-check for v4)                   | E4B 79.2 → 87.1 with LoRA on a 60-row SROIE-derived set ([HF card](https://huggingface.co/singhabhishekkk/apprentice-gemma4-e4b-lora-receipts), tiny, 3P)                                                                       | JSON from the prompt                                                                      | DeepInfra $0.07/$0.34 → **$0.00033** ([DeepInfra](https://deepinfra.com/models/multimodal))                                                                                 |
| **GLM-OCR**                                                                                                         | 0.9B               | MIT                                             | OmniDocBench 1.5 94.62; in-house Receipt KIE 94.5 (Gemini-3-Pro 97.3) ([arXiv 2603.10910](https://arxiv.org/html/2603.10910), vendor)                                                                                           | **Takes a JSON schema**; strip the code fences                                            | No serverless host found; self-host or Z.ai API                                                                                                                             |
| PaddleOCR-VL 1.5/1.6                                                                                                | 0.9B               | Apache-2.0                                      | OmniDocBench 1.5 94.5 / 1.6 96.3 (3P roundup)                                                                                                                                                                                   | Markdown, so it needs a second LLM step. PaddleOCR toolkit, not OpenAI-compatible         | Self-host only                                                                                                                                                              |
| TeleOCR / OvisOCR2 (2026)                                                                                           | 1.2B / 0.8B        | Apache-2.0                                      | OmniDocBench 1.6 96.9 / 96.5 (3P)                                                                                                                                                                                               | Markdown                                                                                  | Self-host                                                                                                                                                                   |
| MinerU2.5-Pro                                                                                                       | 1.2B               | Apache-2.0 weights; the toolkit has extra terms | OmniDocBench 1.6 95.75                                                                                                                                                                                                          | Markdown                                                                                  | Self-host                                                                                                                                                                   |
| DeepSeek-OCR 2                                                                                                      | 3B                 | Apache-2.0 (3P)                                 | OmniDocBench 90.25                                                                                                                                                                                                              | Markdown                                                                                  | Self-host                                                                                                                                                                   |
| dots.mocr                                                                                                           | 3B                 | MIT                                             | olmOCR-Bench 83.9 (vendor)                                                                                                                                                                                                      | Markdown                                                                                  | Self-host                                                                                                                                                                   |
| olmOCR 2                                                                                                            | 7B                 | Apache-2.0 weights; Ai2 guidelines, check       | olmOCR-Bench 82.4                                                                                                                                                                                                               | Markdown, PDF-oriented                                                                    | Self-host                                                                                                                                                                   |
| Chandra OCR 2                                                                                                       | 5.3B               | **Modified OpenRAIL-M, commercial limits**      | olmOCR-Bench 85.8 (vendor)                                                                                                                                                                                                      | Markdown                                                                                  | Datalab API                                                                                                                                                                 |
| LightOnOCR-3                                                                                                        | 0.8B / 4B          | not verified                                    | olmOCR-Bench 85.5 / 86.3 (3P, dates conflict)                                                                                                                                                                                   | Markdown                                                                                  | —                                                                                                                                                                           |
| Nanonets-OCR2, Granite-Docling/SmolDocling, Florence-2, MiniCPM-V 4.x, InternVL3.5, Mistral Small 3.x vision, Donut | —                  | not verified                                    | none sourced                                                                                                                                                                                                                    | Mostly document-to-markdown, or older                                                     | Not prioritised over Qwen3-VL and Gemma 4                                                                                                                                   |

<details><summary>Self-hosting cost and break-even (est.)</summary>

- **GPU prices per hour.**

  | GPU  | Modal | RunPod                           |
  | ---- | ----- | -------------------------------- |
  | L4   | $0.80 | $0.44–0.59 pod, $0.75 serverless |
  | L40S | $1.95 | $0.79–1.09 pod, $1.75 serverless |
  | H100 | $3.95 | $1.99–3.99 pod, $5.39 serverless |

  Sources: [Modal](https://modal.com/pricing), [RunPod](https://www.runpod.io/pricing).

- **Throughput (est., not measured).** A 4–8B VLM on vLLM with continuous batching might reach 0.5–1 receipts/s on an
  L4, 1.5–3/s on an L40S and 6–10/s on an H100. The only anchor is text-only Qwen3-8B on an A10 at 851 tok/s with 64
  concurrent requests ([TrueFoundry](https://www.truefoundry.com/blog/vllm-benchmark)), about 1.4 receipts/s.
- **Cost at full utilisation:** about $0.0001–0.0003 per receipt, a tenth of Flash-Lite or less.
- **Break-even for an always-on L40S:**
  - RunPod pod at about $577/mo: 580k receipts/mo against Flash-Lite, 115k against 3.8 Flash.
  - Modal at about $1,420/mo: 1.4M against Flash-Lite, 285k against 3.8 Flash.
  - Against hosted open-model APIs, the break-even is about 0.8–3.5M receipts/mo.
- **Cold starts:** 30–120 s for an 8B model on vLLM (est.). That rules out scale-to-zero for synchronous uploads. It
  fits only the future BullMQ worker, or a warm replica.
- **Not priced above:** ops time, autoscaling, monitoring, regression testing.
- **Hosted prices are drifting up.** The cheapest Qwen3-VL-8B input price rose 54% in about 90 days (3P).

</details>

**Verdict:**

- **Try in bench:** Qwen3-VL-8B-Instruct, as the primary open model. It is Apache-2.0, has several hosts and does
  one-step schema JSON.
- **Optional in bench:** Gemma 4 26B-A4B. Check its licence and its real image-token count first.
- **Watch:** GLM-OCR. It is tiny and takes a schema, but has no host.
- **No:** markdown-only OCR models (they need two steps) and Chandra (licence).
- **Self-host:** only once volume is past about 500k receipts/month and a worker exists.
- **What hosted open models buy:** about a 2–3× saving over Flash-Lite, which is under $0.001 a receipt in absolute
  terms. Accuracy on our own receipts decides, not price.

## 4. Benchmarks and leaderboards

| Benchmark                    | Publisher              | Measures                                                                                                                                                          | Receipts?                    | Latest top (date)                                                                                    | Use for us                                                                                                             |
| ---------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **ParseBench** (exists)      | LlamaIndex, 2026-04-13 | Rule-based tests (167k+ rules) on about 2,000 enterprise pages: tables, charts, faithfulness, formatting, visual grounding                                        | No                           | LlamaParse Agentic 84.9% at about 1.2¢/page (vendor). Codesota (3P): Gemini 3 Flash 71, Reducto 67.8 | Low. Page parsing, not fields. TableRecordMatch is the closest metric to line items. Watch it for a statements feature |
| **ExtractBench**             | LlamaIndex             | Schema-guided JSON extraction. Feb 2026: 35 PDFs and 12,867 fields. Jul 2026: 370 docs and 14 methods, scoring value accuracy, completeness, grounding and $/page | Unclear                      | Feb: valid JSON only 51%, 4.6% pass on huge schemas. Jul leaderboard not found                       | Medium for method (schema extraction plus cost). Its schemas are far larger than ours                                  |
| **Nanonets IDP leaderboard** | Nanonets (vendor)      | About 2,000 docs (invoices, **receipts**, forms, handwriting); KIE by exact and fuzzy match                                                                       | Yes, pooled with other types | KIE: Gemini-3-Flash 91.1, Claude Opus 4.6 89.8, Gemini 3.1 Pro 86.8, Nanonets OCR2+ 86.4             | **Highest.** The best public proxy for model choice                                                                    |
| OmniDocBench v1.5/1.6        | OpenDataLab            | Page parsing: text, formulas, tables, reading order                                                                                                               | No                           | Specialists 94–97; general LLMs about 91.6 (3P)                                                      | OCR sanity check only                                                                                                  |
| olmOCR-Bench                 | Ai2                    | 1,403 PDFs, 7,010 unit tests, English                                                                                                                             | No                           | Chandra 2 85.9, dots.mocr 83.9, olmOCR-2 82.4 (3P snapshots); Mistral OCR 4 claim disputed           | Low                                                                                                                    |
| OCRBench v2                  | Academic               | 10k QA + 1.5k private, including localisation                                                                                                                     | Partly                       | Unconfirmed                                                                                          | Low–medium                                                                                                             |
| CC-OCR (V2 May 2026)         | Alibaba et al.         | Includes a **KIE track built on SROIE, CORD, EPHOIE, POIE** (field F1)                                                                                            | Yes                          | Top about 73% average (3P, unverified)                                                               | Medium. Same data as our public subset                                                                                 |
| RD-TableBench                | Reducto (vendor)       | 1,000 complex tables                                                                                                                                              | No                           | Reducto 90.2% (vendor)                                                                               | Low                                                                                                                    |

Sources: [ParseBench blog](https://www.llamaindex.ai/blog/parsebench), [ParseBench HF](https://huggingface.co/datasets/llamaindex/ParseBench), [Codesota](https://www.codesota.com/benchmark/parsebench), [ExtractBench arXiv](https://arxiv.org/abs/2602.12247v2), [Jul paper](https://hyper.ai/papers/2607.29677), [Nanonets IDP](https://benchmarking.nanonets.com/benchmarks/idp), [OmniDocBench (3P)](https://benchlm.ai/benchmarks/omnidocbench15), [olmOCR-Bench (3P)](https://benchmarklist.com/benchmarks/olmocr_bench/), [CC-OCR V2 (3P)](https://benchmarklist.com/benchmarks/cc_ocr_v2/), [OCRBench v2](https://ling99-ocrbench-v2-leaderboard.hf.space/), [Reducto on benchmarks](https://reducto.ai/guides/document-ai-benchmark-ocr-parsing-extraction).

**Watch when picking models:** the Nanonets IDP **KIE** column (it includes receipts), ExtractBench (schema extraction
plus cost), and the CC-OCR KIE track. Use OmniDocBench and olmOCR-Bench only to shortlist OCR engines. Use ParseBench
and RD-TableBench only when long PDF statements or invoices become a feature. Every one of these is either published
by a vendor or measures page parsing, so **our own benchmark is what admits a model.**

## 5. Receipt datasets with ground truth

| Dataset                         | Size                         | Language / currency            | Line items                                     | Images       | Licence                                                                              | Public repo?                                | Where                                                                                                                               |
| ------------------------------- | ---------------------------- | ------------------------------ | ---------------------------------------------- | ------------ | ------------------------------------------------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **CORD v2** (Clova)             | 1,000 (800/100/100)          | Indonesian, IDR                | **Yes**                                        | Photos       | **CC-BY-4.0**                                                                        | **Yes**, with attribution                   | [HF naver-clova-ix/cord-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2), [GitHub](https://github.com/clovaai/cord)      |
| **SROIE** (ICDAR 2019)          | 1,000 (600/400)              | Malaysian English, MYR         | No (company, date, address, total)             | Scans        | Official terms **unverified**; an HF mirror claims CC-BY-4.0                         | **Local only** until verified               | [HF mirror](https://huggingface.co/datasets/jsdnrs/ICDAR2019-SROIE), [paper](https://arxiv.org/abs/2103.10213)                      |
| WildReceipt (mmocr)             | about 1,739                  | English                        | Partial (Prod_item, Prod_quantity, Prod_price) | Photos       | **Not stated**                                                                       | Local only                                  | [openmmlab tar](https://download.openmmlab.com/mmocr/data/wildreceipt.tar)                                                          |
| ExpressExpense SRD              | 200 restaurant               | English                        | No labels in the free set                      | Phone photos | CC0 variant (192 images); MIT HF re-package (97); Zenodo extension licence unchecked | CC0/MIT variants yes, but **we label them** | [Zenodo](https://zenodo.org/records/13688441), [HITL CC0](https://humansintheloop.org/resources/datasets/free-receipt-ocr-dataset/) |
| **CORU / ReceiptSense** (2024)  | 20k receipts, 10k item-level | Arabic 54%, English 26%, mixed | **Yes**                                        | Noisy photos | **MIT**                                                                              | **Yes**                                     | [HF abdoelsayed/CORU](https://huggingface.co/datasets/abdoelsayed/CORU), [arXiv](https://arxiv.org/abs/2406.04493)                  |
| MC-OCR 2021                     | 2,436                        | Vietnamese                     | Not verified                                   | Phone photos | Not found (likely research)                                                          | Local only                                  | [paper](https://people.cs.umu.se/sonvx/files/MCOCR_Preprint.pdf)                                                                    |
| HumynLabs Korean_Receipts       | Not checked                  | Korean, KRW                    | Not shown                                      | High-res     | CC-BY-4.0                                                                            | Yes, after inspection                       | [HF](https://huggingface.co/datasets/HumynLabs/Korean_Receipts_Dataset)                                                             |
| lxe/receipt-line-items-taxonomy | Not checked                  | US English, partly synthetic   | Items + category                               | n/a          | MIT                                                                                  | Yes                                         | [HF](https://huggingface.co/datasets/lxe/receipt-line-items-taxonomy)                                                               |

**Not recommended:**

- `Scam-AI/gpt4o-receipt`: AI-generated and NC-licensed.
- `Openpdf-MultiReceipt-1K`: no ground truth.
- SVRD and Japanese sets: none found.

**No public set has tips or multi-currency ISO labels, and none has EUR comma decimals or NPR lakh grouping.** Our own
receipts must cover those.

<details><summary>Field mapping to our fixture JSON</summary>

**CORD v2** (`ground_truth` JSON string, then `gt_parse`). Check key names against a real record: the README writes
`subtotal.*`, while the HF data uses `sub_total.*`.

| CORD                       | Ours                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `menu[].nm`                | `items[].name`                                                                                     |
| `menu[].cnt`               | `items[].quantity` (may be `"2"` or `"1 x"`, so take the leading number)                           |
| `menu[].unitprice`         | `items[].unitPrice` (often missing, so omit it)                                                    |
| `menu[].price`             | `items[].totalPrice`                                                                               |
| `sub_total.subtotal_price` | `subtotal`                                                                                         |
| `sub_total.tax_price`      | `tax`                                                                                              |
| `total.total_price`        | `total`                                                                                            |
| `sub_total.service_price`  | skip (a service charge is not a tip, so omit `tip`)                                                |
| —                          | `currency: "IDR"` (constant)                                                                       |
| —                          | omit `merchant`, `receiptDate`, `category` (store and payment info were removed for legal reasons) |

Quirks to handle:

- Amounts are strings such as `"45.000"` or `"1,346,000"`. Strip every `.`/`,` and parse an integer, since IDR has no
  decimals. This exercises our separator prompt.
- `menu` can be an object when there is only one item.
- `menu[].sub` holds modifiers. Drop them, or merge them into the name.

**SROIE** (task 3):

| SROIE     | Ours                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `company` | `merchant` (similarity ≥ 0.8 already tolerates casing and "SDN BHD")                                                                      |
| `date`    | `receiptDate` (formats vary, e.g. DD/MM/YYYY, DD-MM-YY, "12 JAN 2018"; normalise to ISO; if day/month order is ambiguous, omit the field) |
| `total`   | `total` (strip "RM" and the currency prefix)                                                                                              |
| —         | `currency: "MYR"`; omit items, subtotal, tax, tip and category                                                                            |

Use the corrected label files from the known SROIE fix repos, because the original labels contain errors.

**CORU:** it has item-level annotations in a Arabic/English mix. Map item name, quantity and price the same way as
CORD. Check the currency per receipt (usually EGP or SAR) and set it explicitly. Omit it where it is unclear.

</details>

### Recommendation: our benchmark set

Size: about 120 fixtures in total. A full run costs about $0.6 on 3.8 Flash and about $0.12 on Flash-Lite (est.).

| Slice                  | Count               | Source                                                                               | Committed?                                                                      | Covers                                                                                                                         |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `cord-*`               | 30 (from CORD test) | CORD v2                                                                              | **Yes**, with `bench/fixtures/ATTRIBUTION.md` (CC-BY-4.0)                       | Line items, subtotal and tax, IDR thousands separators                                                                         |
| `coru-*`               | 20                  | CORU                                                                                 | **Yes** (MIT notice)                                                            | Arabic/mixed script, noisy photos, items                                                                                       |
| `sroie-*`              | 30                  | SROIE (corrected labels)                                                             | **No**: `bench/fixtures-local/`, gitignored                                     | Merchant, date, total on scans                                                                                                 |
| `own-*`                | 20–30               | Our own PII-free receipts, labelled by hand (Gemini pre-fill, then human correction) | Yes, once checked for PII (card digits, names, loyalty IDs, addresses of homes) | Faded thermal, skewed and crumpled photos, HEIC, PDF, **EUR/NPR/JPY/INR, tips, VAT-inclusive, handwritten totals, multi-page** |
| synthetic (existing 5) | 5                   | `make-fixtures.mjs`                                                                  | Yes                                                                             | Regression cases for known locale bugs                                                                                         |

Notes:

- Report each slice separately. A model can win on CORD and lose on our own receipts.
- Admit a model on the `own` slice plus the overall field scores, not on a single average.
- Keep a `_meta` block in each fixture (`source`, `licence`, `split`). `score.ts` ignores unknown keys, because it
  only reads named fields.

## 6. How to add "try in bench" entries to `bench/`

Today `bench/ocr.ts` accepts only `google:<model>` and reads usage by intercepting Gemini HTTP responses.
`extractReceipt` now returns `usage` itself. The changes below are proposed, not made.

1. **Generalise the model spec to `<engine>:<id>`.** Each engine is one file in `bench/engines/` with the same
   signature:
   ```ts
   // bench/engines/types.ts
   export type EngineResult = {
     receipt: Receipt;
     usage?: { inputTokens: number; outputTokens: number };
     costUsd?: number;
   };
   export type Engine = (id: string, bytes: Uint8Array, mimeType: string) => Promise<EngineResult>;
   ```
   - `google` and `openai-compatible` call `extractReceipt()` from `@receipt-ocr/ai`. They take tokens from
     `result.usage`; drop the `fetch` monkey-patch once Gemini's reasoning tokens are in `usage`.
   - `llamaextract` and `mistral-ocr` are bench-only adapters that use plain `fetch`, so no new dependency.
   - Use a `Record<string, Engine>` map in `ocr.ts`. Replace the `provider !== "google"` throw with a lookup, and
     check each engine's key env var instead of always requiring `GOOGLE_GENERATIVE_AI_API_KEY`.
2. **Use the same instructions everywhere.** Export the prompt (`RECEIPT_PROMPT`) and
   `z.toJSONSchema(receiptExtractionSchema)` from `packages/ai`. Pass them to every engine: as LlamaExtract's
   `system_prompt` (check the config key name) or `data_schema`, and as Mistral's `document_annotation_prompt` and
   `document_annotation_format`. Otherwise we would be comparing prompts, not engines.
3. **Price per call or per page.** Extend `prices.json`:
   ```json
   "llamaextract:cost_effective": { "perPage": 0.012 },
   "llamaextract:agentic":        { "perPage": 0.0375 },
   "mistral-ocr:mistral-ocr-latest": { "perPage": 0.005 },
   "openai-compatible:together/Qwen/Qwen3-VL-8B-Instruct": { "input": 0.18, "output": 0.68 }
   ```
   The cost is `pages × perPage` (1 for images; the PDF page count for PDFs). Token pricing stays as it is. Key prices
   by the full spec, not the bare model name.
4. **Engines.**
   - **LlamaExtract**:
     1. `POST` the file upload with `purpose: "extract"`.
     2. Create the extract job with `{ file_input, configuration: { data_schema, extraction_target: "per_doc", tier } }`.
     3. Poll every 1–2 s until `COMPLETED`.
     4. Return `job.extract_result` as `Receipt`.

     Mirror the SDK's REST calls; check the paths in the API reference, since the SDK page lists none. Time from upload
     to result, so polling counts in latency. Use `LLAMA_CLOUD_API_KEY`. Set `disable_cache: true` so repeat runs are
     real runs. Note that a cached re-parse costs 0 credits.

   - **Mistral OCR**: `POST https://api.mistral.ai/v1/ocr` with `model`, `document` (`image_url` as a base64 data URL,
     or `document_url` for a PDF), `document_annotation_format: { type: "json_schema", json_schema: { name: "receipt", schema } }`
     and the prompt. Verify the parameter name against the API reference. Parse `document_annotation` (a JSON string).
     Use `MISTRAL_API_KEY`.
   - **Open models** belong in `packages/ai`, because a winner could ship.
     1. Add an `openai-compatible` provider: `createOpenAICompatible({ name, baseURL, apiKey, supportsStructuredOutputs: true })`.
        This adds the `@ai-sdk/openai-compatible` dependency: exact pin, at least 7 days old, `bun run check:deps`.
     2. Add the model to `OCR_MODELS` (`"together:Qwen/Qwen3-VL-8B-Instruct"`) and its key env to `OCR_PROVIDERS`.
     3. The bench engine is then just `extractReceipt`.

     If the host rejects `json_schema` for vision models, fall back to JSON mode. `Output.object` still validates the
     result with Zod, and a failure counts as `failed` in the bench.
     Not every model takes HEIC or PDF. Record that capability in the registry and skip unsupported fixtures (report
     them as `skipped`, not `failed`).
5. **Run head-to-head on the same receipts:**
   ```bash
   bun run bench:ocr --models google:gemini-3.5-flash-lite,google:gemini-3.8-flash,together:Qwen/Qwen3-VL-8B-Instruct,mistral-ocr:mistral-ocr-latest,llamaextract:cost_effective --concurrency 2
   ```
   - Add `--fixtures bench/fixtures-local` to include the SROIE slice.
   - Add per-slice rows (group by id prefix) to `results/<date>.md`.
   - Run LlamaExtract `agentic` once as the accuracy ceiling. About 120 receipts × 25 credits = 3,000 credits, which
     fits the free 10K.
6. **Decision rule:**
   - **Admit as a production candidate:** a model that matches Flash-Lite within 2 points on total, date, currency and
     items F1 on the `own` slice, at lower cost.
   - **Reference only:** a model that beats 3.8 Flash at higher cost. Use it as the escalation tier in the cascade
     only if the price difference is under 2×.
   - **Drop:** anything slower than 15 s p95 on the synchronous path.

## Sources not verified

- Mistral's official OCR price and ZDR terms.
- Extend's rate card.
- Datalab's structured-extraction rate.
- Unstructured's current price.
- LangSmith overage.
- LlamaExtract latency and training-use policy.
- SROIE and WildReceipt licences.
- Open-model throughput and cold starts (est.).
- Gemma 4 licence terms.
