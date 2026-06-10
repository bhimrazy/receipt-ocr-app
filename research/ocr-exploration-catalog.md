# OCR Exploration Catalog

Last updated: 2026-06-10

This catalog is the working list of OCR/document AI tools and models to explore. It is intentionally broad, but each entry includes why it matters and how strongly it should be prioritized for this receipt OCR repo.

## Priority Legend

| Priority | Meaning |
| --- | --- |
| P0 | Directly relevant to current MVP or provider abstraction. |
| P1 | Strong candidate for the first benchmark/spike after MVP. |
| P2 | Useful comparison, fallback, or future enterprise/local option. |
| P3 | Research watchlist or niche candidate. |

## Compact Document VLMs And Open Models

| Tool/model | Domain | Output | Links | Priority | Why explore |
| --- | --- | --- | --- | --- | --- |
| PaddleOCR-VL-1.6 | Multilingual document parsing | JSON, Markdown, text/table/formula/chart/seal recognition | [HF](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6), [paper](https://arxiv.org/abs/2606.03264), [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | P1 | Current 2026 compact parser with strong OmniDocBench claims and PaddleOCR integration. |
| GLM-OCR | Compact multimodal OCR | OCR/Markdown through layout-plus-recognition pipeline | [HF](https://huggingface.co/zai-org/GLM-OCR), [paper](https://arxiv.org/abs/2603.10910) | P1 | 0.9B MIT model using CogViT, GLM decoder, MTP, RL, PP-DocLayout-V3, and parallel recognition. |
| DeepSeek-OCR | OCR as optical compression | Free OCR, Markdown | [HF](https://huggingface.co/deepseek-ai/DeepSeek-OCR), [paper](https://arxiv.org/abs/2510.18234) | P1 | Popular 3B open model; tests whether optical context compression helps receipt parsing. |
| DeepSeek-OCR-2 | Visual causal flow | Free OCR, Markdown, image/PDF inference | [GitHub](https://github.com/deepseek-ai/DeepSeek-OCR-2), [paper](https://arxiv.org/abs/2601.20552) | P2 | Research-forward follow-up with dynamic visual-token ordering; promising but early. |
| Surya-OCR-2 | Compact Datalab OCR VLM | HTML/JSON blocks, bboxes, layout, tables, math | [HF](https://huggingface.co/datalab-to/surya-ocr-2), [GitHub](https://github.com/datalab-to/surya) | P1 | 650M evidence-rich parser with bboxes/confidence and vLLM/llama.cpp serving. |
| Chandra-OCR-2 | Datalab high-accuracy OCR VLM | Markdown, HTML, JSON with layout | [HF](https://huggingface.co/datalab-to/chandra-ocr-2) | P1/P2 | Strong Datalab parser; larger 5B model with OpenRAIL commercial considerations. |
| dots.ocr / dots.mocr | Multilingual layout parsing | Layout JSON, Markdown/HTML/LaTeX | [GitHub](https://github.com/rednote-hilab/dots.ocr), [HF](https://huggingface.co/rednote-hilab/dots.ocr) | P1 | Strong layout JSON and reading-order story; good for multilingual receipts and visual evidence. |
| olmOCR | PDF/image to Markdown | Clean Markdown/plain text | [GitHub](https://github.com/allenai/olmocr) | P1 | Strong PDF linearization and RL-trained OCR direction. |
| Nanonets-OCR-s | OCR/document parsing | Markdown/structured text | [HF](https://huggingface.co/nanonets/Nanonets-OCR-s) | P2 | Open model candidate from user list; needs license and receipt eval. |
| OCRFlux-3B | Document OCR | Markdown/text | [HF](https://huggingface.co/ChatDOC/OCRFlux-3B) | P2 | Candidate open OCR model, especially for document continuity comparisons. |
| Qwen3-VL / Qwen2.5-VL lineage | General VLM/document parsing | Prompted JSON/text/HTML | [GitHub](https://github.com/QwenLM/Qwen2.5-VL) | P2 | Strong open VLM base; likely substrate for many OCR fine-tunes. |
| Japanese-Receipt-VL-3B-JSON | Japanese receipt extraction | Receipt JSON | [HF](https://huggingface.co/sabaridsnfuji/Japanese-Receipt-VL-3B-JSON) | P2/P3 | Receipt-specific fine-tune case study for locale-specialized extraction. |
| Qianfan-OCR | End-to-end document intelligence | Markdown, KIE, document QA, layout thoughts | [HF](https://huggingface.co/baidu/Qianfan-OCR) | P2 | 4B model with Layout-as-Thought and 192-language claim; good research comparison. |
| Nemotron-OCR-v2 | NVIDIA OCR pipeline | Text, confidence, boxes | [HF](https://huggingface.co/nvidia/nemotron-ocr-v2) | P2 | More modular evidence-rich OCR baseline for NVIDIA GPU environments. |
| Typhoon-OCR-7B | Thai/English document parsing | Markdown, HTML tables, figure tags | [HF](https://huggingface.co/typhoon-ai/typhoon-ocr-7b) | P2/P3 | Strong fit if Thai/English receipts or Southeast Asian locale support matters. |
| Donut | OCR-free document understanding | Structured sequence output | [GitHub](https://github.com/clovaai/donut) | P3 | Important historical architecture, less likely for new production adapter. |
| MonkeyOCR | Document parsing research | Structure-recognition-relation parsing | [paper](https://arxiv.org/abs/2506.05218) | P3 | Useful mental model for "where/what/how related" parsing. |

## Document Conversion And Parser Pipelines

| Tool/model | Domain | Output | Links | Priority | Why explore |
| --- | --- | --- | --- | --- | --- |
| LlamaParse / LlamaExtract | Agentic document parsing/extraction | Markdown, JSON, traceable structured extraction | [OCR comparison](https://www.llamaindex.ai/insights/best-ocr-software), [LlamaParse](https://www.llamaindex.ai/llamaparse) | P1/P2 | Useful managed parser reference for RAG/agent pipelines, especially traceability and workflow framing. |
| LiteParse | Local document parsing for agents | Layout-aware text, JSON, screenshots, bboxes | [v1 blog](https://www.llamaindex.ai/blog/liteparse-local-document-parsing-for-ai-agents), [v2 blog](https://www.llamaindex.ai/blog/liteparse-v2-0-runs-everywhere), [GitHub](https://github.com/run-llama/liteparse), [docs](https://developers.llamaindex.ai/liteparse/), [eval dataset](https://huggingface.co/datasets/llamaindex/liteparse_bench_small) | P1/P2 | Fast local Rust-core parser with Node/Python/Rust/WASM bindings, spatial reconstruction, bundled Tesseract OCR, screenshots, and pluggable OCR servers. |
| Landing AI / LandingDocument | Agentic visual document extraction | Structured extraction, visual grounding/workflows | [LlamaIndex parsing comparison](https://www.llamaindex.ai/insights/best-document-parsing-software), [Landing AI](https://landing.ai/) | P2 | Useful comparison point for spatial/visual document workflows and agentic extraction claims. |
| Docling | Document conversion | DoclingDocument, Markdown, JSON, HTML | [docs](https://docling-project.github.io/docling/), [GitHub](https://github.com/docling-project/docling) | P1 | Best candidate for PDF/e-receipt preprocessing and future worker parsing. |
| Docling full-page OCR | OCR backend control | Forced OCR pages | [example](https://docling-project.github.io/docling/examples/full_page_ocr/) | P1 | Important for scanned PDFs and receipt images embedded in PDFs. |
| Docling + RapidOCR custom models | OCR backend control | DoclingDocument via RapidOCR | [example](https://docling-project.github.io/docling/examples/rapidocr_with_custom_models/) | P1 | Shows how to wire fast local OCR into Docling. |
| MinerU | Rich document conversion | Markdown, JSON, formulas, tables | [GitHub](https://github.com/opendatalab/MinerU) | P2 | Strong parser baseline for PDFs and structured documents. |
| Marker | PDF/image/office conversion | Markdown/JSON | [GitHub](https://github.com/datalab-to/marker) | P2 | Open conversion baseline, especially with Surya. |
| Surya | OCR/layout/table recognition | Text, boxes, tables, reading order | [GitHub](https://github.com/datalab-to/surya) | P2 | Local OCR/layout/table component for evidence and visual QA. |
| Zerox | VLM OCR wrapper | Markdown/document extraction | [GitHub](https://github.com/getomni-ai/zerox) | P3 | Useful implementation pattern, not a core model. |
| PyMuPDF | PDF rendering/extraction/preprocessing | PDF pages, images, metadata, text | [docs](https://pymupdf.readthedocs.io/) | P2 | Good preprocessing utility for rendering PDFs before OCR or redaction/splitting workflows. |
| pypdf | Digital PDF manipulation | Text/metadata/pages, no scan OCR | [docs](https://pypdf.readthedocs.io/) | P3 | Useful for digital PDFs and metadata/page operations, not OCR for scanned receipts. |

## OCR Engines And Classical/Deep Toolkits

| Tool/model | Domain | Output | Links | Priority | Why explore |
| --- | --- | --- | --- | --- | --- |
| PaddleOCR 3.x | OCR/document toolkit | Text, boxes, JSON, Markdown, KIE | [docs](https://www.paddleocr.ai/latest/en/index.html), [GitHub](https://github.com/PaddlePaddle/PaddleOCR), [3.0 paper](https://arxiv.org/abs/2507.05595) | P1 | Broad local stack: PP-OCRv5, PP-StructureV3, PP-ChatOCRv4, PaddleOCR-VL. |
| RapidOCR | Fast local OCR | Text and boxes | [GitHub](https://github.com/RapidAI/RapidOCR) | P2 | Practical local OCR backend and Docling candidate. |
| EasyOCR | Local OCR | Text and boxes | [GitHub](https://github.com/JaidedAI/EasyOCR) | P2 | Simple OCR baseline across many languages. |
| docTR | Deep OCR | Text and boxes | [GitHub](https://github.com/mindee/doctr) | P2 | Modern OCR baseline from Mindee. |
| Tesseract | Classic local OCR | Text, hOCR, TSV, boxes | [docs](https://tesseract-ocr.github.io/tessdoc/) | P2 | Cheap local fallback and evidence generator. |

## Managed APIs And General Multimodal Providers

| Tool/model | Domain | Output | Links | Priority | Why explore |
| --- | --- | --- | --- | --- | --- |
| Gemini | Multimodal extraction | Structured JSON/text | [docs](https://ai.google.dev/gemini-api/docs/document-processing), [structured output](https://ai.google.dev/gemini-api/docs/structured-output) | P0 | Current planned provider for the MVP. |
| Claude | Multimodal/PDF extraction | Structured JSON/text | [vision](https://platform.claude.com/docs/en/build-with-claude/vision), [PDF](https://platform.claude.com/docs/en/build-with-claude/pdf-support), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) | P1 | Premium cross-check provider with image/PDF and schema support. |
| OpenAI vision | Multimodal extraction | Structured JSON/text | [vision](https://platform.openai.com/docs/guides/images-vision), [structured outputs](https://platform.openai.com/docs/guides/structured-outputs) | P1 | Premium cross-check provider and structured output reference. |
| Mistral OCR | OCR/document API | Markdown, images, annotations, structured output | [news](https://mistral.ai/news/mistral-ocr/), [docs](https://docs.mistral.ai/studio-api/document-processing/overview/), [cookbook](https://github.com/mistralai/cookbook/blob/main/mistral/ocr/structured_ocr.ipynb) | P1 | Strong API-first document OCR and structured OCR path. |
| Together OCR/VLM | Hosted open VLM OCR | Markdown/JSON | [quickstart](https://docs.together.ai/docs/quickstart-how-to-do-ocr) | P2 | Easy way to benchmark hosted open VLMs before self-hosting. |
| AWS Textract | Managed document AI | Blocks, forms, tables, expense fields | [docs](https://docs.aws.amazon.com/textract/latest/dg/what-is.html) | P2 | Enterprise receipt/invoice extraction option. |
| Google Document AI | Managed processors | Document object, entities, tables | [docs](https://cloud.google.com/document-ai/docs/overview) | P2 | Strong Google Cloud managed processor path. |
| Azure Document Intelligence | Managed document AI | Typed fields, layout, tables | [docs](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview) | P2 | Enterprise Azure prebuilt receipt/invoice route. |
| ABBYY FineReader / Vantage | Legacy + enterprise OCR/document processing | Searchable PDFs, extracted fields/workflows | [FineReader](https://pdf.abbyy.com/), [Vantage](https://www.abbyy.com/vantage/) | P3 | Market reference for high-accuracy desktop/enterprise OCR; less aligned with developer-first MVP. |
| UiPath Document Understanding | OCR + RPA + human validation | Extracted fields, validation workflows | [docs](https://docs.uipath.com/document-understanding/) | P3 | Enterprise automation/RPA pattern with human validation; useful product comparison, not MVP path. |

## Secondary Comparisons And Discovery Sources

| Source | Domain | Links | Priority | How to use |
| --- | --- | --- | --- | --- |
| Hugging Face OCR open models blog | Open OCR model survey | [blog](https://huggingface.co/blog/ocr-open-models) | P1 | Discovery and comparison framing; verify claims locally. |
| Hugging Face trending OCR search | Current model discovery | [search](https://huggingface.co/models?sort=trending&search=ocr) | P1 | Use as a recurring discovery source; trending order changes and is not a benchmark. |
| LiteParse local parser blogs | Local parser/agent workflow | [v1 blog](https://www.llamaindex.ai/blog/liteparse-local-document-parsing-for-ai-agents), [v2 blog](https://www.llamaindex.ai/blog/liteparse-v2-0-runs-everywhere) | P1/P2 | Useful local-agent pattern: parse fast text first, fall back to screenshots/VLM when needed; v2 adds Rust, Python, Node, WASM, and edge/browser portability. |
| LlamaIndex OCR software comparison | Agentic vs legacy OCR market framing | [blog](https://www.llamaindex.ai/insights/best-ocr-software) | P2 | Useful decision frame and vendor discovery; biased toward LlamaParse and should be verified. |
| LlamaIndex document parsing comparison | Parser market framing | [blog](https://www.llamaindex.ai/insights/best-document-parsing-software) | P2 | Broader parsing lens that includes LlamaParse, Landing AI, Docling, cloud parsers, and PDF utilities. |
| LlamaIndex document parsing APIs comparison | API selection framing | [blog](https://www.llamaindex.ai/insights/top-document-parsing-apis) | P2 | API-focused comparison of LlamaParse, Textract, Document AI, Azure, Docling, and PyMuPDF; useful for build-vs-buy framing. |
| Fastio AI-agent OCR comparison | OCR tools for agent workflows | [blog](https://fast.io/resources/best-ocr-tools-ai-agents/) | P2 | Good agent-integration lens: APIs, storage, confidence, human review, and downstream actions. |
| OmniDocBench | Document parsing benchmark | [GitHub](https://github.com/opendatalab/OmniDocBench), [leaderboard](https://opendatalab.com/OpenSourceTools/OmniDocBench) | P1 | PaddleOCR-VL, GLM-OCR, DeepSeek, and other document parsers cite it heavily. |
| Real5-OmniDocBench | Real-world document stress benchmark | [HF dataset](https://huggingface.co/datasets/PaddlePaddle/Real5-OmniDocBench) | P2 | Useful scenario framing: scanning, warping, screen photography, illumination, skew. |
| ParseBench | LlamaIndex parsing benchmark | [blog](https://www.llamaindex.ai/blog/parsebench), [dataset](https://huggingface.co/datasets/llamaindex/ParseBench), [GitHub](https://github.com/run-llama/ParseBench), [paper](https://arxiv.org/abs/2604.08538) | P1 | Agent-oriented parser benchmark with tables, charts, content faithfulness, semantic formatting, and visual grounding. |
| MDPBench | Markdown/document parsing benchmark | [dataset](https://huggingface.co/datasets/Delores-Lin/MDPBench) | P2 | Another HF evaluation source for document parser output quality. |
| olmOCR-bench | OCR/document benchmark | [source](https://github.com/allenai/olmocr/tree/main/olmocr/bench) | P2 | DeepSeek-OCR HF card reports evaluation results on this benchmark. |
| Modal OCR comparison | Open-source OCR comparison | [blog](https://modal.com/blog/8-top-open-source-ocr-models-compared) | P2 | Useful bakeoff inspiration; not a substitute for receipt eval. |
| API4AI receipt OCR article | Product framing | [Medium](https://medium.com/@API4AI/receipt-ocr-mastery-turning-paper-slips-into-real-time-retail-data-8e0c0878e6d0) | P3 | Product/use-case framing only. |
| LinkedIn/Reddit/private chats | Practitioner leads | User-provided links | P3 | Treat as leads; cite only after reproducing or exporting stable content. |

## Current Hugging Face Trending Snapshot

Accessed 2026-06-10, the top OCR search results sorted by trending included GLM-OCR, Chandra-OCR-2, Surya-OCR-2, NVIDIA Nemotron-OCR-v2, DeepSeek-OCR-2, DeepSeek-OCR, Baidu Qianfan-OCR, dots.ocr, Falcon-OCR, ABot-OCR, Typhoon-OCR-7B, and Typhoon-OCR-1.5-2B.[^hf-ocr-trending]

How to use this:

- Re-check it before any new benchmark cycle.
- Add only official model cards/repos to the catalog.
- Do not treat likes/downloads/trending rank as accuracy.
- Prefer receipt-specific evals over model-card benchmark screenshots.

## Comparison Blog Takeaways

The LlamaIndex and Fastio articles reinforce a useful product taxonomy:

- Agentic/VLM document parsers: best when documents feed RAG, agents, structured extraction, validation, and downstream actions.
- Managed document AI: best for standardized forms, invoices, receipts, IDs, and enterprise review workflows.
- Open-source OCR: best for privacy, cost control, and local processing, but needs deployment and validation.
- PDF utilities: useful for rendering, splitting, metadata, redaction, and preprocessing, but not a replacement for OCR on scans.
- Enterprise/RPA suites: useful when extraction must plug into long-running business workflows with human validation.

The document-parsing comparison is broader than OCR: it treats OCR as one capability inside parsers that must preserve layout, tables, figures, hierarchy, and traceability. Use these blogs to discover tools and product dimensions. Do not use their rankings as benchmark evidence.

The API-specific comparison adds a practical selection checklist:

- Stack fit: AWS/GCP/Azure-native APIs are easiest if the rest of the product already lives there.
- Output contract: prefer parser APIs that produce Markdown/JSON, tables, sections, and evidence rather than plain text.
- Deployment posture: Docling/PyMuPDF stay local; commercial parser APIs are usually managed cloud.
- Customization: cloud providers offer custom processors; agentic parsers offer prompting/config/reparse loops.
- Cost and throughput: evaluate page-level pricing, batch support, and p95 latency before choosing.
- Compliance and review: high-stakes workflows need retention controls, auditability, and human-review routes.

LiteParse adds a useful local-agent pattern:

- Fast first pass: extract spatially reconstructed text locally so agents can search/triage quickly.
- Screenshot fallback: generate page screenshots only when deeper visual reasoning is needed.
- OCR flexibility: use bundled Tesseract/tesseract-rs for scanned pages or point to external OCR servers such as PaddleOCR/EasyOCR-style services.
- Output tradeoff: it favors fast text/screenshots/bboxes over high-accuracy Markdown tables or JSON schemas.
- Portability: v2 uses a Rust core with Node, Python, Rust, and WASM/browser/edge bindings.

## ParseBench Evaluation Lens

ParseBench is useful because it evaluates parser output the way downstream agents consume it, not just as raw OCR text. Its five dimensions map well to receipt OCR:

- Tables: item rows, tax summaries, split checks, and totals must preserve row/column relationships.
- Charts: less relevant for ordinary receipts, but relevant for statements/reports if product scope expands.
- Content faithfulness: no omissions, hallucinations, digit drops, or reading-order mistakes.
- Semantic formatting: discounts, struck-through prices, bold totals, footnotes, and hierarchy can change meaning.
- Visual grounding: extracted values should trace back to page/image regions for audit and correction UX.

For receipts, ParseBench should inspire the evaluation harness; it should not replace a receipt-specific gold dataset.

## Adjacent Research Leads

These should not distract the MVP, but they are worth watching because newer OCR systems cite or build around them.

| Lead | Domain | Link | Priority | Why watch |
| --- | --- | --- | --- | --- |
| GOT-OCR2.0 | General OCR model | [GitHub](https://github.com/Ucas-HaoranWei/GOT-OCR2.0) | P3 | Cited by DeepSeek-OCR/OCR-2 as an influential prior. |
| Vary | Document/image OCR prior | [GitHub](https://github.com/Ucas-HaoranWei/Vary) | P3 | Cited by DeepSeek-OCR/OCR-2; useful lineage reference. |
| OneChart | Chart recognition | [GitHub](https://github.com/OneChart/OneChart) | P3 | Relevant if receipts evolve into statements/reports with charts. |
| PP-DocLayout-V3 | Layout analysis | [PaddleOCR docs](https://www.paddleocr.ai/latest/en/index.html) | P2 | Used in GLM-OCR's two-stage layout/recognition pipeline. |

## First Benchmark Shortlist

The first serious benchmark should not include every row. It should include:

1. Gemini structured extraction.
2. Claude structured extraction.
3. Mistral OCR structured extraction.
4. PaddleOCR-VL-1.6.
5. GLM-OCR.
6. DeepSeek-OCR.
7. DeepSeek-OCR-2 if inference is practical.
8. Surya-OCR-2.
9. Chandra-OCR-2 if model size/cost is acceptable.
10. dots.mocr.
11. olmOCR.
12. Docling with RapidOCR or another OCR backend.
13. PaddleOCR 3.x non-VL pipeline.

This gives coverage across managed VLM APIs, compact open document VLMs, document conversion, and modular OCR.

[^hf-ocr-trending]: Hugging Face, "Models search: ocr sorted by trending", accessed 2026-06-10. https://huggingface.co/models?sort=trending&search=ocr
