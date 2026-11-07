# Long receipts that don't fit one photo (2026-11-07)

Supermarket bills with 30+ lines (Bhat-Bhateni's are long and narrow) don't fit one legible photo. This plan compares the
ways to capture them, checks what the models accept, and recommends one pipeline change. It builds on the in-app camera
in PR #47 (`apps/web/lib/capture/` on `feat/capture`: crop, straighten and filters on one image, a batch tray where every
photo becomes its own receipt) and on the upload shrinker in `apps/web/lib/upload-prep.ts`.

## TL;DR

- **Recommend multi-part receipts:** one receipt with 1–4 image parts, sent to the model as several images in one request.
  Two things feed it: an "Add part" button in the review sheet, and automatic splitting of a single tall photo into
  overlapping tiles in the browser.
- **Do not stitch.** A stitched tall image gets shrunk by both models to the same pixel budget as one far-away photo:
  Claude caps the long edge at 2,576 px and Gemini 3 spends a fixed 1,120 tokens per image. Separate parts keep 2–3x the
  pixels per line.
- **Both providers take many images per request.** Claude takes up to 100 or 600, depending on the context window, and
  Gemini up to 3,600. Three parts cost about 9,300 input tokens on Claude, compared with about 1,750 for one shot (Haiku: +$0.0008
  per receipt), and 3,360 compared with 1,120 on Gemini.
- **Effort: about 4–5 days.** A `receipt_files` table, an upload API that takes parts, a job that loads every part, the
  prompt, "Add part" in the review sheet, a gallery on the detail page, and benchmark fixtures split into parts.
- A one-day shortcut exists: pack the parts into a multi-page PDF in the browser. It needs no backend change, but the
  detail page then shows only a PDF icon, and Gemini reads PDF pages at 560 tokens unless told otherwise. It is
  worth knowing about; it is not the recommendation.

## 1. Options

