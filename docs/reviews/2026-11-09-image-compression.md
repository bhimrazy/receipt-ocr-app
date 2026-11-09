# Image compression research, 2026-11-09

How large sites shrink user photos, what applies to receipt text, what a phone browser can encode, and what Receipt OCR
should do. Follow-up to [`2026-11-09-upload-sizing.md`](2026-11-09-upload-sizing.md), which fixed the pixel sizes
(Faster 1 MP / 800 px wide, Standard 2 MP / 1,000 px, Sharpest up to 2,576 px) and proposed JPEG 0.85 with a retry at
0.75 above 1.5 MB. The owner wants normal photos at about 500-700 KB or less, and 1.5 MB only in exceptional cases.

## Not verified

- **No iPhone was available.** Every byte figure below is from `sharp` 0.35.5 (libvips 8.18.7), not from Safari's canvas
  encoder. The owner's screenshot implies Safari writes about 0.49 bytes per pixel at quality 0.85, against 0.10-0.17
  measured here with libjpeg-turbo. Until a device log exists, treat Section 6's quality ladder as a starting point.
- **Big-site claims are mostly secondary.** I found no engineering post from Instagram, WhatsApp, LinkedIn, Microsoft Lens or Adobe
  Scan with numbers. Section 1 marks each claim as official, third-party or inferred. Search quality was poor; several
  primary pages (Dropbox Lepton, X engineering blog) returned 404 or 403 to my fetches.
- **Safari 17-19 canvas format support is not tested.** Section 3 gives what is documented and how to detect it at runtime.
- **Text legibility was not measured by OCR.** No benchmark was run. "No visible loss" is judged by size and codec
  behaviour, not by accuracy; Section 6 says how to measure it.
- The fixtures are already-downscaled web photos, so they are cleaner than a fresh 12 MP iPhone capture. Sensor noise
  raises bytes at the same quality.

## 1. What large sites do

