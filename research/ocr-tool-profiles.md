# OCR Tool Profiles

Last updated: 2026-06-10

## Evaluation Lens

Each tool is judged by:

- Output shape: text, Markdown, JSON, boxes, typed fields.
- Control surface: local/API, model choice, schema support, customization.
- Fit for receipts: photos, short documents, item tables, totals, currency/date normalization.
- Fit for this repo: pnpm/Turborepo app, `packages/ai` boundary, Effect workflow, future worker.

## Docling

Docling is a document conversion toolkit rather than a receipt-specific OCR engine. It supports many formats and advanced PDF understanding, including layout, reading order, table structure, code, formulas, OCR, local execution, and exports such as Markdown, HTML, and lossless JSON.[^docling-docs] The architecture uses a document converter that selects a format-specific backend and pipeline, then returns a `DoclingDocument` for export, serialization, or chunking.[^docling-architecture]

Best use:

- Preprocess PDFs/e-receipts into Markdown/JSON before structured extraction.
- Build RAG/document search pipelines.
- Handle documents beyond receipts: invoices, statements, emails, reports.
- Local/air-gapped document conversion.

Weak spots for receipt MVP:

- It is not primarily a typed receipt extractor.
- For single receipt photos, direct multimodal extraction can be simpler.
- Need an additional schema extraction/validation layer.

Recommended repo role:

- Add later as `DocumentParserProvider`, not as the first synchronous upload dependency.
- Use in a future worker for PDF receipts and document normalization.

## dots.ocr / dots.mocr

dots.ocr is a multilingual document layout parser built around a single VLM. The GitHub project describes recognizing human scripts, parsing structured graphics, spotting scene text, and outputting structured layout with bounding boxes, categories, and text content.[^dots-github] Its news log says dots.ocr was released in July 2025, dots.ocr.base in October 2025, and dots.ocr-1.5 was rebranded as dots.mocr in March 2026.[^dots-github]

Its example prompt asks for JSON layout elements with:

- Bounding boxes.
- Categories such as title, text, table, formula, picture, header/footer.
- Original text only.
- Table text as HTML.
- Formula text as LaTeX.
- Human reading order.

Best use:

- Multilingual receipts or mixed scripts.
- Layout-rich documents where bounding boxes matter.
- Research into unified VLM document parsing.

Weak spots:

- Local deployment expects GPU/VLM infrastructure.
- The project itself notes limitations around complex tables/formulas, picture/SVG robustness, and occasional parsing failures.[^dots-github]
- For receipts, it still needs downstream field extraction and total validation.

Recommended repo role:

- Research spike for a worker adapter.
- Evaluate on real-world receipt photos, not only PDF-like pages.

## PaddleOCR

PaddleOCR is the broadest open-source OCR/document AI stack in this landscape. The current docs highlight PP-OCRv5, PP-StructureV3, PP-ChatOCRv4, PaddleOCR-VL, APIs, MCP, skills, local/serving deployment, and many hardware targets.[^paddle-home] The GitHub README frames it as converting PDFs/images into structured LLM-ready JSON/Markdown and supporting agentic applications.[^paddle-github]

Key subtools:

- PP-OCRv5: lightweight text recognition.
- PP-StructureV3: complex document parsing into Markdown/JSON with fine-grained coordinates.
- PP-ChatOCRv4: key information extraction with question-answer style workflows.
- PaddleOCR-VL: compact 0.9B document VLM for multilingual parsing.

Best use:

- Local or self-hosted OCR at scale.
- Need for bounding boxes, table cell coordinates, and visual diagnostics.
- Multilingual OCR and document parsing.
- Future worker pipeline where GPU/CPU scheduling can be controlled.

Weak spots:

- More operational complexity than a managed API.
- Version churn: PaddleOCR 3.x introduced interface changes, so adapters should pin versions and wrap outputs.[^paddle-home]
- For receipt extraction, still requires schema normalization and financial validation.

Recommended repo role:

- Strong candidate for a second provider after the Gemini MVP.
- Use as local/offline fallback or batch worker engine.

## PaddleOCR-VL-1.6

PaddleOCR-VL-1.6 deserves its own entry because it is a current 2026 document VLM, not just "PaddleOCR." The Hugging Face model card lists it as an Apache-2.0 image-text-to-text model for OCR/document parsing with tags for layout, table, formula, chart, seal, spotting, multilingual, PaddleOCR, and ERNIE4.5.[^paddlevl16-hf] The model card shows PaddleOCR integration through `PaddleOCRVL(pipeline_version="v1.6")`, saving JSON and Markdown outputs, plus vLLM serving and Transformers usage.[^paddlevl16-hf]

The 2026 technical report says PaddleOCR-VL-1.6 builds on PaddleOCR-VL-1.5 with region-aware data optimization and progressive post-training, including curated data selection and reinforcement learning. The report claims 96.33% on OmniDocBench v1.6 and strong competitiveness against top-tier VLMs.[^paddlevl16-paper]

Best use:

- High-priority open-model benchmark for document parsing.
- Worker-side parser for receipts, PDFs, tables, formulas, stamps/seals, and multilingual documents.
- Reference point for post-training and benchmark methodology.

Weak spots:

- Needs GPU/VLM serving and PaddleOCR dependency management.
- HF model-card benchmark claims must be reproduced on receipt data.
- The model is document-parsing oriented, not a normalized receipt accounting schema.

Recommended repo role:

