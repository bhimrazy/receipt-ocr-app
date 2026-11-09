# Upload sizing review, 2026-11-09

How the review sheet sizes a receipt photo before upload, and a simpler rule. Read-only review of `main` at d069b5c,
prompted by the owner's iPhone 13 screenshot of a tall receipt: "800 × 1730 px · ~471 KB", with options "Smaller 800 px
· ~471 KB" and "Recommended 1001 px · ~737 KB".

## Not verified

- Nothing ran on an iPhone. Byte figures come from `sharp` (libjpeg-turbo, quality 85) on two real receipt photos in
  `packages/bench/fixtures-real/commons`. Safari's canvas encoder may produce larger files. The app's own estimate for the
  owner's photo works out to about 0.49 bytes per pixel, 3–4x what sharp measured (0.10–0.13). Both figures are shown below.
- No OCR calls. Accuracy claims rest on glyph geometry and the providers' documented resize rules, plus the
  2026-11-07 benchmark (`packages/bench/results/2026-11-07-real.md`). No resolution sweep has been run.
- Gemini 3 bills a fixed 1,120 tokens per image by default, but Google doesn't say what pixel size it resizes to.
  Groq bills Qwen 3.8 at a flat 2,048 tokens per image and doesn't describe its resize either.
- Upload times are bytes ÷ link speed (1 Mbps and 0.4 Mbps uplink). They leave out TLS and multipart overhead.

## 1. The rule today, and where 1001 px comes from

Three rules stack on top of each other, and the last one depends on bytes:

1. `planSize` (`apps/web/lib/upload-prep.ts:58-73`) fits the image to a **3 MP pixel budget**. If that leaves the
   **short edge under 1,000 px**, it raises the short edge back to 1,000. It also caps the **long edge at 6,000**
   (`:15-17`).
2. `encodeToTarget` (`:146-188`) then chases a **500 KB byte target**. It tries JPEG quality 0.85, then 0.72, then 0.6,
   and after that shrinks the image by 15% per step, but never below the 1,000 px floor. It accepts a result up to the
   1 MB ceiling (`:19-20`).
3. The options are **short-edge sizes**. Smaller is 800 px (`HARD_MIN_SHORT_EDGE`, `:26`). Larger is 1,200 px, offered
   only when the result stays at or under 2.4 MP (`:82-83`). The picker shows only the short edge
   (`components/capture/size-picker.tsx:63`). The header shows width × height (`review-sheet.tsx:604`).

**1001 px is an artifact of the 15% shrink step.** I reproduced the owner's numbers with the real functions
(`bun` script calling `planSize`, `predictEncode` and `sizeOptions`, on a 1400 × 3028 crop, aspect 1:2.16):

```
bpp@0.85=0.494 source 1400x3028 plan 1178x2547 -> smaller 800x1730 471KB | recommended 1001x2165 738KB
bpp@0.85=0.25  source 1400x3028 plan 1178x2547 -> smaller 800x1730 338KB | recommended 1001x2165 373KB
bpp@0.85=0.13  source 1400x3028 plan 1178x2547 -> smaller 800x1730 176KB | recommended 1178x2547 381KB
```

The budget gives a 1,178 px short edge. Quality runs out at 0.6, still over 500 KB, so one 15% step gives
1178 × 0.85 = 1001.3. The next step (851) would go under the floor, and 738 KB is under the ceiling, so the loop stops
there. Three consequences:

- **The numbers depend on content, not just on the photo's shape.** The same shape gives 1001 px or 1178 px depending
  on how compressible the photo is. That is why the sizes look arbitrary.
- **"Recommended" lands on quality 0.6, the lowest step.** The loop gives up quality before pixels, which is the wrong
  trade for text: JPEG ringing at 0.6 blurs thin strokes. Accuracy at 0.6 is not measured.
- **The label can differ from the file.** The sheet labels the options from a 0.3 MP render's bytes per pixel, run
  through a linear quality model (`review-sheet.tsx:109-125`). `prepareFile` runs the same loop on real encodes
  (`upload-prep.ts:278-291`). If the real encoder packs tighter than the estimate, the upload lands at a different size
  from the one shown (rows 1 vs 3 above). The full-size view's label uses the estimate, even though the image in it is
  the real file (`review-sheet.tsx:469-472`). This follows from reading the code; I did not observe it on a device.

The 800 × 1730 header means this session had remembered Smaller (`SIZE_KEY` in sessionStorage, `review-sheet.tsx:185`).

## 2. What drives accuracy, and what drives cost and latency

