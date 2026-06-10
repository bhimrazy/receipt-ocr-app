# OCR Research Index

Last updated: 2026-06-10

This folder is a principal-engineer research packet for OCR and document parsing systems relevant to the Receipt OCR MVP. It covers classic OCR, document layout parsers, multimodal/VLM OCR, commercial document AI APIs, agentic OCR workflows, structured generation, evaluation, and an implementation direction for this repo.

## Reading Map

- [ocr-tool-landscape-and-timeline.md](./ocr-tool-landscape-and-timeline.md) - market map, taxonomy, and timeline from classic OCR to 2026 document VLMs.
- [ocr-architectures-and-workflows.md](./ocr-architectures-and-workflows.md) - how OCR systems work internally, including modular OCR, Docling-style conversion, end-to-end VLM parsing, agentic loops, and structured generation.
- [ocr-tool-profiles.md](./ocr-tool-profiles.md) - deeper profiles of Docling, dots.ocr/dots.mocr, PaddleOCR, olmOCR, MinerU, Marker/Surya, Tesseract, cloud APIs, and current VLM APIs.
- [ocr-exploration-catalog.md](./ocr-exploration-catalog.md) - organized catalog of tools/models to explore, with domain, links, output types, and benchmark priority.
- [receipt-ocr-evaluation-playbook.md](./receipt-ocr-evaluation-playbook.md) - receipt-specific test matrix, metrics, benchmark plan, and architecture recommendation for this repo.
- [research-questions-and-follow-ups.md](./research-questions-and-follow-ups.md) - open questions, experiments, security/privacy questions, and research watchlist.
- [additional-ocr-source-review.md](./additional-ocr-source-review.md) - triage of Anthropic docs and the extra links supplied by the user, grouped by primary sources, secondary comparisons, and weak/social leads.
- [conversation-restart-summary.md](./conversation-restart-summary.md) - compact restart brief for continuing this research in a fresh chat.

## Executive Takeaways

1. OCR is no longer one category. It now splits into text recognition, document parsing, key information extraction, document question answering, and agent-ready conversion.
2. For receipts, the correct production architecture is usually hybrid: deterministic preprocessing/storage plus a provider abstraction that can run either a specialized OCR/parser or a multimodal model with schema-constrained extraction.
3. Classic OCR still matters. Tesseract/PaddleOCR-style pipelines are cheaper, more controllable, and better for bounding boxes. VLM OCR is better when layout, tables, ambiguity, multilingual content, or reasoning over fields matters.
4. The latest open-source direction is compact document VLMs. PaddleOCR-VL-1.6 claims state-of-the-art OmniDocBench v1.6 performance with a 0.9B/1.0B-class model; GLM-OCR is another 0.9B compact OCR model; DeepSeek-OCR and DeepSeek-OCR-2 explore optical compression and visual causal flow; dots.ocr has evolved into dots.mocr; olmOCR moved into RL-trained VLM parsing for clean Markdown output.[^paddle-vl-16-hf][^glm-ocr-hf][^deepseek-ocr2-github][^dots-github][^olmocr-github]
5. Structured generation is now a first-class extraction primitive. OpenAI, Gemini, and Claude all support JSON-Schema-style structured outputs, which changes OCR from "read text, then regex it" into "produce typed evidence-bearing records."[^openai-structured][^gemini-structured][^anthropic-structured]
6. For this repo, keep `packages/ai` as the provider boundary, but model the output as evidence-rich receipt entities: `value`, `normalizedValue`, `confidence`, `sourceText`, and optional `bbox/page`.

## Research Questions Used

These questions drove the deeper exploration:

1. What problem are we solving: raw OCR, document parsing, receipt entity extraction, or audit-ready financial capture?
2. Which systems return only text, which return layout, and which return typed fields?
3. Where do modern VLM OCR systems beat modular OCR, and where do they still fail?
4. What is the role of structured output: validation convenience, reliability mechanism, or orchestration contract?
5. How should an "agentic OCR" pipeline decide when to retry, crop, rotate, ask another model, or fall back?
6. What must be measured for receipts beyond character accuracy: total correctness, tax/tip normalization, merchant matching, item-line grouping, currency, date ambiguity, and auditability?
7. Which tools are practical for a synchronous v1 upload path, and which are better reserved for a future worker pipeline?

## Suggested Near-Term Decision

For the Receipt OCR MVP:

- Keep Gemini as v1 through `packages/ai`, but define a provider-neutral `ReceiptExtractionProvider`.
- Add a structured schema with field-level evidence and validation rules.
- Keep the route handler thin and call an Effect service in `packages/core`.
- Store the raw provider JSON plus normalized fields.
- Add a later adapter spike for Docling and PaddleOCR/Marker/olmOCR as offline parser candidates, especially for scanned PDFs, multipage receipts, and batch workflows.

This lets the app ship quickly without hard-coding itself into a single model or a single interpretation of OCR.

## References

[^paddle-home]: PaddleOCR documentation, "Home", accessed 2026-06-10. https://www.paddleocr.ai/latest/en/index.html
[^paddle-vl-16-hf]: PaddlePaddle, "PaddleOCR-VL-1.6", Hugging Face, accessed 2026-06-10. https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6
[^glm-ocr-hf]: zai-org, "GLM-OCR", Hugging Face, accessed 2026-06-10. https://huggingface.co/zai-org/GLM-OCR
[^deepseek-ocr2-github]: DeepSeek AI, "DeepSeek-OCR-2", GitHub, accessed 2026-06-10. https://github.com/deepseek-ai/DeepSeek-OCR-2
[^dots-github]: rednote-hilab, "dots.ocr", GitHub, accessed 2026-06-10. https://github.com/rednote-hilab/dots.ocr
[^olmocr-github]: AllenAI, "olmOCR", GitHub, accessed 2026-06-10. https://github.com/allenai/olmocr
[^openai-structured]: OpenAI, "Structured model outputs", accessed 2026-06-10. https://platform.openai.com/docs/guides/structured-outputs
[^gemini-structured]: Google AI for Developers, "Structured outputs", accessed 2026-06-10. https://ai.google.dev/gemini-api/docs/structured-output
[^anthropic-structured]: Anthropic, "Structured outputs", accessed 2026-06-10. https://platform.claude.com/docs/en/build-with-claude/structured-outputs