- Put in the first open-model bakeoff after Gemini baseline.
- Use JSON/Markdown outputs as an intermediate input to the same receipt schema extractor.

## GLM-OCR

GLM-OCR is a compact 0.9B multimodal OCR model from Z.ai/zai-org. The Hugging Face model card lists it as MIT licensed, image-text-to-text, Transformers-compatible, and runnable through vLLM, SGLang, Ollama, Docker Model Runner, and the official SDK.[^glm-ocr-hf] Its model card describes a GLM-V encoder-decoder architecture, Multi-Token Prediction loss, stable full-task reinforcement learning, CogViT visual encoder, efficient token downsampling, a GLM-0.5B decoder, and a two-stage pipeline with PP-DocLayout-V3 layout analysis followed by parallel region recognition.[^glm-ocr-hf] The arXiv technical report gives the same high-level design and frames it as a real-world document-understanding model for parsing, formula transcription, table recovery, and key information extraction.[^glm-ocr-paper]

Best use:

- High-throughput compact OCR/model-serving benchmark.
- Documents with complex tables, code-heavy layouts, seals, and formula/table content.
- Comparison against PaddleOCR-VL-1.6 because both are compact 0.9B-class document parsers.

Weak spots:

- It is a new model; production stability and ecosystem maturity need review.
- Receipt-specific field extraction is still downstream work.
- The two-stage pipeline is more complex than a pure VLM API call.

Recommended repo role:

- Add to the open-model watchlist and benchmark catalog.
- Evaluate after the schema/eval harness exists, especially for latency/cost.

## DeepSeek-OCR And DeepSeek-OCR-2

DeepSeek-OCR is a 3B-parameter OCR/document model with an MIT-licensed Hugging Face model card, Transformers and vLLM usage, prompts for free OCR and Markdown conversion, and published eval results on olmOCR-bench.[^deepseek-ocr-hf] The paper frames OCR as "contexts optical compression," exploring how visual inputs can compress text contexts into fewer tokens.[^deepseek-ocr-paper]

DeepSeek-OCR-2 is a 2026 follow-up called "Visual Causal Flow." The paper investigates dynamic visual-token reordering by image semantics, instead of fixed top-left-to-bottom-right raster order.[^deepseek-ocr2-paper] The GitHub repo supports image and PDF inference, concurrency examples, batch benchmark evaluation, Markdown conversion prompts with grounding, vLLM, and Transformers inference.[^deepseek-ocr2-github]

Best use:

- Research spike for VLM document parsing architecture.
- Markdown conversion of image/PDF documents.
- Comparison against PaddleOCR-VL-1.6, GLM-OCR, olmOCR, and dots.mocr.

Weak spots:

- OCR-2 repo maturity appears early, with few commits and no releases at time of access.[^deepseek-ocr2-github]
- Needs GPU serving and careful dependency pinning.
- Compression/causal-flow benchmarks do not directly prove receipt accounting accuracy.

Recommended repo role:

- Treat as research-forward, not MVP dependency.
- Include in open-model bakeoff once local/hosted inference is practical.

## Qianfan-OCR, Nemotron-OCR-v2, And Typhoon-OCR

The current Hugging Face trending OCR page surfaces several additional candidates worth tracking: GLM-OCR, Chandra-OCR-2, Surya-OCR-2, NVIDIA Nemotron-OCR-v2, DeepSeek-OCR-2, DeepSeek-OCR, Baidu Qianfan-OCR, dots.ocr, Falcon-OCR, Typhoon-OCR, and smaller/niche OCR models.[^hf-ocr-trending] Treat this page as a discovery source because the order changes over time.

Qianfan-OCR is a 4B Baidu end-to-end document intelligence model. Its model card says it directly converts images to Markdown and supports structured parsing, table extraction, chart understanding, document QA, KIE, 192 languages, efficient deployment, and an optional "Layout-as-Thought" phase that emits structured layout representations before final output.[^qianfan-ocr-hf]

NVIDIA Nemotron-OCR-v2 is more classical/modular than the document VLMs above. Its model card describes detector, recognizer, and relational components with English and multilingual variants, GPU/CUDA installation requirements, Docker usage, and outputs with text, confidence, and normalized boxes.[^nemotron-ocr-v2-hf]

Typhoon-OCR-7B is a Thai/English real-world document parser based on Qwen2.5-VL. Its model card says it outputs Markdown, HTML tables, and figure tags, and explicitly lists receipts, menus, tickets, and infographics as supported layout-heavy informal documents.[^typhoon-ocr-7b-hf]

Best use:

- Qianfan: research comparison for end-to-end parsing plus explicit layout reasoning.
- Nemotron: evidence-rich OCR baseline when NVIDIA GPU deployment is acceptable.
- Typhoon: Thai/English or mixed-language receipt experiments.

Weak spots:

- Trending status is not a quality guarantee.
- Some models have domain, prompt, hardware, or license constraints.
- All still need receipt-specific schema normalization and financial validation.

Recommended repo role:

- Keep in the exploration catalog.
- Pull into the benchmark only when the gold dataset includes matching languages or document types.

## olmOCR

olmOCR is an AllenAI toolkit for converting PDFs and image-based documents into clean, readable plain text/Markdown. The repository describes support for PDF/PNG/JPEG, equations, tables, handwriting, complex formatting, header/footer removal, natural reading order, and a 7B VLM requiring GPU for local inference.[^olmocr-github]