**Accuracy depends on pixels per millimetre of paper, so for a receipt that means width.** Thermal printers print at
203 dpi, which is 8 dots/mm. Font A is a 12 × 24-dot cell, giving 48 columns on 80 mm paper. At output width W across
80 mm paper:

| Width sent | px/mm | Font A cell (px) | Verdict                                                     |
| ---------- | ----- | ---------------- | ----------------------------------------------------------- |
| 1,000      | 12.5  | 19 × 38          | Margin for blur and perspective                             |
| 800        | 10    | 15 × 30          | Fine when the photo is sharp                                |
| 644        | 8     | 12 × 24          | Same as the printer's dot pitch; the practical minimum      |
| 500        | 6.3   | 9 × 19           | Below dot pitch; small print (Font B, 9 × 17 dots) degrades |
| 270        | 3.4   | 5 × 10           | Unreadable: one 28 px Claude patch spans about 5 characters |

**Cost and latency depend on total pixels and on bytes, but the model cost is negligible.** From current provider
docs:

- **Claude Haiku 5.5** is on the high-resolution tier ("Claude 4.7 and later"). It reads up to **2,576 px on the long
  edge** and **4,784 visual tokens**, at ⌈w/28⌉ × ⌈h/28⌉ tokens. Anything larger is downscaled server-side to fit both
  limits (platform.claude.com vision and vision-coordinates pages, checked 2026-11-09). At $0.10/M input
  (`packages/ai/src/models.ts:137-142`), the owner's 1001 × 2165 image is 2,808 tokens, or **$0.00028**.
- **Gemini 3.5 Flash-Lite** spends a **fixed 1,120 tokens** at the default `media_resolution`, which we don't set
  (`extract.ts:199-227`). That is $0.00034 whatever size we send. Google says "quality typically saturates at
  `medium`" for documents (aistudio.google.com/docs/media-resolution).
- **Qwen 3.8 on Groq** is billed **2,048 tokens per image**, flat, with a 20 MB request cap (console.groq.com/docs/vision).
  That is $0.0016 at the paid rate.

So moving from Smaller to the native maximum adds about $0.0002 per receipt on Haiku and nothing on the fallbacks. **The
real cost of size is upload time on mobile data and model prefill.** The 2026-11-07 benchmark measured 0.3–0.5 s
faster calls with the app's shrinking, at no accuracy cost.

**A pure long-edge cap (1080 or 800) would hurt long receipts.** A 1:2.16 receipt at a 1,080 long edge is 500 px wide
(6.3 px/mm), and a 1:4 receipt is 270 px wide (3.4 px/mm). Both fall below the printer's own dot pitch. The owner is
right on two points, though:

- Today's 6,000 px long-edge cap is waste. Claude throws away everything past 2,576. A 1:4 receipt sent at
  1000 × 4000 (5,148 tokens) is read at 644 × 2576.
- The picker should describe the whole image, not one edge.

For receipts longer than about 1:2.6, one image can't carry both the width floor and the whole length. That is the
multi-part plan's job (`docs/plans/2026-11-07-long-receipt-capture.md`, auto-tiling above about 1:2.5), not a job for
a bigger single upload.

## 3. Recommended rule

**Fit to what the primary model reads, keep the aspect ratio, and encode once.**

```
scale = min(1, √(budget / (w·h)))                // pixel budget per option
if short·scale < floor: scale = min(1, floor / short)
scale = min(scale, 2576 / long)                  // Claude's native long edge; never sent past it
shrink until ⌈w/28⌉·⌈h/28⌉ ≤ 4784                // Claude's token cap (only binds near 1:1)
encode once at JPEG 0.85; only if > 1.5 MB, retry at 0.75 (never below the floor)
```

The size then depends only on the photo's shape and the chosen option, never on how compressible it is. That removes
1001 px, the 0.6-quality endpoint and the label/file mismatch, and it deletes most of `encodeToTarget` and
`predictEncode`. Optionally, round the long edge down to a multiple of 28 so Claude adds no padding.

| Option (label)            | Budget / floor           | Normal 1:1.4 | Owner's 1:2.16 | Long 1:4 |
| ------------------------- | ------------------------ | ------------ | -------------- | -------- |
| **Faster upload**         | 1.0 MP / 800 px wide     | 845 × 1183   | 800 × 1730     | 644 × 2576 |
| **Standard** (default)    | 2.0 MP / 1,000 px wide   | 1195 × 1673  | 1000 × 2163    | 644 × 2576 |
| **Sharpest**              | model max (2,576 / 4,784 tok) | 1624 × 2273 | 1191 × 2576 | 644 × 2576 |

