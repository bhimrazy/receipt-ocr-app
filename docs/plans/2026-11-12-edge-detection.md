# Receipt edge detection: review, design and measurement plan (2026-11-12)

Status: proposed, nothing built. The numbers below come from a scratch harness and a scratch prototype run for this
review; neither is in the repo. The owner decisions are at the end.

## TL;DR

- **Today's detector is a brightness threshold plus "largest blob".** It works on a white receipt lying on a dark,
  plain table and is weak everywhere else. On a synthetic set of 16 real-world capture conditions, weighted by how
  common each is, it gives a tight crop on **50%** of photos, no crop on 19%, a loose crop on 16%, and a **crop that
  cuts print off on 15%**.
- **The worst cases are the common ones.** Hand-held receipts (0% good, 45% cut), white or light tables (93% no crop),
  messy desks (28% cut), and any receipt covering under 20% of the frame, which is rejected outright (a clean 1:5
  receipt at 80% of the frame height returns nothing).
- **A wrong crop is worse than no crop**, because `prepare-photo.ts` applies the detected crop to photos the user never
  opened. The plan optimises for "never cut print" first and "tight crop" second.
- **Chosen design: propose, fit sides, score, decide.** Still dependency-free TypeScript at ~256 px. Region proposals
  on a paper-likeness channel (`min(R, G, B)` after a grey closing that erases print), then each side fitted as a line
  to edge points (outermost well-supported line, so fingers, logos and creases cannot pull it inward), a line-based
  proposer for clutter and white-on-white, per-side support, and two confidence levels: apply the crop, or only offer
  it. Corners come from intersecting sides, so a thumb over a corner or a side under fingers is handled; with fewer than
  three good sides the answer is "no crop".
- **Scratch prototype of the first half of that design** (held-out scenes): good 50% → **83%**, print-cutting crops 15%
  → **6%**. It also regresses three categories and is slower as written, which is what the harness is for.
- **No OpenCV.js and no ML model now.** Published results say a small CNN beats classical methods in the wild, but we
  have no licensed receipt training set and it would add a runtime plus a model download. Revisit on the triggers in
  section 3.
- **Harness first.** A pure-TypeScript scene generator with known corners, metrics that separate "cuts print" from
  "loose" from "no crop", a committed baseline that only ratchets up, and speed and size gates. It runs in `vitest` in
  CI with no browser.
- **Move the pure image code to `packages/vision`** (detector, geometry, later the filters), with the harness beside
  it. Canvas, camera and UI stay in `apps/web`.
- **Ten small PRs**, each gated on the harness; the first four change no detection behaviour (move, harness,
  telemetry, speed).

## 1. Today, from the code

### The pipeline (`apps/web/lib/capture/detect-quad.ts`)

1. **Downscale to luma.** `toSmallLuma` area-averages RGBA to a long edge of at most 256 px and keeps Rec. 601 luma
   only. Colour is thrown away here.
2. **Blur.** A 3x3 box blur.
3. **One global threshold.** `otsu` over the whole frame. Two masks are made: pixels above it ("light") and the
   inverse ("dark", for paper darker than the table).
4. **Largest blob.** `largestComponent` flood-fills each mask with 4-connectivity and keeps only the biggest
   component, recording its leftmost and rightmost pixel per row.
5. **Hull, then biggest quad.** `convexHull` over the row extents, then `hullCorners` picks the four hull points that
   span the largest area (start from the diagonal extremes, three rounds of single-corner swaps).
6. **Gates and confidence.** `confidence = min(fill, squareness, share + 0.25)`: `fill` is row-span area over quad
   area, `squareness` is quad area over hull area, `share` is the blob's part of all foreground. The quad is kept only
   if it covers 20–98% of the frame, is convex, has every angle within 45–135 degrees, and confidence is at least 0.75.
7. **Pick.** The light or dark candidate with the higher confidence; otherwise `quad: null`.

### Where it is used