Its 2025 news log shows rapid model iteration and benchmark improvements; the October 2025 v0.4.0 release introduced a new model using synthetic data and RL training.[^olmocr-github] The corresponding olmOCR 2 paper describes RL with unit-test rewards over synthetic documents, improving math, table parsing, and multi-column layouts.[^olmocr2-paper]

Best use:

- PDF linearization to Markdown.
- Dataset generation and RAG pipelines.
- Complex document formatting.

Weak spots:

- Less receipt-specific than cloud receipt processors.
- GPU requirements for local use.
- Outputs clean text/Markdown rather than canonical receipt records.

Recommended repo role:

- Good worker-stage parser for PDF receipts and long documents.
- Pair with structured extraction after Markdown generation.

## MinerU

MinerU converts PDFs, images, DOCX, PPTX, and XLSX into Markdown/JSON for retrieval, extraction, and processing. Its GitHub README lists header/footer removal, reading order, document structure preservation, image/table extraction, formula-to-LaTeX, table-to-HTML, scanned PDF OCR, 109-language OCR, visualization, CLI/FastAPI/Gradio, and CPU/GPU/MPS support.[^mineru-github]

Best use:

- Rich document conversion.
- Scientific/technical documents with formulas/tables.
- Local visual QA of parsing output.

Weak spots:

- Heavy compared with a direct receipt image extractor.
- More valuable for documents than small receipt photos.

Recommended repo role:

- Compare against Docling/Marker/PaddleOCR for a future PDF pipeline.

## Marker, Surya, Surya-OCR-2, And Chandra-OCR-2

Marker converts PDFs/images/office documents into Markdown/JSON, while Surya provides OCR, layout analysis, reading order, and table recognition. Surya's repository describes table recognition outputs with cell positions, row/column IDs, JSON, Markdown, and HTML, and points users to Marker for formatted table extraction.[^surya-github]

Surya-OCR-2 is the newer Datalab model-card entry to track. The model card describes a 650M OCR model with layout analysis, reading order, table recognition, multilingual support, bboxes/confidence, HTML table output, math in KaTeX-compatible LaTeX tags, and vLLM/llama.cpp inference.[^surya-ocr-2-hf] Its `surya_ocr` output includes blocks with labels, reading order, HTML, polygons, bboxes, confidence, skipped/error flags, and page image boxes, which is exactly the kind of evidence-rich output a receipt review UI can use.[^surya-ocr-2-hf]

Chandra-OCR-2 is Datalab's higher-accuracy 5B model. Its model card says it outputs Markdown, HTML, and JSON with detailed layout information; supports handwriting, forms, checkboxes, tables, math, complex layouts, image/diagram extraction, captions, structured data, and 90+ languages.[^chandra-ocr-2-hf]

Best use:

- Open-source conversion pipeline with local models.
- Table extraction and layout analysis.
- Visual debugging.
- Evidence-rich receipt correction UX, especially when bboxes and reading order matter.

Weak spots:

- Datalab ecosystem licensing/commercial terms should be checked before production use.
- Like other conversion tools, it needs a typed receipt extraction layer.
- Surya-OCR-2 weights use a modified OpenRAIL license and Chandra-OCR-2 uses OpenRAIL, so commercial deployment needs legal review.[^surya-ocr-2-hf][^chandra-ocr-2-hf]

Recommended repo role:

- Evaluate as an open parser baseline against Docling and PaddleOCR.
- Include Surya-OCR-2 in the compact/local parser benchmark; include Chandra-OCR-2 if model size/cost is acceptable.

## Mistral OCR

Mistral OCR is an API for images/PDFs that emphasizes document understanding: ordered interleaved text/images, media, text, tables, equations, complex layouts, multilingual support, RAG readiness, document-as-prompt, structured output, and optional self-hosting for sensitive organizations.[^mistral-ocr] Mistral's docs expose Document AI services through `client.ocr.process` or `/v1/ocr`, with OCR processor, annotations, and document QnA.[^mistral-docai]

Best use:

- API-first complex document extraction.
- Markdown conversion for RAG.
- Structured document prompts.

Weak spots:

- Vendor API dependency.
- Benchmarks in vendor blog posts should be independently validated.
- Receipts still need domain validation.

Recommended repo role:

- Very plausible fallback provider after Gemini.
- Useful for PDFs and complex image receipts.

## LlamaParse, LiteParse, ABBYY, UiPath, PyMuPDF, And pypdf

Recent comparison blogs from LlamaIndex and Fastio are useful because they frame OCR tools by workflow rather than model architecture. LlamaIndex splits the market into agentic document platforms, legacy OCR/PDF suites, open-weight OCR, managed cloud extraction, RPA document understanding, and lightweight PDF utilities.[^llamaindex-ocr-blog][^llamaindex-parsing-blog] Its parser API comparison narrows that into a build-vs-buy shortlist: LlamaParse, AWS Textract, Google Document AI, Azure Document Intelligence, Docling, and PyMuPDF.[^llamaindex-parser-api-blog] Fastio frames selection around AI agents: whether the tool is easy to call from agents, supports structured extraction, exposes confidence, handles storage/RAG, and can route low-confidence results to review.[^fastio-ocr-blog]

ParseBench is a stronger evaluation source from the same ecosystem. Its paper and dataset evaluate parsers on tables, charts, content faithfulness, semantic formatting, and visual grounding, which makes it a useful template for receipt-specific benchmarking even though it is not receipt-only.[^parsebench-paper][^parsebench-hf]