| Option                                                | How it works                                                                                              | Accuracy                                                                                                                                                                                                               | Cost on phones                                                                                                                                                                                                                                                                                                                                      | Verdict                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **(a) Multi-part capture**                            | The user takes 2–N overlapping photos; the app uploads them as one receipt; the model reads them together | Best: each part fills the frame, so about 15 px per mm of paper instead of about 6 after the model's downscale. Overlap risk: a line counted twice, or a real repeated line dropped                                    | None beyond what #47 already does per photo                                                                                                                                                                                                                                                                                                         | **Yes**                                                                |
| (b) On-device stitching (OpenCV.js, feature matching) | Match features in the overlap, warp, blend into one tall image                                            | Thermal receipts are low-texture (white paper, repeated glyphs), which is hard for feature matching. Seams can duplicate or cut a line. Then the model shrinks the tall result anyway (§2)                             | `@techstark/opencv-js` 5.0.0 unpacks to 14.7 MB (`npm view`); 2019–2020 forum reports of 4–8 MB for official builds trimmed by module ([OpenCV forum](https://answers.opencv.org/question/229032/opencv_jswasm-is-too-large)). Whether the stitching module is in those builds is **unverified**. #47 deliberately has no OpenCV (`detect-quad.ts`) | No                                                                     |
| (c) Video or continuous scan                          | Record while sliding down the receipt; pick sharp frames or stitch                                        | The same stitching problems, plus motion blur; needs frame selection                                                                                                                                                   | Continuous camera plus per-frame processing; battery and memory on low-end Android                                                                                                                                                                                                                                                                  | No (maybe later as a way to _pick_ parts)                              |
| (d) One high-res photo, tiled                         | Keep one photo; split a tall image into overlapping tiles before the model call                           | Keeps whatever pixels the photo has (about 10 px/mm for a 40 cm receipt in a 4,000 px frame), instead of the models' downscale to about 6. Does not help focus: a far shot of a long receipt is often soft at the ends | A canvas crop in the browser, the same code path as `render.ts`; no new dependency                                                                                                                                                                                                                                                                  | **Yes, automatically**, for photos taller than about 1:2.5 (feeds (a)) |
| (e) Ask users to fold or step back                    | Copy in the camera                                                                                        | Folding hides lines and creases thermal paper; stepping back loses resolution                                                                                                                                          | Free                                                                                                                                                                                                                                                                                                                                                | Only as a hint, next to "Add part"                                     |

What known apps do:

| App                           | Long-receipt handling                                                                                                                                                                                  | Source                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dext                          | **Combine mode**: "one long or double-sided receipt or bill, up to 50 photos. All the photos become 1 document"; auto-snap is off in Combine. Whether they are stitched or kept as pages is not stated | [Dext help](https://help.dext.com/en/s/article/How-to-use-the-mobile-app-to-upload-paperwork)                                                            |
| Veryfi                        | Stitch up to 4 captures; "everything will appear as one PDF"                                                                                                                                           | [Veryfi FAQ](https://faq.veryfi.com/en/articles/1616079-how-to-put-multiple-receipts-into-one-transaction)                                               |
| Zoho Expense                  | **Multipage** (iOS) combines the pages of a receipt into one PDF; up to 5 receipts of 7 MB per expense                                                                                                 | [Zoho Expense help](https://www.zoho.com/ae/expense/help/receipts/)                                                                                      |
| Expensify                     | Advises one photo with top and bottom visible; for multi-page receipts staff suggest photographing the page with merchant, date and total. No official stitching found                                 | [Expensify blog](https://use.expensify.com/blog/how-to-upload-receipt), [community](https://community.expensify.com/discussion/comment/16601)            |
| Microsoft Lens                | Multi-page capture into one file (up to 50); **retired**: removed from stores 9 Feb 2026, scanning ended 9 Mar 2026, OneDrive scan suggested instead                                                   | [CVTC KB](https://kb.cvtc.edu/97822), [BetaNews](https://betanews.com/2026/01/13/microsoft-lens-really-is-closing-down-in-a-matter-of-weeks/)            |
| Adobe Scan, Google Drive scan | "Add page" into one multi-page PDF; no long-receipt stitching found (secondary sources only)                                                                                                           | [Android Police](https://www.androidpolice.com/how-to-scan-documents-android/), [GeeksforGeeks](https://www.geeksforgeeks.org/?p=1119659)                |
| Xero Expenses                 | Not supported; an open request to "combine multiple photos to one receipt"                                                                                                                             | [Xero product ideas](https://productideas.xero.com/forums/967118-payroll-expenses/suggestions/45331438-xero-expenses-ability-to-combine-multiple-photos) |

The pattern: the expense apps that solve it keep **several pages in one document**. None of the documented ones says it
stitches.

## 2. Model side

### Multiple images per request

| Provider                         | Images per request                                                                                                                           | Size limits                                                                                                                                                                                                           | Source                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Claude (Haiku, Sonnet, Opus 5.5) | 100 for models with a 200k context window, 600 otherwise. Above 20 images a stricter per-image dimension limit applies (stay under 3,000 px) | 8000×8000 px, 10 MB base64 per image, 128 MB per request. Haiku, Sonnet and Opus 5.5 are high-resolution tier ("Claude 4.7 and later"): long edge 2,576 px, at most 4,784 visual tokens; bigger images are downscaled | [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision#image-limits-and-costs) |
| Gemini 3.x Flash                 | Up to 3,600 image files                                                                                                                      | 20 MB total for inline data per request (else the File API)                                                                                                                                                           | [Gemini image understanding](https://aistudio.google.com/docs/image-understanding)                   |

The AI SDK takes several `{ type: "file" }` parts in one user message, which is how `extractWith` in
`packages/ai/src/extract.ts` already sends one. `@ai-sdk/google` 4.0.106 (our lockfile) has a `mediaResolution` option,
including `ultra_high`, so the Gemini resolution can be raised per call if the benchmark shows it helps.

### Image tokens: N parts vs one tall image

Rules: Claude `⌈w/28⌉ × ⌈h/28⌉` after downscaling to the tier limits
([vision](https://platform.claude.com/docs/en/build-with-claude/vision#resolution-and-token-cost)); Gemini 3 a fixed 280 /
560 / **1,120 (default)** / 2,240 tokens per image, and 560 per PDF page by default
([media resolution](https://aistudio.google.com/docs/media-resolution)).

Worked example: a 40 cm × 8 cm Bhat-Bhateni-style receipt.

| Capture                                               | Sent                                         | Claude: processed as | Claude tokens | Gemini tokens (default) | Pixels per mm of paper the model sees                        |
| ----------------------------------------------------- | -------------------------------------------- | -------------------- | ------------- | ----------------------- | ------------------------------------------------------------ |
| One far shot (receipt is about 800×4000 of the frame) | 800×4000                                     | 515×2576             | about 1,750   | 1,120                   | about 6 (Claude); Gemini's internal resize is not documented |
| Stitched from parts                                   | 1200×6000 (shrinker caps long edge at 6,000) | 515×2576             | about 1,750   | 1,120                   | about 6: the stitching gain is lost                          |
| One far shot, tiled into 3 with 15% overlap           | 3 × 800×1550                                 | unchanged            | about 4,900   | 3,360                   | about 10                                                     |
| **3 overlapping parts**, each filling the frame       | 3 × 1200×2000                                | unchanged            | about 9,300   | 3,360                   | about 15                                                     |

Cost of three parts over one shot, per receipt: Haiku 5.5 +$0.0008, Sonnet 5.5 +$0.015, Gemini 3.8 Flash +$0.0017
(input prices from `packages/ai/src/models.ts` and PR #59). Output does not grow: it is the same receipt.

### Prompt

Text first, then the parts in order, each preceded by a short label. Google's guidance is text before images
([image understanding](https://aistudio.google.com/docs/image-understanding)). Added to the prompt only when there is more than one
part:

> The N images are consecutive photos of ONE receipt, from top to bottom, in order. Neighbouring images overlap: a line at
> the bottom of one image that appears again at the top of the next is the same line, so include it once. Return a single
> receipt. Take the merchant from the first image and the totals from the last.

Plus `Part 1 of 3`, `Part 2 of 3`... as text parts before each image. Two risks remain: a real repeated line (two
separate "Milk 1L" lines) dropped as overlap, and an overlap line counted twice. The arithmetic check on the extraction
cost and accuracy roadmap (items sum to subtotal, subtotal plus tax equals total) catches both, so ship it with or before
multi-part.

## 3. What our pipeline needs

Today one receipt is one file: `receipts.image_object_key` and `file_name`
(`packages/db/src/index.ts`), one `file` field in `POST /api/receipts` (`apps/web/lib/capture/upload-request.ts`), one
`storage.put` in `packages/core/src/pipeline.ts`, and `ExtractReceiptInput.file` in `packages/ai`.

| Piece              | Change                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB                 | **`receipt_files` table** (`receipt_id` FK with cascade, `position`, `object_key`, `media_type`, `bytes`, `width`, `height`, unique `(receipt_id, position)`, RLS like the other tables after #57). Keep `receipts.image_object_key` as the first part during a transition, then drop it. An array column on `receipts` is simpler but makes per-file metadata, cleanup and RLS awkward |
| Storage            | One key per part from `packages/storage` (`…/<receiptId>/<position>.jpg`); delete removes every key; BYOK storage follows the receipt's `storage_source`                                                                                                                                                                                                                                |
| Upload API         | `file` may repeat up to `MAX_PARTS` (4). Each part goes through `validateUpload`; total bytes under `DEPLOYMENT_BODY_LIMIT_BYTES` (4 MB, Vercel's 4.5 MB limit). Four parts at the shrinker's 500 KB target fit; at its 1 MB ceiling they do not, so the browser lowers the per-part target when there are several. Parts are images only; a PDF stays a single file                    |
| Quota and usage    | One receipt counts once against quota. The ledger already records actual tokens, so the extra input is priced correctly                                                                                                                                                                                                                                                                 |
| Job and OCR input  | `receipt-extract-job` loads all parts in `position` order; `ExtractReceiptInput.file` becomes `files: [...]` (one entry for today's case). `extractWith` adds the part labels and the multi-part prompt line. The fixture provider keys on the first part                                                                                                                               |
| Review UI (#47)    | "Add part" in the review sheet opens the camera for the same receipt; parts show as a vertical strip with reorder and remove; each part has its own crop and filter (`EditState` per part). The tray counts a multi-part receipt as one against `batchMax`. Copy in the camera: "Doesn't fit? Take it in parts, with a little overlap"                                                  |
| Auto-tiling (d)    | In `prepare-photo.ts`, after crop, a photo taller than about 1:2.5 becomes 2–3 overlapping tiles (15% overlap) instead of one shrunk image. The user sees one receipt                                                                                                                                                                                                                   |
| Detail page        | `receipt-result.tsx` shows the parts as a vertical strip, with "Open full size" per part                                                                                                                                                                                                                                                                                                |
| Delete and cleanup | Every place that reads `image_object_key` reads parts instead: signed URLs and receipt delete (`pipeline.ts`), workspace and account cleanup (`admin.ts`, `repository.ts`)                                                                                                                                                                                                              |
| Architecture docs  | `docs/architecture/` pages for the data model and the upload flow, in the same PR                                                                                                                                                                                                                                                                                                       |

PDFs: a multi-page PDF is already one file the model reads as pages (`MAX_PDF_PAGES` = 10,
`packages/core/src/upload-limits.ts`), so nothing changes for it.

The shortcut, for comparison: pack the parts into one image-per-page PDF in the browser (a small hand-written writer that
embeds JPEGs; no dependency) and upload that. There is no DB or API change. The costs: the detail page shows "This receipt
is a PDF" and not the image; Gemini reads PDF pages at 560 tokens by default (raise with `mediaResolution`); Claude
adds extracted-text tokens per page; and "Open PDF" replaces the image preview. It is a fallback if the 4–5 days are not
available.

## 4. Recommendation and benchmark

1. **Before building:** measure. Add long-receipt fixtures to the benchmark (below) and run them as one shot, auto-tiled
   and as parts on Haiku and Gemini Flash (a few cents). If the one-shot item F1 is already within a few points of the
   parts, ship only auto-tiling (about 1 day) and the camera hint.
2. **Build multi-part receipts:** about 4–5 days.
   - Schema, storage and upload API: about 1.5 days.
   - Job, `packages/ai` input and prompt: about 0.5 day.
   - Review sheet "Add part" and the parts strip on #47's components: about 1.5 days.
   - Detail page, delete and cleanup: about 0.5 day.
   - Tests and e2e: about 0.5–1 day.
3. **Skip** stitching, video scan and fold instructions.

Benchmark fixtures: 8–10 long receipts from the owner's Nepal set
([receipt benchmark set](2026-11-07-receipt-benchmark-set.md#4-building-our-own-nepal-set-3050-receipts)), each as
`<id>.whole.jpg` (one far shot) plus `<id>.part1.jpg`…`<id>.part3.jpg` (about 15–20% overlap), sharing one `<id>.json`
ground truth. `bench/ocr.ts` learns to send all `partN` files as one request and reports three rows per model: whole,
tiled and parts. Score item F1 and `total` (overlap errors show up there first), plus a "duplicated line" count:
predicted items that match one truth item twice.

## Sources not verified

- Whether Dext stitches or keeps pages, and what Adobe Scan and Google Drive do with long receipts beyond multi-page PDFs.
- OpenCV.js stitching-module availability and its current wasm size.
- How Gemini 3 internally resizes a very tall image at the default resolution.
- The token figures above are calculated from the documented rules, not measured.