| Caller                                               | What it does with the result                                                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/capture/camera-sheet.tsx` (live preview) | Every 250 ms on the main thread, draws the quad over the video or hides it. No smoothing, no hysteresis.                                     |
| `components/capture/review-sheet.tsx` `startingEdit` | `initialEdit(quad, …)`: the crop starts on the detected quad, and a found quad makes Enhance the default filter (when none is remembered).   |
| `lib/capture/prepare-photo.ts` (`chosen ??= …`)      | A photo the user never opened in review is cropped to the detected quad and uploaded. A wrong quad here is silent data loss.                 |
| `lib/capture/render.ts` `detectOnBitmap`             | Feeds stills at about 222x296 (an area budget of 256², not a 256 px long edge); the live preview feeds 192x256. Thresholds run at two sizes. |

Photos picked from files (including screenshots) go through the same review path. PDFs skip it.

### Measured baseline

Scratch harness: 16 categories, 40 scenes each, rendered at 300x400 from a 600x800 scene description, seeds never used
for tuning. Outcomes per scene:

- **good**: a crop that keeps all print and overlaps the paper with IoU of at least 0.85.
- **loose**: keeps all print, but takes in a lot of background (IoU under 0.85).
- **miss**: no quad; the caller keeps the full frame.
- **harmful**: the crop cuts off more than 0.5% of the printed area (the paper inset by 5%); for a screenshot, more
  than 2% of the image.

| Category (share of real captures, assumed)   |      Good |     Loose |      Miss |   Harmful | Median corner error (good scenes) |
| -------------------------------------------- | --------: | --------: | --------: | --------: | --------------------------------: |
| Flat on a contrasting table, dark/wood (18%) |       88% |        0% |       13% |        0% |                             0.61% |
| Hand-held, room behind, fingers on it (15%)  |        0% |       50% |        5% |       45% |                                 – |
| Hand-held, thumb over a corner (4%)          |       15% |       58% |        5% |       23% |                            10.34% |
| White or light surface (10%)                 |        0% |        8% |       93% |        0% |                                 – |
| Messy desk, keyboard, clutter (7%)           |       23% |       48% |        3% |       28% |                             0.81% |
| Patterned cloth, lap, car seat (7%)          |       48% |       18% |       13% |       23% |                             0.61% |
| Long thermal, 1:3.5 to 1:5.5 (6%)            |       58% |        0% |       43% |        0% |                             0.48% |
| Crumpled or curled (5%)                      |       88% |        0% |       13% |        0% |                             0.61% |
| Folded (2%)                                  |       85% |        0% |       15% |        0% |                             0.56% |
| Shadow across the paper (5%)                 |       58% |       10% |       15% |       18% |                             0.49% |
| Low light and noise (4%)                     |       88% |        0% |       13% |        0% |                             0.56% |
| Glare, or a light band beside the paper (2%) |       75% |        8% |        5% |       13% |                             1.44% |
| Partial, runs off the frame (5%)             |      100% |        0% |        0% |        0% |                                 – |
| Several or overlapping receipts (2%)         |       48% |       15% |        0% |       38% |                             0.52% |
| A4 invoice on a desk (4%)                    |      100% |        0% |        0% |        0% |                             0.48% |
| Screenshot or PDF render, no edges (5%)      |       45% |        0% |        0% |       55% |                                 – |
| **Weighted**                                 | **50.3%** | **15.8%** | **18.5%** | **15.4%** |                                   |

Corner error is the largest corner distance as a share of the frame diagonal. Synthetic scenes are kinder than real
photos, so read these as an upper bound on real behaviour; the published real-world figures for classical detectors
are 37–51% hands-off (section 2).

#### Baseline from the repo harness (2026-11-13)

`bun run --filter @receipt-ocr/vision bench:edges` on the gate seeds (5000-5039, 40 scenes per category), detector
unchanged. The repo generator is a rewrite, so it is not scene-for-scene the scratch one: it renders a different random
mix, rotates each category through named variants (below) and adds the extra categories from section 4 as variants.
The scratch baseline above predates #220, which lowered the detector's `MIN_COVER` from 0.2 to 0.1, so it describes a
slightly different detector as well. This table is the number every later PR is compared with
(`packages/vision/bench/baseline.json`).

| Category                                     |      Good |     Loose |     Miss |   Harmful | Median corner error |
| -------------------------------------------- | --------: | --------: | -------: | --------: | ------------------: |
| Flat on a contrasting table, dark/wood (18%) |      100% |        0% |       0% |        0% |               0.75% |
| Hand-held, room behind, fingers on it (15%)  |       15% |       57% |       0% |       28% |               6.34% |
| Hand-held, thumb over a corner (4%)          |       53% |       13% |       5% |       30% |               3.79% |
| White or light surface (10%)                 |       33% |        8% |      60% |        0% |               0.87% |
| Messy desk, keyboard, clutter (7%)           |       28% |       45% |      18% |       10% |               0.97% |
| Patterned cloth, lap, car seat (7%)          |       70% |        3% |       8% |       20% |               0.70% |
| Long thermal, 1:3.5 to 1:5.5 (6%)            |       90% |        0% |      10% |        0% |               1.14% |
| Crumpled or curled (5%)                      |      100% |        0% |       0% |        0% |               0.54% |
| Folded (2%)                                  |      100% |        0% |       0% |        0% |               0.75% |
| Shadow across the paper (5%)                 |       50% |        0% |      15% |       35% |               0.71% |
| Low light and noise (4%)                     |      100% |        0% |       0% |        0% |               0.75% |
| Glare, or a light band beside the paper (2%) |       63% |       23% |       0% |       15% |               7.07% |
| Partial, runs off the frame (5%)             |       65% |        0% |       0% |       35% |                   - |
| Several or overlapping receipts (2%)         |       15% |       20% |       0% |       65% |               0.58% |
| A4 invoice on a desk (4%)                    |       98% |        0% |       0% |        3% |               0.56% |
| Screenshot or PDF render, no edges (5%)      |       63% |        0% |       0% |       38% |                   - |
| **Weighted**                                 | **62.5%** | **13.9%** | **9.2%** | **14.4%** |   1.30% (p90 1.30%) |

Where the difference from the scratch table comes from. With `MIN_COVER` put back to 0.2 the repo harness gives 54.8%
good, 13.9% loose, 17.8% miss and 13.6% harmful, so the detector change explains about 8 points of good and about 9
points of miss (long thermal goes 13% good against 90% with 0.1, and the table, folded and low-light misses return).
The remaining gap to the scratch run (about 4.5 points good, 2 points harmful, 1 point miss) is the generator. The
order of difficulty holds: hand-held, thumb, clutter, several receipts, shadow and screenshots are the harmful ones,
and table, crumpled, folded, low light and A4 are fine. The generator differences, not measured causes, are in white
surfaces (the repo scenes give the paper a cast shadow), partial framing (the repo paper runs further off the frame)
and screenshots. The tuning seeds (1000-1009) are for choosing thresholds, so they are not a check on anything.

The never-tuned holdout set (seeds 9000-9199, 200 scenes per category, `--set holdout`, about 4.5 minutes) gives
62.8% good, 13.5% loose, 9.3% miss and 14.4% harmful with median corner error 0.45% and p90 1.01%, within a point or two
of the gate set. Run it at PRs 6-8 and before v2 becomes the default; the 40-scene gate stays the per-PR check, and a
category moves by a scene or two on 40 scenes, so only the weighted figures and the bars below are meant to be read.

By variant, gate seeds. Variants rotate with the seed, so each has at least 5 scenes; a handful of scenes is a sample,
not a rate:

| Category: variant           | Scenes | Good | Loose | Miss | Harmful |
| --------------------------- | -----: | ---: | ----: | ---: | ------: |
| table: table                |     40 | 100% |    0% |   0% |      0% |
| hand: room                  |     13 |  23% |   38% |   0% |     38% |
| hand: sleeve                |     14 |  21% |   50% |   0% |     29% |
| hand: white wall            |     13 |   0% |   85% |   0% |     15% |
| thumb: room                 |     24 |  33% |   17% |   4% |     46% |
| thumb: table                |     16 |  81% |    6% |   6% |      6% |
| white: bed sheet            |     10 |   0% |   10% |  90% |      0% |
| white: darker receipt       |     10 |  30% |   10% |  60% |      0% |
| white: light wood           |     10 | 100% |    0% |   0% |      0% |
| white: white desk           |     10 |   0% |   10% |  90% |      0% |
| clutter: keyboard dark      |      8 | 100% |    0% |   0% |      0% |
| clutter: keyboard light     |      8 |   0% |   88% |  13% |      0% |
| clutter: laptop             |      8 |   0% |   63% |   0% |     38% |
| clutter: objects            |      8 |  13% |   50% |  38% |      0% |
| clutter: papers             |      8 |  25% |   25% |  38% |     13% |
| patterned: car seat         |      8 | 100% |    0% |   0% |      0% |
| patterned: check cloth      |      8 |  50% |   13% |  38% |      0% |
| patterned: dark fabric      |      8 | 100% |    0% |   0% |      0% |
| patterned: dashboard        |      8 |   0% |    0% |   0% |    100% |
| patterned: lap              |      8 | 100% |    0% |   0% |      0% |
| thermal: thermal            |     30 |  93% |    0% |   7% |      0% |
| thermal: thermal on pattern |     10 |  80% |    0% |  20% |      0% |
| crumpled: crumpled          |     24 | 100% |    0% |   0% |      0% |
| crumpled: curled            |     16 | 100% |    0% |   0% |      0% |
| folded: folded              |     40 | 100% |    0% |   0% |      0% |
| shadow: phone shadow        |     14 |  43% |    0% |  43% |     14% |
| shadow: shadow              |     26 |  54% |    0% |   0% |     46% |
| lowlight: low light         |     26 | 100% |    0% |   0% |      0% |
| lowlight: motion blur       |     14 | 100% |    0% |   0% |      0% |
| glare: glare                |     20 |  75% |    0% |   0% |     25% |
| glare: light band           |     20 |  50% |   45% |   0% |      5% |
| partial: partial            |     40 |  65% |    0% |   0% |     35% |
| several: close              |     10 |  10% |   30% |   0% |     60% |
| several: over               |     10 |   0% |   40% |   0% |     60% |
| several: separate           |     10 |  50% |    0% |   0% |     50% |
| several: under              |     10 |   0% |   10% |   0% |     90% |
| a4: a4                      |     40 |  98% |    0% |   0% |      3% |
| digital: app bar            |      5 |   0% |    0% |   0% |    100% |
| digital: card               |      5 | 100% |    0% |   0% |      0% |
| digital: card on dark       |      5 |   0% |    0% |   0% |    100% |
| digital: dark bars          |      5 |   0% |    0% |   0% |    100% |
| digital: dark mode          |      5 | 100% |    0% |   0% |      0% |
| digital: jpeg               |      5 | 100% |    0% |   0% |      0% |
| digital: light              |      5 | 100% |    0% |   0% |      0% |
| digital: status bar         |      5 | 100% |    0% |   0% |      0% |

Of 231 crops the detector would apply, 4 cut print (the screenshots with a header or navigation bar and some shadow
scenes among them); 338 were only suggested, 172 of them good. Speed is 3.2 ms median, 6.0 ms p95 at 192x256 under
Bun, and the module is 5.0 kB minified, 2.4 kB gzipped (`bun build` of `detect-quad.ts`; the scratch figure below was
taken on a different bundle). A full gate run takes about 40-70 s, nearly all of it rendering.

Speed and size, measured on the codespace (AMD EPYC 7763, a noisy shared machine): **about 9 ms median, 26 ms p95**
per call at 192x256 under Node/V8, and 6–12 ms median under Bun/JavaScriptCore across runs. The module is 4.2 kB
minified, **1.9 kB gzipped**.

### Failure modes by category, with the cause in the code

| Category                       | What happens                                                                                                               | Why                                                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Long thermal receipts          | No crop whenever the receipt covers under 20% of the frame.                                                                | `MIN_COVER = 0.2`. Verified directly: a clean, upright 1:5 receipt at 80% of the frame height covers 17.1% and returns null; so does a 1:2.2 receipt at half the frame height.                                     |
| Crumpled, curled               | Corners found; a strip of table inside the crop along bowed sides.                                                         | The hull is the outer envelope and `hullCorners` maximises area, so the quad can only be the outside. Covered by the existing `it.fails` test.                                                                     |
| White receipt on a light table | No crop (93%).                                                                                                             | One global Otsu split on luma separates print from everything else; paper and table land in the same class, the blob covers the frame and fails `MAX_COVER`. Fails safe.                                           |
| Busy or patterned backgrounds  | Loose crops, and crops of the wrong thing.                                                                                 | Light keys, white squares or other papers touch the receipt and join its component (4-connectivity, no shape test before the hull). Or another light object is the largest blob. `share` then rejects some.        |
| Low light, noise               | Mostly fine while contrast holds.                                                                                          | Otsu adapts to the level. The synthetic set has no motion blur or colour noise, which real low light adds.                                                                                                         |
| Shadows                        | The quad covers only the lit part of the paper (18% harmful), or takes in lit table.                                       | A shadow edge is a stronger luma step than paper against table, and there is only one threshold for the frame.                                                                                                     |
| Glare, bounce light            | The quad grows to include the bright patch or band.                                                                        | Anything above the threshold that touches the paper joins it. Covered by the second `it.fails` test.                                                                                                               |
| Partial receipts               | Handled (100%).                                                                                                            | Row extents use pixel edges, so a component touching the frame reaches 0 and 1.                                                                                                                                    |
| Several receipts               | The largest wins; overlapping ones merge into one loose or wrong quad (38% harmful).                                       | Only the largest component is considered, and overlapping papers are one component.                                                                                                                                |
| Screenshots, PDF renders       | A plain white page is left alone. A screenshot with dark bars or a dark header is cropped to the white part (55% harmful). | A full-frame light blob fails `MAX_COVER` (correct). A white card inside dark chrome is a perfect "document" to this detector. A header carrying the merchant name is lost.                                        |
| A4 invoices                    | Fine on a contrasting desk (100%); on a white desk, same as white-on-light.                                                | As above.                                                                                                                                                                                                          |
| Hand-held at an angle          | Never a good crop: 45% harmful, 50% loose.                                                                                 | Walls, doors and floors are large light or dark regions, and the dark-inverse candidate happily returns a door. Skin is above the threshold against a dark background, so fingers join the paper and move corners. |

### Other findings

- **Speed is not "a few milliseconds".** About 9 ms on a server CPU is, as an estimate, 20–35 ms on a mid-range
  phone, four times a second on the main thread. The hot spots are a four-element array allocated per pixel in
  `largestComponent`, two full labelling passes, a `Map` per row and `Float64` buffers. The only speed test allows
  500 ms.
- **The auto-crop is silent for unopened photos**, so precision matters more than recall. Today nothing separates
  "sure" from "probably".
- **Confidence is not calibrated** and is thrown away by every caller (only null or not).
- **The two `it.fails` tests cannot both be met with the existing "never cuts into the paper" test.** No straight side
  can follow a bowed edge without cutting the paper at the corners. The right target is "keep all print, then minimise
  background"; the tests should be re-specified that way (PR 6).
- **Tests do not see what browsers see.** In the browser the canvas downsizes 4000 px to about 222 px in one
  `drawImage`, which can alias fine print and texture; the test path area-averages in `toSmallLuma`.
- **The live outline flickers by construction**: raw result every 250 ms, shown or hidden with no memory.

## 2. How people capture, and what scanner apps do

Sources are listed at the end; "fetched" means read during this review, the rest is from memory and marked so.

- **Capture conditions.** MIDV-500, the standard mobile-capture benchmark, records every document under five
  conditions: **table, keyboard, hand, partial, clutter**. MIDV-2019 adds strong perspective and low light. SmartDoc
  2015 uses five desk backgrounds; several competition entries score 0.95–0.99 Jaccard on four of them and fall to
  0.01–0.86 on the fifth. These are the same conditions the owner listed.
- **Receipts are harder than pages.** Whittaker et al. (2023) took one receipt photo each from many users of a
  receipt app: a traditional edge-based detector found the receipt in **36.9%**, their small corner-detecting network in
  85.3%. They describe receipt edges as "non-linear and discontinuous", with look-alike backgrounds and other
  rectangles in view.
- **Genius Scan**: their classical pipeline (Canny, Hough, line selection) left about **half** of scans needing manual
  adjustment. A MobileNetV2 corner regressor at 96x96 followed by classical refinement raised correct detection from
  51% to 75%, then 85% in 2024.
- **Dropbox**: Canny was "not very promising" because print gives strong edges and the page border weak ones. Their
  pipeline is an edge map, Hough lines, quads from line intersections, and a score that sums edge strength along each
  quad's perimeter. Detection runs at 8–10 fps; between detections they track the last quad and re-score it by the
  gradient across its perimeter.
- **Readdle Scanner Pro**: same shape (custom edge detector, Hough variants, quad scoring), names "a white document
  on a white table" as the hard case, and smooths the live quad with a Kalman filter.
- **Zhang and He (Microsoft Research)**: edge detection, Hough, quadrangle formation, verification, refinement.
- **Tropin et al. (Smart Engines)**: rank contour-based candidates by the **contrast between the inside and the
  outside** of each border; a Hough-based version runs in 100 ms per frame on an iPhone 6, single-threaded.
- **When nothing is found.** Adobe Scan shows "Looking for document", then "No document found" and falls back to manual
  capture; its auto-crop can be turned off to use the full image. Apple Notes, Microsoft Lens and Google's scanner all
  keep draggable corners after capture (from memory, not fetched).

What this means for us:

1. Every shipped classical detector is **edges → lines → candidate quads → score**. None is "threshold and take the
   largest blob". Region contrast is used as the second cue, not the only one.
2. Classical methods top out at roughly half of real photos without a touch; that is why every app keeps manual
   corners and a full-image fallback. We already have both; the detector's job is to be right when it speaks.
3. Small networks do better, at the cost of training data and a runtime (see "What we do not do").
4. No published study gives the mix of conditions for receipt capture. The shares in the tables here are assumptions
   and get replaced by our own telemetry (PR 3).

## 3. Options and the chosen design

### Candidates, ranked by gain for cost

| #   | Change                                                                                             | Fixes                                                                   | Cost                                      | Evidence                                                                  |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| 1   | Cover gate by shape: minimum 5–6% instead of 20%; keep the top three components, not one           | Long and small receipts (43% and 13% misses), some multi-receipt scenes | Tiny                                      | Direct check above; prototype: long thermal 58% → 100% good               |
| 2   | Paper-likeness channel `min(R, G, B)` instead of luma                                              | Skin, wood, cloth, coloured surfaces: anything bright but not neutral   | Tiny (same pass as the downscale)         | Ablation: weighted good 78.6% → 83.4%; hand-held 68% → 90%                |
| 3   | Grey closing (5x5 max then min) before thresholding, to erase print                                | Print and logos splitting the paper or steering the threshold           | Small (separable passes)                  | Standard document-scanner step; needed by 4 and 5                         |
| 4   | Second threshold inside the bright class (two-level Otsu)                                          | White on light surfaces, paper against a white wall                     | Tiny                                      | Prototype: white/light surface 0% → 83% good                              |
| 5   | Fit each side as a line to edge points; corners by intersection; support per side                  | Fingers, thumb on a corner, bounce band, loose hulls, sub-pixel corners | Medium (about 150 lines)                  | Ablation: harmful 16.9% → 6.3%, good 76.3% → 83.4%                        |
| 6   | Confidence from side support and fill, two levels (apply, suggest), digital-image gate             | Silent wrong crops; screenshots                                         | Small, plus a small UI change             | Adobe Scan and every app above fall back rather than guess                |
| 7   | Line-based proposer: oriented Hough on the gradient map, quads scored by edge support and contrast | Clutter, overlap, paper that never forms a clean blob; three-side cases | Medium-large (about 250 lines)            | Dropbox, Readdle, Zhang–He, Tropin; not prototyped here                   |
| 8   | Speed pass with identical output: typed arrays, no per-pixel allocation, one labelling pass        | Main-thread cost                                                        | Small                                     | Profile above; expect 3–5x                                                |
| 9   | Live camera: hysteresis, One Euro smoothing, last quad as the first proposal                       | Flicker, jitter; cheaper steady state                                   | Small-medium                              | Dropbox tracking, Readdle Kalman filter                                   |
| 10  | Refinement of the sides at about 1024 px for stills                                                | Corner precision 0.5% → about 0.1% of the diagonal                      | Medium                                    | Low gain: the outward bias already protects print                         |
| 11  | Web Worker / OffscreenCanvas                                                                       | Main-thread time                                                        | Medium (bundling, Safari 16.4+, fallback) | Only if a real phone still shows over 16 ms p95 after 8                   |
| 12  | Canny, LSD, full contour tracing                                                                   | –                                                                       | Medium                                    | Dropbox and Readdle both found plain Canny/LSD poor on documents; skipped |

Illumination flattening (dividing by a large blur) was considered for shadows. It is left out: the side fit works on
local contrast along each side, which already ignores a shadow that does not run along the paper's edge.

### Chosen design: propose, fit sides, score, decide

All at the detection size (long edge 256 px), pure TypeScript on an `ImageData`-like buffer, no dependencies.

1. **Channels.** While downscaling, keep `P = min(R, G, B)` ("paper-likeness": white paper stays high, skin, wood and
   cloth drop) and luma. Grey-close `P` with a 5x5 window to erase print, then a 3x3 blur.
2. **Proposals**, each a rough quad:
   - Region: Otsu on `P`, and a second Otsu inside the bright class; the top three components of each; hull and
     largest quad as today. The dark-inverse mask stays as one more proposer so "paper darker than the table" keeps
     working, but it must pass the same side test, which a door or a laptop will not.
   - Lines (PR 8): gradient of `P`, each edge pixel votes in a (θ, ρ) table only near its own gradient direction, the
     strongest lines in two roughly perpendicular families plus the four frame borders, and every convex combination
     of two from each family.
   - The last accepted quad (live camera only).
3. **Fit each side.** Along 32 normals per side, scan from outside in and take the outermost point that is still
   paper-like relative to that normal's own inside and outside levels (so a shadowed side is judged against its own
   surroundings). Fit a line by RANSAC; if a quarter or more of the points lie on a parallel line further out, take
   that one. This is the **outermost well-supported line**: a logo, a crease or a finger pulls points inward and
   loses; a light band beside the paper is not paper-like and loses. Corners are the intersections of adjacent lines.
   Each side reports `support`, the share of its normals that agree with the line.
4. **Score.** Side support, inside fill, inside-versus-outside contrast (Tropin's cue), convexity and angles, cover
   and centrality, combined by a small fixed formula whose weights are fitted on the harness's tuning seeds.
5. **Decide.** Two thresholds, set on the harness so that "apply" stays under the harmful bar:
   - **apply**: the crop starts on the quad (and is used for unopened photos).
   - **suggest**: the crop starts on the full image; the quad is kept as `detected`, so the existing "Reset to
     detected" button offers it. No new UI.
   - **none**: full image, with a reason code for telemetry.

### When four good edges are not there

| Situation                                                   | Behaviour                                                                                                                                                                                          | Level                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| A corner is covered (thumb, paperweight)                    | Both sides next to it are still fitted from their visible parts (at least 30% support each); the corner is their intersection under the thumb.                                                     | apply                 |
| A side is partly covered (fingers along the bottom)         | Fitted from the visible part; covered samples fall inside the line and are outvoted.                                                                                                               | apply                 |
| A side runs off the frame                                   | That side becomes the frame border (`source: "frame"`). Up to two frame sides, as today.                                                                                                           | apply                 |
| One side has no edge at all (white on white, fully covered) | Three fitted sides. The fourth is the line through the points where the two neighbouring sides' support ends, never closer in than the last paper-like row; if neither is known, the frame border. | suggest               |
| Two or more sides have no support                           | No quad. Full image.                                                                                                                                                                               | none (`low_support`)  |
| Two candidates score about the same (overlapping receipts)  | The more central, larger one, but demoted.                                                                                                                                                         | suggest (`ambiguous`) |
| The image is digital (screenshot, render)                   | No quad. Detected from the caller's hint (PNG, picked from files) and from exactly flat regions among unsaturated pixels.                                                                          | none (`digital`)      |
| The paper fills the frame                                   | No quad, as today.                                                                                                                                                                                 | none (`full_frame`)   |

The rule throughout: a side may be inferred outward (taking in background) but never inward. The cost of a loose crop is
a slightly smaller receipt in the upload; the cost of a tight wrong crop is a missing total.

### Live camera

- **Hysteresis**: show the outline after two consecutive detections whose corners agree within 4% of the diagonal;
  keep it through two misses (500 ms), then hide.
- **Smoothing**: a One Euro filter per corner coordinate (low lag when the phone moves, low jitter when it is still).
- **Tracking**: the last quad is the first proposal for the next frame; when its sides still have support, skip the
  other proposers. Run the full detector every fourth frame so tracking errors cannot build up (Dropbox's lesson).
- All of it is a pure state machine (`createOutlineTracker`), tested without a browser.
- A worker only if PR 4's speed work leaves a measured problem on a real phone.

### What we do not do, and when to revisit

- **OpenCV.js** (and jscanify, which needs it): a multi-megabyte WebAssembly download (around 8 MB for the stock
  build, from memory) for functions we would use a few hundred lines of.
- **An ML model, for now.** The evidence that small networks win in the wild is real (Genius Scan 51% → 85%, Whittaker
  37% → 85%, LDRNet's MobileNetV2-0.35, under about 0.42 M parameters by the paper's own comparison, reaching 0.978
  Jaccard on SmartDoc). What is missing is ours to supply: a licensed training set of receipt photos with corners (none
  is public; SmartDoc is A4 pages and MIDV is ID cards), an inference runtime (ONNX Runtime Web and TensorFlow.js are
  each far larger than the whole capture feature), and proof on our own harness. The bar set for this review was
  "show a tiny one beats classical within a strict budget", and it cannot be shown today.
- **Revisit when** production telemetry (PR 3) shows the detected crop being corrected or discarded on more than about
  30% of camera photos after PR 8, or the clutter and white-on-white categories stay under their bars. The budget then:
  model plus runtime under 300 kB gzipped, loaded lazily after the camera opens, under 30 ms on a mid-range phone, and
  at least 10 points better on a real-photo set. It would plug in as one more proposer in front of the same side fit,
  score and decision (Genius Scan's hybrid shape).

### Scratch prototype result

Steps 1–5 of the design without the line proposer, the dark-inverse proposer, calibration or the digital gate: about
150 lines, written and tuned on seeds 1000–1009, measured on seeds 5000–5039.

| Category                                   |        Current good / harmful |   Prototype good / harmful | Note                                                   |
| ------------------------------------------ | ----------------------------: | -------------------------: | ------------------------------------------------------ |
| Flat on a contrasting table                |                      88% / 0% |                  100% / 0% | The cover gate                                         |
| Hand-held, fingers on it                   |                      0% / 45% |                   90% / 5% | Channel plus second threshold plus side fit            |
| Hand-held, thumb over a corner             |                     15% / 23% |                  55% / 28% | **Regression** in harmful: needs the acceptance rules  |
| White or light surface                     |                       0% / 0% |                   83% / 0% |                                                        |
| Messy desk, keyboard, clutter              |                     23% / 28% |                   43% / 5% | 48% now miss: needs the line proposer                  |
| Patterned cloth, lap, car seat             |                     48% / 23% |                   70% / 0% |                                                        |
| Long thermal                               |                      58% / 0% |                  100% / 0% |                                                        |
| Crumpled or curled                         |                      88% / 0% |                  100% / 0% | Corner error rose to 2.2%: sides move in at bowed ends |
| Folded                                     |                      85% / 0% |                  100% / 0% |                                                        |
| Shadow across the paper                    |                     58% / 18% |                  75% / 13% |                                                        |
| Low light and noise                        |                      88% / 0% |                  100% / 0% |                                                        |
| Glare, light band                          |                     75% / 13% |                  100% / 0% |                                                        |
| Partial, runs off the frame                |                     100% / 0% |                   90% / 8% | **Regression**: frame sides are not handled            |
| Several or overlapping receipts            |                     48% / 38% |                  40% / 35% | **Regression**: no ambiguity rule yet                  |
| A4 invoice                                 |                     100% / 0% |                  100% / 0% |                                                        |
| Screenshot or PDF render                   |                     45% / 55% |                  45% / 55% | Digital gate not built                                 |
| **Weighted good / loose / miss / harmful** | **50.3 / 15.8 / 18.5 / 15.4** | **83.4 / 1.5 / 8.8 / 6.3** |                                                        |

Ablations: without the side fit, 76.3% good and 16.9% harmful; on luma instead of `min(R, G, B)`, 78.6% good.

The three regressions would each fail the per-category bar in section 4. That is the point of the bar: PR 6 has to
handle frame sides and the weak-side rules before it can merge.

What the prototype does not show:

- **Speed.** As written it takes 30–70 ms per call (spread arrays, closures, an untuned rank filter). The operation
  count is about 4–5 million simple operations per frame, which should land at 2–4 ms in typed-array code; the speed
  gate in section 4 decides.
- **Existing tests.** It fails "finds paper darker than the table" (no inverse proposer), and the crumpled test's 2%
  corner bound (2.8%). On the light-band `it.fails` case it reaches 1.3% corner error against the 1% the test asks.
- **Real photos.** Nothing here was run on a real photograph.
- Size: 8.0 kB minified, 3.5 kB gzipped, including the reused hull code.

## 4. Measurement harness

### Synthetic scenes with known corners

A scene is a pure function of a seed. Layers, back to front:

1. **Background**: procedural (flat dark, flat light, wood grain, light wood, check cloth, denim, dark fabric, keyboard
   with light or dark keys, clutter of rotated rectangles including white papers, a room with wall, door and floor, a
   car dashboard), optionally a CC0 texture photo.
2. **Paper**: a print texture (procedural rows of dashes with a dark logo block, or the synthetic bench receipts in
   `packages/bench/fixtures`), warped onto a quad by `homography`. The quad comes from a size, an aspect (1:1.2 to
   1:5.5, or A4), a rotation and a perspective jitter.
3. **Paper deformations**: sides bowed in or out, crease shading, a fold line with a shading step, a drop shadow.
4. **Other objects**: a second receipt beside or under the first; a light band beside the paper.
5. **Occluders**: fingers and thumbs as capsules entering across a chosen side or corner, in a range of skin tones,
   with and without a sleeve.
6. **Light**: gain (low light), vignette, a soft-edged cast shadow, a glare blob, sensor noise.
7. **Camera**: defocus or motion blur, and the downscale to the detector's size done two ways, area-averaged and
   point-sampled, because browsers differ.

Ground truth per scene: the paper quad, the paper mask (which follows bowed sides), the print mask (paper inset by
5%), which sides are visible, covered or off-frame, and the expected level (crop or no crop).

Scenes render at 384x512 (twice the detector's input); nothing is committed as an image. The scratch generator,
written with closures and tuples, takes about 0.13 s of CPU per 300x400 scene including scoring; the repo version
should precompute per-row terms and write straight into typed arrays. Seeds are split: one range for tuning
thresholds, one for the gate, and a short list of pinned regression scenes added whenever a bug is found.

### Categories and weights

The headline number is weighted by how common each condition is. The weights below are assumptions (no study
publishes this mix for receipts); PR 3's telemetry and a labelled private sample replace them.

| Group                | Category                                                  | Weight |
| -------------------- | --------------------------------------------------------- | -----: |
| On a surface         | Contrasting table (dark, wood), flat                      |    18% |
|                      | White or light surface (white desk, counter, bed sheet)   |    10% |
|                      | Messy desk, keyboard, clutter                             |     7% |
|                      | Patterned cloth, lap, car seat, dashboard                 |     7% |
| In the hand          | Fingers along the bottom or a side, room or person behind |    15% |
|                      | Thumb over a corner                                       |     4% |
| The paper            | Long thermal (1:3.5 to 1:5.5)                             |     6% |
|                      | Crumpled or curled                                        |     5% |
|                      | Folded                                                    |     2% |
|                      | A4 invoice                                                |     4% |
| Light                | Shadow across the paper (often the phone's own)           |     5% |
|                      | Low light and noise                                       |     4% |
|                      | Glare or bounce light                                     |     2% |
| Framing              | Partial, runs off the frame                               |     5% |
|                      | Several or overlapping receipts                           |     2% |
| Not a photo of paper | Screenshot, PDF render, e-receipt                         |     5% |

To add in the harness PR, beyond what the scratch run covered: hand-held against a wall as white as the paper, a
receipt held in a curve, a sleeve, a receipt on a laptop, motion blur, a darker receipt on a light table, and a
JPEG-compressed screenshot.

### Open datasets

| Dataset                                   | What                                                                               | Licence                                                                             | Use                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| SmartDoc 2015, challenge 1                | A4 pages on five desk backgrounds, tablet video frames with page corners           | CC BY 4.0 (Zenodo record)                                                           | Download script into a gitignored folder; a sanity check on pages, not committed (size) |
| MIDV-500, MIDV-2019, MIDV-2020            | ID documents under table, keyboard, hand, partial, clutter; strong tilt; low light | Source images from Wikimedia Commons under per-image terms; no single licence found | Local evaluation only. Never commit: ID-style images, per-image terms.                  |
| CORD and Wikimedia Commons receipt photos | The nine real photos already in `packages/bench/fixtures-real`                     | CC BY 4.0; CC0 or CC BY-SA per file (already credited there)                        | Label the corners by hand and commit the labels: a small real-photo check in CI         |
| Poly Haven textures                       | Photographed wood, fabric, concrete                                                | CC0 (from memory; verify per file)                                                  | Optional backgrounds for the generator                                                  |
| SROIE, WildReceipt                        | Receipt scans and photos                                                           | Not verified (already recorded in `fixtures-real/commons/README.md`)                | Not used                                                                                |
| Whittaker et al. receipt photos           | 1,225 real receipt photos with corners                                             | No public release found                                                             | Not available                                                                           |

Private photos (the owner's own receipts, 50–100, photographed the way the owner actually does it) go in the
gitignored `packages/bench/fixtures-local/` with labels made in the app's own crop editor. They never enter the repo.

### Metrics

- **Outcome per scene**: good, loose, miss or harmful, as defined in section 1. Harmful is measured on the print mask,
  so a crop that trims blank margin is not punished and one that trims a line of text is.
- **Weighted rates** of each outcome, and the same per category.
- **IoU** against the paper mask (the SmartDoc measure), mean per category.
- **Corner error**: largest corner distance as a percentage of the frame diagonal, median and 90th percentile, on good
  scenes whose corners are in frame.
- **Level accuracy**: for apply, the harmful rate among applied crops; for suggest, how often the offered quad was good.
- **Live stability** (tracker): on a scripted sequence of jittered and dropped detections, outline on/off flips per
  second and corner jitter while the scene is still.
- **Speed**: median and 95th percentile milliseconds per call at 192x256, after warm-up, reported as a ratio to the
  frozen v1 detector measured in the same process (so the gate does not depend on the machine).
- **Size**: minified and gzipped bytes of the detector entry, from `bun build`.
- **Production** (PR 3): share of uploads where the detected crop was kept, adjusted, or replaced by the full image. Landed: `crop.outcome` and `crop.level` on the `receipt.upload` event; the share per week is `crop.outcome` counted over uploads with a `crop` group.

### Pass bars

Every PR, compared with the committed baseline on the gate seeds (paired, same scenes):

- Weighted harmful rate does not rise, and no category gains more than one harmful scene.
- Weighted good rate does not fall, and no category loses more than two good scenes. A harmful scene turning into a
  miss counts as an improvement.
- Median corner error at most 0.7% of the diagonal, 90th percentile at most 1.5%, on the plain categories.
- Speed ratio to v1 at most 1.0. Size at most 6 kB gzipped.
- The existing tests in `detect-quad.test.ts` pass unchanged, apart from the two `it.fails` cases re-specified in PR 6.
- The baseline file is updated in the same PR and only ever improves.

To make v2 the default (after PR 8):

| Measure                                  |        Today |                        Bar |
| ---------------------------------------- | -----------: | -------------------------: |
| Weighted good                            |          50% |               at least 85% |
| Weighted harmful                         |          15% |                 at most 2% |
| Harmful among applied crops              |            – |                 at most 1% |
| Screenshot or render cropped             |          55% |                         0% |
| Hand-held, fingers: good / harmful       |     0% / 45% |  at least 85% / at most 3% |
| Thumb over a corner: good / harmful      |    15% / 23% |  at least 70% / at most 5% |
| White or light surface: good             |           0% |               at least 75% |
| Clutter: good / harmful                  |    23% / 28% |  at least 60% / at most 5% |
| Patterned: good / harmful                |    48% / 23% |  at least 75% / at most 3% |
| Long thermal, crumpled, folded, A4: good |    58 – 100% |               at least 95% |
| Shadow: good / harmful                   |    58% / 18% |  at least 80% / at most 5% |
| Partial: good / harmful                  |    100% / 0% |          at least 95% / 0% |
| Several receipts: good / harmful         |    48% / 38% | at least 60% / at most 10% |
| Nine real photos                         | not measured |     no harmful crop on any |
| Speed at 192x256 (ratio to v1)           |          1.0 |                at most 0.6 |
| Size, gzipped                            |       1.9 kB |               at most 6 kB |

### Running it

- `packages/vision/bench/` holds the generator, metrics and runner. `bun run --filter @receipt-ocr/vision bench:edges`
  prints the category table, the per-variant table, level accuracy, speed and size. `--check` compares the run with
  `bench/baseline.json` and exits 1 on a violation: the pass bars below (weighted harmful and good, per-category
  harmful and good, harmful among applied crops, and the corner-error bars on the plain categories: table, long
  thermal, crumpled, folded, A4). It refuses to compare runs with different scene counts or a category missing from the
  baseline, and reports a changed generator (a fingerprint of every rendered frame and its truth) instead of comparing
  different scenes. `--write-baseline` runs the same comparison first and refuses a worse baseline unless `--force`.
  `--set tune|gate|holdout` picks the seed pool (10, 40 and 200 scenes per category by default, capped at 1000), and
  `--category` narrows a run. CI runs `bench:edges --check --no-timing` in the "Typecheck, test, build" job.
  The per-scene ground truth also records which sides are visible, covered or off the frame, and the expected level.
- Not built: a `vitest` gate test. The CI step runs the same check as a script, pure TypeScript on typed arrays (no
  browser, no canvas, no native module), inside the existing "Typecheck, test, build" job.
- The speed assertion is a ratio against a frozen copy of v1 in the bench folder, with a generous margin in CI and the
  exact number printed by the bench script.
- The browser path (canvas downscale, real camera) stays covered by the existing Playwright `mobile-camera` project;
  add one assertion that a fake-camera frame of a synthetic scene yields an outline.

## 5. Package: `packages/vision`

Yes, as its own PR with no behaviour change.

Why:

- The pure image code is already shared the wrong way round: `packages/bench/prep.ts` imports from `apps/web/lib`, and
  `detect-quad.test.ts` reads `packages/bench/fixtures` by a relative path.
- The harness (generator, metrics, baseline) is larger than the detector and does not belong in the app.
- A package can forbid the DOM in its `tsconfig`, so the detector provably runs in a browser, a worker, Node and Bun.
- Its size and speed can be gated on their own.

What moves to `packages/vision/src`:

- `geometry.ts`: `Point`, `Quad`, `Pixels`, `isConvex`, `quadArea`, `cornerAngles`, `homography`, `applyHomography`,
  `warpQuad`, `straightenedSize`.
- `detect/`: channels, proposals, side fit, score, and the entry point.
- `track.ts`: the live-outline state machine (PR 9).
- Later, if the bench needs them: the pixel filters in `filters.ts`.

What stays in `apps/web/lib/capture`: `render.ts`, `camera.ts`, `prepare-photo.ts`, `edit-state.ts`, `loupe.ts`, and the
crop editor's edge maths (`slideEdge`, `edgeNormal`, `nearestOnEdge` and the name lists), importing the types.

Public API:

```ts
export type SideInfo = { support: number; source: "edge" | "frame" | "inferred" };
export type Detection = {
  /** Corners normalised to 0..1, top-left first, clockwise; null when nothing is trustworthy. */
  quad: Quad | null;
  /** 0..1, calibrated on the harness. */
  confidence: number;
  /** apply: start the crop on `quad`. suggest: offer it. none: keep the full image. */
  level: "apply" | "suggest" | "none";
  sides: [SideInfo, SideInfo, SideInfo, SideInfo] | null;
  reason?: "no_candidate" | "low_support" | "ambiguous" | "digital" | "full_frame";
};
export function detectDocument(
  src: Pixels,
  options?: { source?: "camera" | "file"; hint?: Quad },
): Detection;
export function createOutlineTracker(): {
  push(detection: Detection, timeMs: number): Quad | null;
  reset(): void;
};
```

`detectQuad` stays as a wrapper until the callers move over.

Plumbing, following the other packages: `package.json` (`@receipt-ocr/vision`, `exports` to `src`, no dependencies),
`tsconfig.json` without the DOM lib, a line in `transpilePackages` in `apps/web/next.config`, alias lines in
`vitest.config.mts`, a `knip.json` entry for the bench script, `workspace:*` in `apps/web` and `packages/bench`, and
the architecture page plus the package list in `AGENTS.md` in the same PR.

Boundaries from `AGENTS.md` are unchanged: no backend workflow is involved, UI stays in `packages/ui` and `apps/web`,
and the one new telemetry field goes through `packages/core/src/telemetry/schema.ts` with its audit.

## 6. Build plan

Each PR is small, carries its harness numbers in the description, and updates `docs/STATUS.md`.

| PR  | What                                                                                                                                                                                      | Behaviour change | Gate                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| 1   | `packages/vision`: move geometry and the detector with their tests; architecture docs                                                                                                     | None             | Existing tests; bundle unchanged                                                  |
| 2   | Harness and baseline: generator, metrics, runner, `baseline.json`, the gate test, corner labels for the nine real photos; a frozen v1 for the speed ratio                                 | None             | Baseline matches this document within noise                                       |
| 3   | Telemetry (landed): `crop.outcome` (kept, adjusted, full_image, none) and `crop.level` (apply, suggest, none) on `receipt.upload`; enumerations only                                      | None visible     | Production baseline for "corrected or discarded" starts here                      |
| 4   | Speed, identical output: typed arrays, no per-pixel allocation, one labelling pass                                                                                                        | None             | Same quad on every scene; speed ratio at most 0.5                                 |
| 5   | Cover gate by shape, top three components                                                                                                                                                 | Yes              | Long thermal and table misses gone; nothing else moves                            |
| 6   | Paper-likeness channel, grey closing, second threshold, side fit with per-side support, frame-border sides; re-specify the two `it.fails` tests as "keeps all print, background under N%" | Yes              | Harmful at most 7% weighted; hand-held good at least 80%; no category worse       |
| 7   | Decision: calibrated confidence, apply and suggest, reason codes, digital gate; the review sheet starts on the full image for suggest; unopened photos crop only on apply                 | Yes, visible     | Harmful among applied at most 1%; screenshots 0%; `preview` label and screenshots |
| 8   | Line proposer, three-side inference, ambiguity rule                                                                                                                                       | Yes              | The "default" bars in section 4                                                   |
| 9   | Live camera: tracker with hysteresis and smoothing, last quad as a proposal                                                                                                               | Yes, visible     | Stability metrics; Playwright fake-camera check                                   |
| 10  | Only if measured: high-resolution side refinement for stills; a worker for the live loop                                                                                                  | Yes              | Corner error or phone timing shows the need                                       |

Before the later PRs, in this order:

- **Before PR 4 (speed):** a frozen copy of today's detector in the bench folder, so the speed ratio and "same quad on
  every scene" are measured in one process. Not built in PR 2.
- **Before PR 5:** the CI check on the gate baseline is in place (PR 2). Every PR from here runs `--check`; one that
  improves the numbers rewrites `baseline.json` in the same PR (`--write-baseline` refuses a worse one).
- **Before PR 6:** corner labels for the nine real photos in `packages/bench/fixtures-real`, so "no harmful crop on any"
  can be asserted, and the first holdout run (`--set holdout`).
- **At PRs 6-8 and before v2 becomes the default:** the holdout run, never tuned against.

PRs 1–4 can start now and do not depend on any decision below. After PR 8, compare production "corrected or discarded"
with the PR 3 baseline; that is the measurement that says whether real users got a better detector.

## Owner decisions

1. **Suggest level** (recommended: yes). For a medium-confidence detection, start on the full image and offer the quad
   through "Reset to detected", instead of applying it. Fewer wrong crops, a few more taps on borderline photos.
2. **Unopened photos** (recommended: crop only at the apply level). Today any detection crops them.
3. **Screenshots and renders** (recommended: never auto-crop a digital image). The alternative is to crop app chrome
   when it is plainly a bar, at the risk of cutting a coloured header that carries the merchant name.
4. **Category weights** (recommended: accept the assumed shares until telemetry replaces them). If the owner's own
   habit is mostly hand-held, raise that group now.
5. **A private real-photo set** (recommended: 50–100 of the owner's own captures in `fixtures-local`, labelled in the
   crop editor). The synthetic set cannot stand in for this.
6. **Package name** (recommended: `packages/vision`).
7. **A hint in the camera** ("Move back to fit the whole receipt" when a side is the frame border). Not part of this
   plan; cheap once `sides` exists.

## Sources

Fetched during this review:

- Dropbox, "Fast and Accurate Document Detection for Scanning" (2016):
  https://dropbox.tech/machine-learning/fast-and-accurate-document-detection-for-scanning
- Dropbox, "Improving the Responsiveness of the Document Detector" (2016):
  https://dropbox.tech/machine-learning/improving-the-responsiveness-of-the-document-detector
- The Grizzly Labs (Genius Scan), "Document detection" (2024):
  https://blog.thegrizzlylabs.com/2024/10/document-detection.html
- Readdle, Scanner Pro border detection: https://readdle.com/blog/scanner-pro-border-detection
- Whittaker, Tanaka, Kitagishi, "Automatic Detection and Rectification of Paper Receipts on Smartphones" (2023):
  https://arxiv.org/abs/2303.05763
- Tropin, Ilyuhin, Nikolaev, Arlazarov, "Approach for Document Detection by Contours and Contrasts" (ICPR 2020):
  https://arxiv.org/abs/2008.02615
- Wu, Qian, Wu, van Moorsel, "LDRNet: Enabling Real-time Document Localization on Mobile Devices" (2022):
  https://arxiv.org/abs/2206.02136 (source of the SmartDoc per-background table)

From search summaries (abstract-level only):

- Tropin, Ershov, Nikolaev, Arlazarov, "Advanced Hough-based method for on-device document localization" (Computer
  Optics, 2021): https://arxiv.org/abs/2106.09987
- Zhang and He, "Whiteboard scanning and image enhancement" (Digital Signal Processing, 2007):
  https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/Digital-Signal-Processing.pdf
- SmartDoc 2015 challenge 1 dataset, CC BY 4.0: https://doi.org/10.5281/zenodo.1230217
- MIDV-500: https://arxiv.org/abs/1807.05786; MIDV-2020: https://arxiv.org/abs/2107.00396
- Adobe Scan, "Take scans": https://www.adobe.com/devnet-docs/adobescan/ios/en/scan.html

From memory, not fetched: the One Euro filter (Casiez, Roussel, Vogel, CHI 2012), LSD (von Gioi et al., IPOL 2012),
MIDV-2019, Poly Haven's CC0 licence, and the Apple, Google and Microsoft scanner behaviours.