LiteParse is LlamaIndex's local parser option. The launch post described a CLI and TS-native library for parsing PDFs/Office docs/images into layout-aware text, generating screenshots, using Tesseract.js OCR automatically, and calling external OCR servers that return boxes and text.[^liteparse-blog] The v2.0 update moved the project to a Rust core with Node, Python, Rust, and WASM/browser/edge bindings; the blog claims 5-100x speedups on small documents, around 3x on large documents, PDFium-based extraction, and tesseract-rs as the default OCR implementation.[^liteparse-v2-blog] The GitHub README describes JSON/text/screenshots, bounding boxes, selective OCR, Office/image conversion, multi-platform support, and Apache-2.0 licensing.[^liteparse-github] The repo also includes eval utilities comparing `liteparse`, `pymupdf`, `pypdf`, and `markitdown` through QA-style LLM evaluation, and the small Hugging Face eval dataset has 48 rows with document types, layout complexity, and QA pairs.[^liteparse-github][^liteparse-dataset]

Tools surfaced by that lens:

- LlamaParse/LlamaExtract: managed agentic parsing and structured extraction for RAG/agent pipelines.
- LiteParse: local fast parsing and screenshot generation for coding agents and real-time pipelines across Node, Python, Rust, and WASM.
- Landing AI/LandingDocument: managed visual document extraction surfaced by parser comparisons; potentially relevant when spatial grounding matters.
- ABBYY FineReader/Vantage: high-accuracy legacy/enterprise OCR and document processing.
- UiPath Document Understanding: OCR plus RPA workflows and human validation.
- PyMuPDF: PDF rendering, splitting, metadata, redaction, and preprocessing; often paired with Tesseract or another OCR engine.
- pypdf: pure-Python PDF manipulation and text extraction for digital PDFs, but not OCR for scanned receipts.

Best use:

- Product/market comparison and discovery.
- PDF preprocessing decisions before OCR.
- Enterprise workflow inspiration for validation and human review.

Weak spots:

- Vendor comparison blogs are not neutral benchmarks.
- ABBYY/UiPath are heavier than this MVP's developer-first architecture.
- PyMuPDF/pypdf are utility layers, not receipt extraction engines.
- LiteParse prioritizes speed and local text/screenshots over premium OCR, Markdown tables, and JSON schema extraction.
- LiteParse v2.0 performance claims come from vendor/project benchmarks; verify on receipt PDFs and e-receipts before relying on them.

Recommended repo role:

- Add PyMuPDF/pypdf only if PDF rendering/splitting becomes a concrete backend need.
- Treat LlamaParse as a managed parser benchmark candidate, similar to Mistral OCR or cloud Document AI.
- Treat LiteParse as a local prepass candidate for PDFs/images before VLM extraction, especially if a worker needs fast text plus screenshots.
- Treat Landing AI as a spatial/visual parser benchmark candidate if receipts with dense tables or unusual layouts become a priority.
- Keep ABBYY/UiPath as enterprise comparison references rather than near-term dependencies.

## AWS Textract

Amazon Textract supports typed and handwritten text detection, forms, tables, queries, AnalyzeExpense for invoices/receipts, AnalyzeID, and lending workflows.[^aws-textract]

Best use:

- Enterprise managed OCR.
- Receipts and invoices with less custom extraction logic.
- Async multipage document processing.

Weak spots:

- Less flexible for arbitrary schemas than VLM structured generation.
- Cost and AWS coupling.
- Raw output can be verbose and still needs mapping/normalization.

Recommended repo role:

- Consider if users need audited managed extraction and AWS stack alignment.

## Google Document AI

Google Document AI is processor-oriented: digitize with OCR, extract text/layout, identify key-value pairs and tables, classify/split documents, train/uptrain custom processors, and return structured `Document` objects.[^google-docai] It includes Enterprise Document OCR, Form Parser, custom extractors, layout parser, and pretrained processors.

Best use:

- Google Cloud deployments.
- Custom processors and review workflows.
- Strong fit if using Gemini/Vertex/Cloud Storage ecosystem.

Weak spots:

- More setup than direct Gemini API.
- Processor-specific configuration.

Recommended repo role:

- Strong managed option if the app moves into Google Cloud infrastructure.

## Azure Document Intelligence

Azure Document Intelligence includes read/layout/general document models, prebuilt receipt/invoice/ID/contract/etc. models, custom neural/template/composed models, custom classifiers, typed field extraction, and OCR add-ons.[^azure-docint]

Best use:

- Microsoft/Azure enterprise environments.
- Prebuilt receipt/invoice extraction.
- Typed fields and custom models.

Weak spots:

- Azure coupling.
- Migration/versioning must be tracked; the docs currently emphasize v4.0 GA and older API retirement dates.[^azure-docint]

Recommended repo role:

- Enterprise adapter candidate.

## Gemini And General Vision Models

Gemini can process documents and supports structured outputs with JSON Schema for extraction, classification, and agentic workflows.[^gemini-docs][^gemini-structured] General VLM extraction is currently the simplest path for this repo because the app already names Gemini as v1.

Best use:

- Fast MVP.
- Flexible receipt schemas.
- Single-pass extraction from receipt images.

Weak spots:

- Needs retries and validation.
- May not provide trustworthy bounding boxes.
- Can hallucinate plausible fields if prompt/schema is too permissive.

Recommended repo role:

- Keep as v1 but wrap in provider-neutral schemas and domain validators.

## OpenAI Vision And Structured Outputs