| Service                         | What it does                                                                                                         | Source and confidence                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Twitter/X                       | Re-encodes JPEGs over 5 MB or 4,096 px to JPEG quality 85; PNGs kept only if small compared with a JPEG equivalent. | Third-party report of a 2018 announcement ([TechRadar](https://techradar.com/news/twitter-will-no-longer-downgrade-the-quality-of-your-jpegs-in-tweets), [shkspr.mobi](https://shkspr.mobi/blog/2018/03/how-to-avoid-jpg-compression-on-twitter/)). Undated since. Server-side. |
| Instagram                       | Resizes to about 1,080 px wide, re-encodes as JPEG, strips EXIF, converts to sRGB. Quality guesses range 70-85.       | Third-party only ([Ayrshare docs](https://www.ayrshare.com/docs/media-guidelines/instagram.md), blog tests). Quality is **inferred**. Server-side. |
| Facebook                        | Funded and trialled mozjpeg (about 5% smaller on average, up to 15%) in 2014. For tiny previews it ships a fixed JPEG header, fixed quantisation table (Q20) and fixed Huffman table so only about 200 bytes cross the wire. | Official: [Mozilla](https://blog.mozilla.org/en/mozilla/improving-jpeg-image-encoding/) and [Facebook engineering](https://engineering.fb.com/2015/08/06/android/the-technology-behind-preview-photos/). The 2014 figures are old. |
| WhatsApp                        | Sent "as photo": long edge about 1,600 px, JPEG, quality reported at 60-70, roughly 60-120 KB. "Send as document" leaves the file untouched. | Third-party, e.g. [DEV write-up](https://dev.to/samma1997/whatsapp-image-quality-loss-fix-it-before-sending-2026-223). Client-side on send; numbers shift between versions, so **undated**. |
| LinkedIn                        | Reported to convert most uploads to JPEG and recompress large ones.                                                  | No engineering source found. **Unverified.**                                                                                        |
| Google Photos "Storage saver"   | Downsizes photos above 16 MP to 16 MP, compresses, may convert to JPEG, **does not keep the original**. "Original quality" keeps it. | Official: [Google Photos Help](https://support.google.com/photos/answer/6220791).                                                  |
| Dropbox                         | Lepton: lossless server-side JPEG recompression, about 22% savings, bit-exact reconstruction. Not applicable to fresh uploads we re-encode anyway. | From memory of the 2016-17 Dropbox post; the URL I tried returned 404. **Unverified here.**                                         |
| WordPress 7.1                   | Browser-side processing with wasm-vips in a worker, "MozJPEG-like" output, about 15% smaller JPEGs, fallback quality 0.82. The roughly 13 MB worker download is gated to fast connections, more than 2 GB RAM, 2+ cores. | Official: [make.wordpress.org, 2026-07-22](https://make.wordpress.org/core/2026/07/22/client-side-media-processing/). A useful warning about wasm cost on phones. |
| Adobe Scan / Microsoft Lens     | No public quality settings. Adobe Scan exposes no resolution setting (2019 community answer); Acrobat's desktop scanner lists JPEG for colour and grey, JBIG2 for 1-bit pages. Lens: nothing found. | [Adobe community](https://community.adobe.com/t5/adobe-scan-discussions/how-to-change-resolution-of-the-scan/td-p/10685154), [Adobe scanned PDF settings](https://helpx.adobe.com/acrobat/desktop/create-documents/scan-documents-to-pdfs/scanned-pdf-settings.html). Mobile internals **unknown**. |

Patterns that hold across the sources that exist:

1. **Resize first, then encode once.** Everyone caps dimensions (1,080 to 4,096 px) and encodes JPEG at roughly 70-85.
2. **JPEG stays the upload format.** WebP and AVIF are used on the delivery side from a stored master, not as the upload
   format, because browsers cannot reliably produce them (Section 3).
3. **mozjpeg-class encoders save 5-15%** over baseline libjpeg, at more CPU. Facebook is the only large site with a
   first-party source on this.
4. **Sites that keep originals do so deliberately** (Google Photos' "Original quality", WhatsApp's document mode).
   Most social sites keep only the re-encoded copy.
5. Not found: any site publishing chroma subsampling or progressive-vs-baseline choices. The common default (4:2:0) is
   **inferred**.

For Receipt OCR the first two apply directly. We never display the photo at large size, so we can pick the encoding
that suits the OCR model, not human viewers.

## 2. What is different about text images

These points come from how the codecs work; the byte numbers are measured in Section 5, the legibility effects are not.

- **JPEG ringing.** DCT blocks of 8 x 8 pixels spread high-contrast edges into mosquito noise next to strokes. Thin
  thermal-printer strokes (1-2 px at 800-1,000 px wide) are the worst case. Below about quality 60-65 the noise starts to
  touch glyph shapes; at 75-85 it stays faint. The 2026-11-09 sizing review already flagged quality 0.6 as the wrong
  trade. **Inferred, not OCR-tested.**
- **4:2:0 vs 4:4:4.** 4:2:0 halves chroma resolution in both axes. Black text on white has almost no chroma, so 4:2:0
  loses nothing visible. 4:4:4 cost +3% to +25% in the table below with no gain for a grey receipt. Coloured logos and
  stamps blur slightly; they do not matter for extraction.
- **Greyscale.** A true 1-component JPEG saves the two chroma planes. On the colour photo fixture that was 11-12% smaller
  at the same quality; on the receipts that were already near-neutral it was identical (chroma of a neutral image
  costs almost nothing). So greyscale is worth about 0-12%, not "much smaller". Canvas cannot write a 1-component JPEG
  (Section 3), so the practical way is to draw a grey image and let the encoder code flat chroma.
- **PNG / 1-bit.** Lossless PNG of a grey photo is 4-8 times larger than JPEG (298-1,341 KB in the table). It only wins
  after thresholding: a 1-bit palette PNG of a 1,000 px receipt was 24-42 KB. But thresholding throws away information
  the model uses (faint print, shadows, creases to infer the receipt boundary), and a hard threshold on a shadowed photo can
  erase half the receipt. Use it only for the explicit B&W filter output, and only if the filter result is already
  1-bit by construction.
- **WebP / AVIF on text.** At comparable settings lossy WebP was 3-30% smaller than libjpeg-turbo JPEG and AVIF 40-60%
  smaller. AVIF's smoothing can blur small print, and neither is encodable from a canvas on iPhone (Section 3), so this
  is a server-side option only.

## 3. What the browser can do (iPhone 13, Safari 17-19)

| Capability                                   | Status                                                                                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toBlob("image/jpeg", q)`                    | Works everywhere; `q` is 0-1 ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)). The only lossy format we can rely on.                           |
| `toBlob("image/webp")`                       | Unsupported types silently return **PNG** (MDN). WebKit bug [226950](https://bugs.webkit.org/show_bug.cgi?id=226950) was closed WONTFIX in 2021 ("the underlying frameworks do not support WebP encoding"). Whether Safari 17-19 changed this is **unverified**; assume PNG. |
| `toBlob("image/avif")`                       | Reported as Chromium-only; Safari not supported. **Secondary sources, unverified for 17-19.**                                                                                    |
| JPEG XL                                      | Not encodable from a canvas in any shipping browser that I could confirm. Decode support is irrelevant here.                                                                     |
| Chroma subsampling, progressive, tables      | **No control.** The canvas API exposes only quality. Safari uses Apple's own encoder (inferred); the owner's 0.49 B/px suggests it is less efficient than libjpeg-turbo.            |
| Detecting a silent fallback                  | Check `blob.type` after encoding; `upload-prep.ts:261-270` and `capture/render.ts:227-233` should assert `image/jpeg` and treat anything else as a failure.                          |

**WASM encoders.** `@jsquash/jpeg` (mozjpeg build, Squoosh-derived) is the usual choice. Registry data: latest 1.6.0
published 2025-05-12 (about 18 months old, so it clears the 7-day cooldown); unpacked size about 530 KB for the package, with the encoder as a
separate `.wasm` file. I did not install or run it, so **encode time on an iPhone 13 and memory use are unmeasured**.
Costs to expect, from the WordPress experience above (a 13 MB worker for the full vips build) and general wasm behaviour:
a worker, a lazy wasm fetch, more memory than a canvas encode (inferred, unmeasured), and extra work to keep Safari's canvas memory cap in
check (`upload-prep.ts` already releases canvases for that reason). Gain: 5-15% smaller files and control over
subsampling. That is below what quality tuning alone gives, so it is **not worth it now**. Revisit if telemetry shows
Safari's encoder is the reason for files over budget.

## 4. What the OCR providers accept

| Provider                | Formats                                                                                                        | Limits                                              | Does format change tokens?                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Claude Haiku 5.5        | JPEG, PNG, GIF, WebP ([vision docs](https://platform.claude.com/docs/en/build-with-claude/vision#supported-formats)) | 8,000 x 8,000 px; 5 MB per image on Bedrock/Vertex | **No.** Tokens come from pixel dimensions only (long edge 2,576, 4,784 tokens, per the sizing review). |
| Gemini 3.5 Flash-Lite   | PNG, JPEG, WebP, HEIC, HEIF ([docs](https://aistudio.google.com/docs/image-understanding))                     | 20 MB total inline request                          | **No.** Fixed tiles (258 tokens each) or the media-resolution setting; encoding is irrelevant.       |
| Qwen on Groq            | Not listed on the page; examples use JPEG data URLs ([docs](https://console.groq.com/docs/vision))             | 20 MB request, 3 images                             | **No.** Flat 2,048 tokens per image.                                                                 |

So **JPEG is accepted everywhere and format never changes cost**. Bytes only matter for upload time, R2 storage and
request limits, not for model price.

## 5. Server-side options

At our scale (receipts are small, one image each) none of these is worth building yet:

- **Re-encode after upload with `sharp`.** `sharp` is already a dependency. mozjpeg mode took 20-35% off the
  libjpeg-turbo size in the table (e.g. 237 KB to 159 KB at 1,000 x 1,333). Cost: a job kind, CPU on the
  worker, a second object key, and the OCR must read the same bytes or the saving is only storage. Storage at R2
  rates ($0.015/GB-month, third-party figure, check current pricing) is negligible: 100,000 receipts at 250 KB is 25 GB, under $0.40 a month.
  **Skip until storage or egress shows up in cost.**
- **R2 lifecycle.** Useful for privacy, not for size. A rule that deletes originals after N days is a retention
  decision for the owner.
- **Thumbnail.** A 200 px-wide thumbnail for the history list is worth doing when the list shows images. About 5-10 KB each. Generate it in the browser at
  upload time (same canvas, second `toBlob`) to avoid a job, or on demand with `sharp` behind a cache. No decision needed now.
- **Keeping originals.** Do not store the raw 12 MP photo. We only store what we send to the model, which is the
  right privacy posture and is what Google Photos' Storage saver does.

## 6. Measurements

`sharp` 0.35.5 on the four real receipt photos in `packages/bench/fixtures-real/commons` (EXIF-rotated, resized to the width
shown, Lanczos). Sizes in KB. "c420" is 4:2:0 baseline libjpeg-turbo, which is what we model for Safari at lower B/px. "moz" is
mozjpeg mode. The sources are 600 x 690 to 3,060 x 4,080; `maslina-split-2011` was smaller than 800 px wide and is omitted.

| Fixture (width x height)   | Pixels | c420 q85 | c420 q75 | c420 q65 | 4:4:4 q85 | grey q75 | moz q75 | WebP 80 | AVIF 50 | PNG grey | 1-bit PNG |
| -------------------------- | ------ | -------- | -------- | -------- | --------- | -------- | ------- | ------- | ------- | -------- | --------- |
| yinyang (colour) 800 x 533 | 0.43 MP | 56      | 49       | 44       | 69        | 43       | 36      | 30      | 22      | 298      | 2         |
| yinyang 1000 x 667         | 0.67 MP | 84      | 74       | 66       | 103       | 65       | 52      | 44      | 32      | 465      | 4         |
| yinyang 1200 x 800         | 0.96 MP | 119     | 105      | 94       | 146       | 93       | 72      | 61      | 44      | 671      | 5         |
| biedronka 800 x 1086       | 0.87 MP | 127     | 115      | 105      | 132       | 115      | 83      | 84      | 50      | 392      | 17        |
| biedronka 1000 x 1358      | 1.36 MP | 174     | 157      | 143      | 181       | 157      | 110     | 113     | 64      | 581      | 24        |
| biedronka 1200 x 1630      | 1.96 MP | 221     | 200      | 183      | 232       | 200      | 140     | 138     | 79      | 804      | 31        |
| hk-seafood 800 x 1067      | 0.85 MP | 159     | 142      | 128      | 168       | 140      | 106     | 127     | 74      | 615      | 29        |
| hk-seafood 1000 x 1333     | 1.33 MP | 237     | 211      | 191      | 250       | 208      | 159     | 186     | 107     | 944      | 42        |
| hk-seafood 1200 x 1600     | 1.92 MP | 334     | 297      | 270      | 353       | 293      | 224     | 256     | 149     | 1,341    | 60        |

Bytes per pixel at q85, 4:2:0: yinyang 0.13-0.12, biedronka 0.14-0.11, hk-seafood 0.19-0.17. A "typical" 1,000 x 2,000
receipt (2 MP) therefore lands at roughly **250-400 KB at q85 and 220-350 KB at q75** with libjpeg-turbo. The owner's
photo implies Safari writes about 3-4 times that at q85 (0.49 B/px, about 1 MB at 2 MP). That gap, not the codec choice, decides whether
the 500-700 KB goal is met, and it is the one number we cannot measure from here.

Observations:

- q85 to q75 saves 10-12%; q75 to q65 another 9-10%. The curve is flat, so lowering quality alone is a weak lever.
- 4:4:4 costs 3-25% for no benefit on receipts.
- Greyscale saves nothing on near-neutral receipts and 11-12% on a colour photo.
- mozjpeg saves 20-35%, WebP 3-30%, AVIF 40-60% at these settings. None is usable from a canvas on iPhone.
- Lossless PNG is 4-8x larger. A 1-bit PNG is tiny (17-60 KB) but loses detail the model needs.

## 7. Recommendation

1. **Keep JPEG, encoded once, from the canvas, with `blob.type` checked.** No WebP/AVIF/JXL and no wasm encoder in v1:
   Safari cannot encode them from a canvas, providers do not charge less for them, and the wasm gain (5-15%) is smaller than
   what tuning the pixel size and quality gives.
2. **Quality ladder, calibrated to the device.** Replace fixed 0.85 with a short search on the real bytes:
   1. Encode at 0.80. If the result is at or under **700 KB**, stop. (libjpeg-turbo gives 200-350 KB, so this should be the norm.)
   2. Otherwise 0.72, then 0.65. Never below 0.65 (ringing, Section 2).
   3. If still over **1.5 MB**, step the pixel budget down once (Standard to Faster's 1 MP), never below the 800 px width floor, and encode at 0.72.
   4. **Hard cap 1.5 MB**, matching the owner's "exceptional" bound; above it the upload is refused with the existing
      "too large" message, not sent. Normal photos should sit at 500-700 KB or less.
   Rationale: starting at 0.80 not 0.85 is within the flat part of the curve (about 5% smaller), and it keeps the loop
   to at most four encodes on a phone. Once telemetry exists (below), replace 0.80/0.72/0.65 with the value that matches
   the Safari bytes-per-pixel.
3. **Format by filter.**
   - **Original / colour:** JPEG, ladder above.
   - **Greyscale filter:** draw the grey pixels, JPEG, same ladder (0-12% saving, free). Do not attempt a 1-component JPEG.
   - **B&W filter:** keep JPEG at 0.80 unless the filter is already thresholded, in which case a palette PNG is smaller (24-42 KB
     in the table) and safe. Do not threshold only to save bytes.
4. **Do not change chroma or progressive settings** (the canvas gives no control).
5. **Server side: nothing now.** Revisit a `sharp` mozjpeg re-encode only if R2 storage or egress appears on the bill; add
   a browser-made thumbnail when the history list shows images.
6. **Measure before tuning further.** Add to the upload wide event (fields go in `packages/core/src/telemetry/schema.ts`
   with the PII audit; none of these can carry PII): `image_bytes`, `image_width`, `image_height`, `image_bytes_per_pixel`
   (bytes / (w x h)), `image_quality_used`, `image_attempts`, `image_mime`, `image_filter`, and `device_class`
   (Safari/iOS vs other). A p50/p95 of bytes per pixel on iOS answers whether the 700 KB goal is met. Verify first with a single
   console log from an iPhone 13 at 1,000 x 2,000 for q0.65 / 0.72 / 0.80 / 0.85 and report the four sizes.
7. **Accuracy gate.** Before shipping a lower quality, run the bench set: re-encode the 4 commons and 5 CORD fixtures in
   `packages/bench` at q85 / 80 / 72 / 65 at Standard size with `bun run bench:ocr` and compare field accuracy. If q65 is
   within noise of q85, the ladder floor holds; if not, raise the floor to 0.72. `packages/bench/prep.ts` already holds the
   prep path; a quality sweep belongs there.

<details>
<summary>How the table was produced</summary>

Script (not committed) used `sharp(file).rotate().resize({ width })` then, for each column: `.jpeg({ quality, chromaSubsampling })`,
`.greyscale().jpeg(...)`, `.jpeg({ quality: 75, mozjpeg: true })`, `.webp({ quality: 80 })`, `.avif({ quality: 50, effort: 2 })`,
`.greyscale().png({ compressionLevel: 9 })` and `.greyscale().threshold(140).png({ palette: true, colours: 2 })`. Sizes are
single-run bytes divided by 1,024. The CORD fixtures (`.webp`, receipts of 960 KB) and the synthetic PNG fixtures were not used. The
worktree had no `node_modules`, so `sharp` came from the main checkout (read-only).

</details>