Bytes, upload time and Claude tokens per option. These are computed from the sharp bytes per pixel (0.11–0.13), with
the app's own 0.49 B/px estimate as an upper bound in brackets:

| Receipt | Option        | Claude tokens (Haiku $) | KB                 | 1 Mbps            | 0.4 Mbps           |
| ------- | ------------- | ----------------------- | ------------------ | ----------------- | ------------------ |
| 1:1.4   | Faster upload | 1,333 ($0.00013)        | 107–127 (482)      | 0.9–1.0 s (3.9)   | 2.1–2.5 s (9.6)    |
| 1:1.4   | Standard      | 2,580 ($0.00026)        | 215–254 (964)      | 1.7–2.0 s (7.7)   | 4.3–5.1 s (19)     |
| 1:1.4   | Sharpest      | 4,756 ($0.00048)        | 397–469 (1,781)    | 3.2–3.8 s (14)    | 7.9–9.4 s (36)     |
| 1:2.16  | Faster upload | 1,798 ($0.00018)        | 149–176 (668)      | 1.2–1.4 s (5.3)   | 3.0–3.5 s (13)     |
| 1:2.16  | Standard      | 2,808 ($0.00028)        | 232–275 (1,043)    | 1.9–2.2 s (8.3)   | 4.6–5.5 s (21)     |
| 1:2.16  | Sharpest      | 3,956 ($0.00040)        | 330–389 (1,480)    | 2.6–3.1 s (12)    | 6.6–7.8 s (30)     |
| 1:4     | (all one)     | 2,116 ($0.00021)        | 178–211 (800)      | 1.4–1.7 s (6.4)   | 3.6–4.2 s (16)     |

Gemini costs 1,120 tokens ($0.00034) and Qwen 2,048 ($0.0016) for every row. The bracketed column is the risk: if
Safari really produces about 0.5 B/px at quality 0.85, Standard is about 1 MB. **Before choosing the quality, log real
file size and dimensions from a few iPhone uploads** (see section 4).

**Picker.** Label each option in plain words with its outcome, for example "Standard · 1000 × 2163 · 240 KB". Drop the
single "800 px" figure. When the options come out the same, as on a long receipt above about 1:2.6, hide the picker
and say: "Long receipt: read at 644 px wide. For small print, add a second photo" (this links to multi-part capture
when it ships). Keep the existing B&W warning.

**Full-output preview.** As soon as the preview step opens, encode Standard for real, and encode the other options
when one is chosen. One encode at a fixed quality is cheap enough to do eagerly; speed on device was not measured.
Then show **the encoded JPEG itself**, not a re-render of the edit, in two views:

- Fitted, showing the whole receipt.
- "Actual pixels", at **one image pixel per device pixel**: CSS width = W ÷ `devicePixelRatio`. On an iPhone 13 (DPR 3),
  a 1,000 px image is 333 CSS px wide, so the full width fits on screen exactly as the model receives it, with no
  interpolation. Pinch to zoom in further.

The caption comes from the blob, not an estimate: "Uploads exactly this: 1000 × 2163 px · 241 KB JPEG". The current
full-size view (`full-size-view.tsx`) already shows the real file, at one image pixel per CSS pixel. It needs the
fitted mode, the DPR scaling and a truthful label.

**Also simpler and faster.** Today a photo is rendered to a JPEG at quality 0.92 at up to 6 MP (`render.ts:238-246`),
then decoded and re-encoded by `prepareFile`, up to 6 times. Rendering the straightened crop directly at the planned
size and encoding once saves one full encode and decode, and cuts peak canvas memory on iOS. Picked files that skip
review keep the same `prepareFile` path with the new plan.

## 4. Keep, and tests to add

Keep:

- **`size_choice` telemetry** (`upload-request.ts:16-17`, `api/receipts/route.ts:62-65`, `telemetry/schema.ts:105`).
  Keep the ids `smaller` / `recommended` / `larger` and change only the labels, so existing events still compare.
- **The 4 MB browser limit** under Vercel's 4.5 MB body cap (`packages/core/src/upload-limits.ts`). Sharpest at the
  pessimistic estimate is 1.8 MB.
- **EXIF/GPS stripping**: every decodable image is re-encoded, even when the result is larger
  (`upload-prep.ts:298-307`). Keep that, plus the decode-failure fallback.
- `imageOrientation: "from-image"`, the white fill for PNG alpha, never upscaling, and the session-remembered choice.

Add:

- **Telemetry**: `file.width` / `file.height` on the upload event, read from the header with `packages/ai`'s
  `imageSize`. These carry no PII and need a field audit. With them, real Safari bytes per pixel can be read from prod
  instead of guessed.
- **Unit (`upload-prep.test.ts`)**: aspect kept within 1 px; long edge ≤ 2,576 and Claude tokens ≤ 4,784 for every
  option; the Standard width floor holds up to 1:2.57; output depends only on shape (same dimensions with two fake
  encoders of different bytes per pixel); a 1:4 receipt collapses to a single option; never upscales. A
  random-dimensions property test over these invariants.
- **Component/e2e (`e2e/capture.spec.ts`)**: the size caption equals the uploaded file's decoded dimensions and
  `file.size`, and `size_choice` is still sent.
- **Benchmark**: add a `budget:<MP>/<floor>` prep to `packages/bench/prep.ts`, and a set of real phone-crop long
  receipts (1:2 to 1:5; today's `long-groceries.png` is a synthetic 420 × 891). Run
  `--prep app,long:1080,short:640,short:800,short:1000,budget:2/1000` on Haiku and Flash-Lite, with a dry run first.
  That turns the glyph table into measured accuracy.

## Owner decisions (recommended default first)

1. **Sizing rule**: pixel budget with a width floor and a 2,576 px long-edge cap, size set by shape alone
   (**recommended**), vs. a pure long-edge cap at 1080/800 (unreadable below about 1:2), vs. keeping the byte target.
2. **Options**: Faster upload / **Standard (default)** / Sharpest, at 1 MP·800 / 2 MP·1,000 / model max.
3. **JPEG quality**: **fixed 0.85, one retry at 0.75 above 1.5 MB** (recommended), vs. keeping the 500 KB target loop.
   Revisit once real iPhone bytes per pixel are in telemetry.
4. **Long receipts (above about 1:2.6)**: **hide the picker and point to adding a part** (recommended), vs. still
   sending more than 2,576 px, which Claude discards.
5. **Preview**: **encoded file, fitted plus "Actual pixels" at device-pixel scale, caption from the blob**
   (recommended), vs. keeping today's CSS-pixel full-size view with the estimate label.
6. **Gemini `media_resolution`**: **leave the default** (1,120 tokens); revisit only if the benchmark shows Flash-Lite
   losing small print.

## Owner decisions, 2026-11-09

The owner took every recommended default above, with one change to decision 3 and one correction to decision 4.

1. Sizing rule: pixel budget with a width floor and Claude's native limits (2,576 px long edge, 4,784 patches), set by
   shape alone. **Decided.**
2. Options: Faster upload 1 MP / 800 px, **Standard** 2 MP / 1,000 px (default), Sharpest at the model's maximum. The
   `size_choice` ids stay `smaller` / `recommended` / `larger`. **Decided.**
3. **Changed: file size.** Normal photos should land at about 500–700 KB or less, and 1.5 MB is only for exceptional
   cases (for example Sharpest on a dense receipt), so there is no fixed 0.85 with a 1.5 MB retry. Tuned with the
   [compression research](2026-11-09-image-compression.md), the encoder follows one config (`ENCODING` in
   `apps/web/lib/upload-encoding.ts`): JPEG from the canvas with `blob.type` checked; quality 0.80, then 0.72, then 0.65
   (the floor); the first result under the option's target is kept (500 KB Faster upload, 700 KB Standard, 1 MB
   Sharpest); anything up to the 1.5 MB hard cap is sent; over it, one more encode at Faster upload's size at 0.72,
   and the photo is refused with a clear message if that is still over. The size shown is always the real encoded
   file's. Revisit the numbers once production bytes per pixel from iPhones are in telemetry.
4. Long receipts above about 1:2.6: hide the picker. **Corrected:** multi-part capture is not built yet, so nothing
   links to or promises "add a part". The receipt goes at Sharpest (capped at 2,576 px on the long edge, within the
   byte ladder) with the note "Long receipt: sent at the highest size the model reads." The threshold is one constant,
   `LONG_RECEIPT_RATIO` in `upload-prep.ts`, where multi-part capture will hook in.
5. Preview: the encoded file, whole or at "Actual pixels" (device-pixel scale), with a caption read from the file.
   **Decided.**
6. Gemini `media_resolution`: left at the default. **Decided.**

Telemetry added as section 4 asked, plus the compression review's fields: `file.width`, `file.height` and
`file.bytes_per_pixel` (read on the server from the uploaded bytes' header) and `encode.quality`, `encode.attempts`,
`encode.filter`, `encode.rescued` (sent by the browser, checked against our own values). None can carry PII.