OpenAI supports image inputs and structured model outputs. The Structured Outputs guide describes JSON Schema adherence, SDK helpers for Zod/Pydantic, and guidance to distinguish structured responses from tool calling.[^openai-vision][^openai-structured]

Best use:

- Schema-constrained multimodal extraction.
- Agentic workflows requiring tool calling and typed outputs.
- Cross-checking another provider's extraction.

Weak spots:

- If the app standardizes on Gemini v1, OpenAI should be an adapter, not a core assumption.
- Need to separately evaluate receipt image quality, latency, and cost.

Recommended repo role:

- Future provider adapter through `packages/ai`.

## Anthropic Claude Vision, PDF Support, And Structured Outputs

Claude is relevant as another multimodal extraction provider, especially for images/PDFs and agentic workflows. Anthropic's vision docs describe image inputs through Claude chat, Console, and the API; they document size/token behavior, image quality guidance, and limitations around low-quality, rotated, tiny, spatially precise, or high-stakes image interpretation.[^anthropic-vision] The PDF docs are relevant for e-receipts/invoices and uploaded statements, while Anthropic's structured outputs docs now support JSON schema outputs and strict tool use for schema-compliant tool parameters.[^anthropic-pdf][^anthropic-structured]

Best use:

- A future `ClaudeReceiptExtractionProvider` for cross-provider comparison.
- PDF/e-receipt extraction when the app needs a second premium model family.
- Agentic extraction loops where Claude calls OCR/parser/validation tools and returns final typed JSON.
- Provider diversity across Anthropic direct API, Amazon Bedrock, Vertex AI, or Microsoft Foundry.

Weak spots:

- Anthropic explicitly warns that Claude can make mistakes on low-quality, rotated, or very small images, and that precise localization/spatial reasoning can be limited.[^anthropic-vision]
- Structured outputs can add first-request grammar compilation latency and has schema complexity limits.[^anthropic-structured]
- For receipt OCR, Claude still needs the same app-level validation as Gemini/OpenAI.

Recommended repo role:

- Add to the provider shortlist, but not before the Gemini abstraction is clean.
- Use the same `ReceiptExtractionProvider` contract and avoid Claude-specific schema assumptions.

## Together AI Vision OCR

Together's OCR quickstart is useful because it shows the exact pattern this repo should evaluate: send an image to a vision model, request either Markdown/unstructured OCR or JSON structured extraction, and validate the result.[^together-ocr] The example uses a receipt image and JSON schema response formatting.

Best use:

- Fast hosted access to open or semi-open vision models.
- Benchmarking Llama/Qwen-style VLM OCR without self-hosting.

Weak spots:

- It is a platform quickstart, not an OCR benchmark.
- The example output itself shows why domain validation matters: restaurant receipts can contain multiple totals and gratuity/balance lines.

Recommended repo role:

- Add as a benchmark provider only after the internal schema and eval set exist.

## RapidOCR

RapidOCR is an engineering-focused OCR toolkit built around ONNX Runtime, OpenVINO, MNN, PaddlePaddle, TensorRT, and PyTorch. Its README describes cross-platform, multilingual offline deployment and explains that it converts PaddleOCR models to ONNX to simplify and accelerate inference across terminal devices.[^rapidocr-github]

Best use:

- Fast local raw OCR.
- Edge/offline deployment.
- A Docling OCR backend: Docling has examples for forcing full-page OCR and switching between Tesseract, EasyOCR, RapidOCR, macOS OCR, and other options.[^docling-full-page-ocr][^docling-rapidocr]

Weak spots:

- It is an OCR engine/deployment layer, not a typed receipt extractor.
- Language/model selection and custom model paths need operational care.

Recommended repo role:

- Candidate local OCR backend for future worker experiments.

## EasyOCR And docTR

EasyOCR is a ready-to-use OCR library with 80+ supported languages and common scripts.[^easyocr-github] docTR is a deep-learning OCR library from Mindee for document text recognition tasks.[^doctr-github]

Best use:

- Local OCR baselines.
- Fast experiments where PaddleOCR is too broad.
- Multi-language OCR comparison.

Weak spots:

- Neither is primarily a receipt schema extractor.
- They need preprocessing, extraction, and validation layers.

Recommended repo role:

- Include only in local OCR benchmark phase, not in the first product path.

## Donut

Donut is historically important because it popularized OCR-free document understanding: an encoder-decoder transformer that maps document images directly to structured outputs rather than explicitly running OCR first.[^donut-github] This lineage foreshadows modern VLM receipt extraction.

Best use:

- Understanding the research lineage of OCR-free extraction.
- Fine-tuned document-type extraction in controlled settings.

Weak spots:

- Older architecture and ecosystem compared with current document VLMs.
- A receipt MVP should not start here unless doing research training.

Recommended repo role:

- Background research reference, not a near-term adapter.

## Qwen VLMs

The user provided Qwen2.5-VL, which now redirects to Qwen3-VL. Qwen3-VL's README claims expanded OCR across 32 languages, robustness in low light/blur/tilt, long-document structure parsing, stronger grounding, and cookbooks for document parsing and key information extraction.[^qwen-vl]

Best use:

- Self-hosted or hosted open-weight multimodal extraction.
- Fine-tuning experiments for receipt-specific JSON extraction.
- Underlying base model for specialized systems; several open OCR models build on Qwen-family VLMs.

Weak spots:

- General VLMs need prompt/eval work to match specialized OCR models.
- Larger checkpoints can be operationally expensive.

Recommended repo role:

- Evaluate indirectly through Together/Hugging Face first; self-host only if product constraints require it.

## Nanonets-OCR-s And OCRFlux-3B

Nanonets-OCR-s and OCRFlux-3B are Hugging Face model-card candidates from the user's list. Treat them as open-model candidates for benchmarking, not production choices until licensing, model behavior, and receipt-specific accuracy are verified.[^nanonets-ocr-s][^ocrflux-3b]

Best use:

- Add to an offline/hosted open-model benchmark.
- Compare Markdown/HTML/table behavior against olmOCR, PaddleOCR-VL, dots.mocr, and Qwen.

Weak spots:

- Model cards are not enough for a production decision.
- Need license review and local eval.

Recommended repo role:

- Keep in watchlist; test only after core eval harness exists.

## Zerox

Zerox is a developer-facing OCR/document extraction project using vision models.[^zerox-github] It is relevant as a pattern: render pages/images, call a VLM, produce Markdown/structured output, and integrate with app workflows.

Best use:

- Inspiration for a lightweight VLM OCR pipeline.
- Fast proof-of-concept document extraction.

Weak spots:

- It is a wrapper/workflow, not a model or managed OCR service.
- Production suitability depends on selected backend model and validation.

Recommended repo role:

- Consider as implementation inspiration, not a provider dependency.

## Japanese-Receipt-VL-3B-JSON

Japanese-Receipt-VL-3B-JSON is a fine-tuned Qwen2.5-VL-3B model specifically optimized for Japanese mobile receipt OCR and structured JSON. The model card says it was trained with LoRA on Japanese receipt images and outputs store information, itemized purchases, tax calculations, and payment details.[^japanese-receipt-vl]

Best use:

- Locale-specific research example.
- Evidence that receipt-specialized fine-tuning can be practical with around 1k focused images.

Weak spots:

- Japanese-focused; not a general receipt model.
- Dataset size, license inheritance, and real-world generalization need validation.

Recommended repo role:

- Use as a model card case study for future locale-specific adapters.

## Tesseract

Tesseract is the classic open-source OCR baseline. It is local, mature, and widely integrated.[^tesseract-docs]

Best use:

- Low-cost raw text fallback.
- Privacy-sensitive local OCR.
- Searchable text and boxes.

Weak spots:

- Weak receipt semantics.
- Needs image preprocessing.
- Less robust on warped mobile photos and irregular receipt layouts.

Recommended repo role:

- Fallback raw OCR or local dev utility, not the main extraction engine.

## Practical Tool Matrix

| Tool | Local/API | Main output | Boxes | Typed receipt fields | Best fit |
| --- | --- | --- | --- | --- | --- |
| Gemini | API | JSON via prompt/schema | Limited | Yes, via schema | MVP extraction |
| Claude | API/Bedrock/Vertex/Foundry | JSON via schema, text, PDF/image analysis | Limited | Yes, via schema | Cross-provider extraction |
| Together AI vision models | API | Text/Markdown/JSON via schema | Model dependent | Yes, via schema | Hosted open-model benchmark |
| Mistral OCR | API/self-host selective | Markdown, images, structured output | Some/document dependent | Yes, with prompt | Complex docs |
| Docling | Local | DoclingDocument, Markdown, JSON | Yes via document model | No, add extractor | PDF conversion |
| PaddleOCR | Local/API | Text, Markdown, JSON, layout | Yes | Partial via ChatOCR | Future worker |
| PaddleOCR-VL-1.6 | Local/vLLM | JSON, Markdown, element recognition | Yes/document parser | No, add extractor | High-priority open parser |
| GLM-OCR | Local/vLLM/SGLang/Ollama/API | Markdown/text, layout-driven OCR | Likely via pipeline | No, add extractor | Compact high-throughput parser |
| DeepSeek-OCR | Local/vLLM | Markdown/free OCR | Model dependent | No, add extractor | Optical compression research parser |
| DeepSeek-OCR-2 | Local/vLLM | Markdown/free OCR, image/PDF | Model dependent | No, add extractor | Visual causal-flow research parser |
| dots.ocr/mocr | Local/VLM | Layout JSON, Markdown/HTML/LaTeX | Yes | No, add extractor | Research parser |
| olmOCR | Local/remote VLM | Markdown/plain text | Not primary | No, add extractor | PDF linearization |
| MinerU | Local/API-ish | Markdown/JSON | Yes | No, add extractor | Rich document parsing |
| Marker/Surya | Local | Markdown/JSON/table HTML | Yes | No, add extractor | Open parser baseline |
| Surya-OCR-2 | Local/vLLM/llama.cpp | HTML/JSON blocks, layout, tables, bboxes | Yes | No, add extractor | Evidence-rich local parser |
| Chandra-OCR-2 | Local/vLLM/API | Markdown, HTML, JSON layout | Likely via layout output | No, add extractor | Higher-accuracy Datalab parser |
| Qianfan-OCR | Local/vLLM/API | Markdown, KIE, document QA, layout thoughts | Yes in thinking mode | Partial via KIE prompt | End-to-end document intelligence |
| Nemotron-OCR-v2 | Local NVIDIA GPU | Text, confidence, boxes | Yes | No | Modular OCR baseline |
| Typhoon-OCR | Local/API | Markdown, HTML tables, figure tags | Limited/model dependent | No, add extractor | Thai/English receipts |
| RapidOCR | Local | Text plus boxes | Yes | No | Fast offline OCR backend |
| EasyOCR/docTR | Local | Text plus boxes | Yes | No | Baseline OCR comparison |
| Qwen VLMs | Local/API depending host | Prompted text/JSON/HTML | Model dependent | Yes, via schema/prompt | Open VLM experiments |
| Textract | API | Blocks, forms, tables, expense fields | Yes | Yes for receipts/invoices | Enterprise AWS |
| Document AI | API | Document objects, entities | Yes | Yes via processors | Google Cloud |
| Azure Document Intelligence | API | Typed fields/layout | Yes | Yes via prebuilt receipt | Azure enterprise |
| Tesseract | Local | Text/hOCR/TSV | Yes | No | Raw OCR fallback |

