# Research Questions And Follow-Ups

Last updated: 2026-06-10

This document records the questions worth asking as the OCR stack evolves. It is deliberately framed as an exploration backlog rather than implementation work.

## Core Questions

1. Are we optimizing for expense tracking, audit-grade accounting, or receipt search?
2. Do we need line items in v1, or only merchant/date/category/total?
3. What is the acceptable human review rate?
4. Is local processing a product requirement or only a future enterprise option?
5. Are receipts mostly mobile photos, uploaded PDFs, email receipts, or mixed?
6. Which currencies/locales must be correct on day one?
7. What should the app do when the receipt image is readable to a human but the model is uncertain?

## Provider Questions

1. Does Gemini structured extraction beat Gemini freeform JSON plus Zod validation on our receipt set?
2. Does an OCR text prepass improve extraction or simply add noisy tokens?
3. Does Mistral OCR's Markdown output improve item-line extraction compared with direct image extraction?
4. Does Docling help on receipt PDFs, or is it mostly valuable for larger documents?
5. Does PaddleOCR provide enough bounding-box evidence to improve user correction UX?
6. Can dots.mocr, PaddleOCR-VL, Surya-OCR-2, or GLM-OCR run within acceptable cost/latency in a future worker?
7. Do cloud prebuilt receipt models outperform VLMs on totals but underperform on unusual layouts?
8. Do compact open OCR VLMs such as PaddleOCR-VL-1.6, GLM-OCR, DeepSeek-OCR, Surya-OCR-2, and dots.mocr beat general VLMs on receipts after the same schema extraction layer?
9. Does DeepSeek-OCR-2's visual causal-flow approach help with long receipts, warped photos, or multi-column/receipt-footer ordering?

## Architecture Questions

1. Should `packages/ai` expose one high-level `extractReceipt` method, or separate `parseDocument` and `extractReceipt` methods?
2. Should `packages/core` own retry policy, or should providers return repair recommendations?
3. How much raw OCR/layout data should be stored in Postgres versus object storage?
4. Should field-level evidence be first-class columns, JSONB, or both?
5. How should we version extraction schemas so old receipts remain reproducible?
6. How should a future BullMQ worker replay old receipts through a new provider without corrupting user-approved records?

## Evaluation Questions

1. What is the minimum gold dataset that catches total/date/currency failures?
2. Should item-line extraction be required for "completed" status or optional enrichment?
3. How do we score partially correct merchant names?
4. How do we handle receipts with multiple totals: subtotal, total, card charge, cash tendered, balance due?
5. What confidence threshold should trigger human review?
6. Do we need a "high-value receipt" policy for stricter review?

## Security And Privacy Questions

1. Are receipt images considered sensitive enough to require provider allowlists?
2. Should OCR providers be region-restricted?
3. Should raw provider outputs be encrypted separately?
4. How long should original receipt images be retained?
5. Do we need PII redaction for payment card fragments, loyalty numbers, phone numbers, or addresses?

## Suggested Experiments

| Experiment | Input | Compare | Decision |
| --- | --- | --- | --- |
| Single-pass VLM | 50 gold receipts | Gemini schema prompt variants | Baseline prompt/schema. |
| Repair loop | Same 50 | no repair vs one repair | Whether agentic retry pays off. |
| OCR prepass | Same 50 | image-only vs OCR+image | Whether raw OCR helps. |
| Parser prepass | 30 PDFs/e-receipts | Docling/olmOCR/Marker/MinerU | Best PDF conversion candidate. |
| Compact VLM OCR | 50 mixed receipts | PaddleOCR-VL-1.6/GLM-OCR/DeepSeek-OCR/Surya-OCR-2/dots.mocr/olmOCR | Best open parser candidate. |
| Local OCR | 50 photos | PaddleOCR/RapidOCR/Tesseract raw text | Local fallback viability. |
| Cloud receipt APIs | 50 mixed | Textract/DocAI/Azure vs Gemini | Enterprise adapter value. |
| Multilingual stress | 30 non-English receipts | Gemini/Mistral/dots/PaddleOCR-VL/Surya-OCR-2/Typhoon-OCR | Locale roadmap. |

## Open Research Watchlist

- PaddleOCR-VL-1.6, GLM-OCR, DeepSeek-OCR-2, Surya-OCR-2, Chandra-OCR-2, and future compact document VLM releases.
- dots.mocr/dots.mocr-svg for unified parsing and structured graphics.
- olmOCR benchmark evolution and unit-test reward training.
- MinerU-Popo-style postprocessing for document-level continuity.
- DeepSeek-OCR-style optical context compression and visual causal-flow token ordering.
- OmniDocBench, Real5-OmniDocBench, ParseBench, MDPBench, and olmOCR-bench as benchmark signals to compare with receipt-specific evals.
- Commercial OCR APIs that expose evidence and schema-constrained extraction.
- Model-context protocols or agent skills that make OCR tools callable by assistants.