## References

[^docling-docs]: Docling documentation, "Index", accessed 2026-06-10. https://docling-project.github.io/docling/
[^docling-architecture]: Docling documentation, "Architecture", accessed 2026-06-10. https://docling-project.github.io/docling/concepts/architecture/
[^dots-github]: rednote-hilab, "dots.ocr", GitHub, accessed 2026-06-10. https://github.com/rednote-hilab/dots.ocr
[^paddle-home]: PaddleOCR documentation, "Home", accessed 2026-06-10. https://www.paddleocr.ai/latest/en/index.html
[^paddle-github]: PaddlePaddle, "PaddleOCR", GitHub, accessed 2026-06-10. https://github.com/PaddlePaddle/PaddleOCR
[^paddlevl16-hf]: PaddlePaddle, "PaddleOCR-VL-1.6", Hugging Face, accessed 2026-06-10. https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6
[^paddlevl16-paper]: Zelun Zhang et al., "PaddleOCR-VL-1.6: Expanding the Frontier of Document Parsing with Under-Optimized Region Refinement and Progressive Post-Training", arXiv, 2026. https://arxiv.org/abs/2606.03264
[^glm-ocr-hf]: zai-org, "GLM-OCR", Hugging Face, accessed 2026-06-10. https://huggingface.co/zai-org/GLM-OCR
[^glm-ocr-paper]: Shuaiqi Duan et al., "GLM-OCR Technical Report", arXiv, 2026. https://arxiv.org/abs/2603.10910
[^deepseek-ocr-hf]: DeepSeek AI, "DeepSeek-OCR", Hugging Face, accessed 2026-06-10. https://huggingface.co/deepseek-ai/DeepSeek-OCR
[^deepseek-ocr-paper]: Haoran Wei et al., "DeepSeek-OCR: Contexts Optical Compression", arXiv, 2025. https://arxiv.org/abs/2510.18234
[^deepseek-ocr2-paper]: Haoran Wei, Yaofeng Sun, Yukun Li, "DeepSeek-OCR 2: Visual Causal Flow", arXiv, 2026. https://arxiv.org/abs/2601.20552
[^deepseek-ocr2-github]: DeepSeek AI, "DeepSeek-OCR-2", GitHub, accessed 2026-06-10. https://github.com/deepseek-ai/DeepSeek-OCR-2
[^olmocr-github]: AllenAI, "olmOCR", GitHub, accessed 2026-06-10. https://github.com/allenai/olmocr
[^olmocr2-paper]: Jake Poznanski, Luca Soldaini, Kyle Lo, "olmOCR 2: Unit Test Rewards for Document OCR", arXiv, 2025. https://arxiv.org/abs/2510.19817
[^mineru-github]: OpenDataLab, "MinerU", GitHub, accessed 2026-06-10. https://github.com/opendatalab/MinerU
[^surya-github]: Datalab, "surya", GitHub, accessed 2026-06-10. https://github.com/datalab-to/surya
[^surya-ocr-2-hf]: Datalab, "surya-ocr-2", Hugging Face, accessed 2026-06-10. https://huggingface.co/datalab-to/surya-ocr-2
[^chandra-ocr-2-hf]: Datalab, "chandra-ocr-2", Hugging Face, accessed 2026-06-10. https://huggingface.co/datalab-to/chandra-ocr-2
[^hf-ocr-trending]: Hugging Face, "Models search: ocr sorted by trending", accessed 2026-06-10. https://huggingface.co/models?sort=trending&search=ocr
[^qianfan-ocr-hf]: Baidu, "Qianfan-OCR", Hugging Face, accessed 2026-06-10. https://huggingface.co/baidu/Qianfan-OCR
[^nemotron-ocr-v2-hf]: NVIDIA, "nemotron-ocr-v2", Hugging Face, accessed 2026-06-10. https://huggingface.co/nvidia/nemotron-ocr-v2
[^typhoon-ocr-7b-hf]: Typhoon AI, "typhoon-ocr-7b", Hugging Face, accessed 2026-06-10. https://huggingface.co/typhoon-ai/typhoon-ocr-7b
[^mistral-ocr]: Mistral AI, "Mistral OCR", 2025-03-06, accessed 2026-06-10. https://mistral.ai/news/mistral-ocr/
[^mistral-docai]: Mistral AI docs, "Document AI", accessed 2026-06-10. https://docs.mistral.ai/studio-api/document-processing/overview/
[^llamaindex-ocr-blog]: LlamaIndex, "Best OCR Software of 2026: Agentic AI vs. Legacy Solutions", 2026-03-18, accessed 2026-06-10. https://www.llamaindex.ai/insights/best-ocr-software
[^llamaindex-parsing-blog]: LlamaIndex, "Best Document Parsing Software 2026: Agentic AI vs. Legacy OCR", 2026-03-18, accessed 2026-06-10. https://www.llamaindex.ai/insights/best-document-parsing-software
[^llamaindex-parser-api-blog]: LlamaIndex, "Top Document Parsing APIs for 2026", 2026-03-17, accessed 2026-06-10. https://www.llamaindex.ai/insights/top-document-parsing-apis
[^fastio-ocr-blog]: Fastio, "Best OCR Tools for AI Agents - Top Vision APIs 2026", accessed 2026-06-10. https://fast.io/resources/best-ocr-tools-ai-agents/
[^parsebench-paper]: Boyang Zhang et al., "ParseBench: A Document Parsing Benchmark for AI Agents", arXiv, 2026. https://arxiv.org/abs/2604.08538
[^parsebench-hf]: LlamaIndex, "ParseBench", Hugging Face dataset, accessed 2026-06-10. https://huggingface.co/datasets/llamaindex/ParseBench
[^liteparse-blog]: Logan Markewich, "LiteParse: Local Document Parsing for AI Agents", LlamaIndex, 2026-03-19, accessed 2026-06-10. https://www.llamaindex.ai/blog/liteparse-local-document-parsing-for-ai-agents
[^liteparse-v2-blog]: Logan Markewich, "LiteParse v2.0 Runs Everywhere", LlamaIndex, 2026-05-27, accessed 2026-06-10. https://www.llamaindex.ai/blog/liteparse-v2-0-runs-everywhere
[^liteparse-github]: run-llama, "liteparse", GitHub, accessed 2026-06-10. https://github.com/run-llama/liteparse
[^liteparse-dataset]: LlamaIndex, "liteparse_bench_small", Hugging Face dataset, accessed 2026-06-10. https://huggingface.co/datasets/llamaindex/liteparse_bench_small
[^aws-textract]: AWS, "What is Amazon Textract?", accessed 2026-06-10. https://docs.aws.amazon.com/textract/latest/dg/what-is.html
[^google-docai]: Google Cloud, "Document AI overview", last updated 2026-06-04, accessed 2026-06-10. https://cloud.google.com/document-ai/docs/overview
[^azure-docint]: Microsoft Learn, "What is Azure Document Intelligence in Foundry Tools?", accessed 2026-06-10. https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview
[^gemini-docs]: Google AI for Developers, "Document processing", accessed 2026-06-10. https://ai.google.dev/gemini-api/docs/document-processing
[^gemini-structured]: Google AI for Developers, "Structured outputs", accessed 2026-06-10. https://ai.google.dev/gemini-api/docs/structured-output
[^openai-vision]: OpenAI, "Images and vision", accessed 2026-06-10. https://platform.openai.com/docs/guides/images-vision
[^openai-structured]: OpenAI, "Structured model outputs", accessed 2026-06-10. https://platform.openai.com/docs/guides/structured-outputs
[^anthropic-vision]: Anthropic, "Vision", accessed 2026-06-10. https://platform.claude.com/docs/en/build-with-claude/vision
[^anthropic-pdf]: Anthropic, "PDF support", accessed 2026-06-10. https://platform.claude.com/docs/en/build-with-claude/pdf-support
[^anthropic-structured]: Anthropic, "Structured outputs", accessed 2026-06-10. https://platform.claude.com/docs/en/build-with-claude/structured-outputs
[^together-ocr]: Together AI, "Quickstart: How to do OCR", accessed 2026-06-10. https://docs.together.ai/docs/quickstart-how-to-do-ocr
[^rapidocr-github]: RapidAI, "RapidOCR", GitHub, accessed 2026-06-10. https://github.com/RapidAI/RapidOCR
[^docling-full-page-ocr]: Docling documentation, "Force full page OCR", accessed 2026-06-10. https://docling-project.github.io/docling/examples/full_page_ocr/
[^docling-rapidocr]: Docling documentation, "RapidOCR with custom OCR models", accessed 2026-06-10. https://docling-project.github.io/docling/examples/rapidocr_with_custom_models/
[^easyocr-github]: JaidedAI, "EasyOCR", GitHub, accessed 2026-06-10. https://github.com/JaidedAI/EasyOCR
[^doctr-github]: Mindee, "docTR", GitHub, accessed 2026-06-10. https://github.com/mindee/doctr
[^donut-github]: CLOVA AI, "Donut", GitHub, accessed 2026-06-10. https://github.com/clovaai/donut
[^qwen-vl]: QwenLM, "Qwen3-VL", GitHub, accessed 2026-06-10. https://github.com/QwenLM/Qwen2.5-VL
[^nanonets-ocr-s]: Nanonets, "Nanonets-OCR-s", Hugging Face, accessed 2026-06-10. https://huggingface.co/nanonets/Nanonets-OCR-s
[^ocrflux-3b]: ChatDOC, "OCRFlux-3B", Hugging Face, accessed 2026-06-10. https://huggingface.co/ChatDOC/OCRFlux-3B
[^zerox-github]: getomni-ai, "zerox", GitHub, accessed 2026-06-10. https://github.com/getomni-ai/zerox
[^japanese-receipt-vl]: sabaridsnfuji, "Japanese-Receipt-VL-3B-JSON", Hugging Face, accessed 2026-06-10. https://huggingface.co/sabaridsnfuji/Japanese-Receipt-VL-3B-JSON
[^tesseract-docs]: Tesseract OCR documentation, accessed 2026-06-10. https://tesseract-ocr.github.io/tessdoc/
