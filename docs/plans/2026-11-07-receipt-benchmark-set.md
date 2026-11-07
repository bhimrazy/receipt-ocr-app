# A real receipt benchmark set, with Nepal and South Asia (2026-11-07)

The OCR benchmark (`bench/`) has six clean synthetic receipts. To compare Gemini with Claude Haiku, Sonnet and Opus 5.5
(PR #59) honestly we need real photos, including receipts from Nepal and South Asia. This plan extends
[parsers landscape §5](2026-11-06-parsers-landscape.md#5-receipt-datasets-with-ground-truth): CORD v2, SROIE,
WildReceipt, ExpressExpense, CORU, MC-OCR and the others listed there are not repeated here.

Licence rule: the repo is public but all rights reserved (PR #60). We commit only data whose licence allows
redistribution in a public repo with attribution. Everything else stays in a gitignored folder or is downloaded at bench
time.

## TL;DR

- **No public Nepali receipt or VAT/PAN invoice dataset with ground truth exists**, as far as these searches found
  (Hugging Face, Kaggle, GitHub, TU/KU repositories). Nepali OCR sets are printed-line or character level, or synthetic.
  The Nepal slice has to be the owner's own receipts.
- **South Asia is just as thin.** No public Indian GST or Hindi receipt set, and nothing for Pakistan or Sri Lanka. The one
  find is BanglaFinDoc (334 Bangla financial documents, CC-BY-4.0), which has boxes but no text values.
- **One new real-photo set worth having: ReceiptBench** (ACL 2026, 10k human-annotated receipts, MIT tag on HF). It is
  98% English, and the image provenance is unclear, so it stays local-only.
- **Stage the set:** (a) commit 30 CORD v2 test receipts plus 20 CORU receipts; (b) SROIE, WildReceipt and a ReceiptBench
  sample stay local-only; (c) 40 of the owner's Nepal receipts, kept local and committed only after a second redaction pass.
- **Scoring needs four fixes before the Nepal slice means anything:** a list of acceptable categories, a list of
  acceptable merchant names (Devanagari or romanised), a normaliser that keeps Devanagari vowel signs, and
  BS-to-AD date truth.
- **Cost of a full run of about 126 receipts (est.):** Haiku about $0.14, Gemini 3.8 Flash about $0.81, Sonnet about
  $2.80 and Opus about $5.70. Real photos cost 2–3x the synthetic token counts.

## 1. Nepal-specific datasets

| Dataset                                                                                                                          | What it is                                                                                                                                                      | Size                                 | Fields / line items                                            | Licence                                                                                  | Use for us                                  |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| Receipts, VAT/PAN invoices, bill books                                                                                           | **None found** (searched HF, Kaggle, GitHub, TU and KU e-libraries)                                                                                             | –                                    | –                                                              | –                                                                                        | Build our own (§4)                          |
| [W4ashabii/dots-train](https://huggingface.co/datasets/W4ashabii/dots-train)                                                     | Nepali government-document OCR fine-tuning corpus. `pages` has `invoice_bill` (1,400) and `payment_receipt` (1,400) rows, **synthetic** (nepal-pixel-synthesis) | 1.28M rows, 294 GB                   | Machine-made transcription, word boxes, regions; no key-values | **"mixed"**: card says treat as non-commercial research; `pages` has no declared licence | No. Synthetic and unlicensed                |
| [himalaya-ai/nepali-deva-ocr-eval](https://huggingface.co/datasets/himalaya-ai/nepali-deva-ocr-eval)                             | Held-out printed Devanagari lines and paragraphs                                                                                                                | 500                                  | Transcription only                                             | **Not stated**                                                                           | Only a Devanagari reading check, local-only |
| [cfilt/RoundTripOCR-nepali](https://huggingface.co/datasets/cfilt/RoundTripOCR-nepali/raw/main/README.md)                        | Post-OCR error correction pairs, generated                                                                                                                      | Not stated                           | Text pairs                                                     | Apache-2.0                                                                               | No (text, not images of receipts)           |
| [Kaggle nahcol/nepali-ocr-dataset](https://www.kaggle.com/datasets/nahcol/nepali-ocr-dataset)                                    | "Nepali OCR Dataset"                                                                                                                                            | **Unverified** (page did not render) | Unverified                                                     | Unverified                                                                               | Unknown                                     |
| [UCI Devanagari Handwritten Character Dataset](https://archive.ics.uci.edu/dataset/389/devanagari+handwritten+character+dataset) | Isolated handwritten characters (Acharya and Gyawali)                                                                                                           | 92,000 (46 classes × 2,000)          | Class label                                                    | CC-BY-4.0                                                                                | No (characters, not bills)                  |
| [Printed Devanagari ground truth](https://b2find.eudat.eu/dataset/84160b2b-5216-5bba-8b3b-4a3f1b17018c)                          | Book pages with ALTO XML                                                                                                                                        | Not checked                          | Text lines                                                     | Not checked                                                                              | No                                          |
| [Nepal Lipi OCR (KU)](https://ncci.ku.edu.np/uploads/archive/1770520563058-Nepal_Lipi_Text_Extrction-1-Pratik-Sharma.pdf)        | Historical Nepal Lipi script                                                                                                                                    | about 4,625 line images              | Lines                                                          | Not stated                                                                               | No                                          |
| [TU thesis, Nepali handwritten OCR](https://elibrary.tucl.edu.np/items/1c6b2978-08e9-4208-a521-371442a4d452/full)                | About 80,000 handwritten images used in training                                                                                                                | –                                    | –                                                              | Not public (as far as found)                                                             | No                                          |

NAAMII: no OCR or receipt dataset from NAAMII turned up (unverified beyond web search). Handwritten Nepali bills: nothing
public at document level.

What a Nepali VAT bill holds, useful for labelling (secondary sources, not the IRD rule text): a "Tax Invoice" (कर बीजक)
heading, the seller's and (where registered) buyer's PAN, a serial number, date, line items, 13% VAT shown separately
and the total in figures and words ([notarynepal](https://notarynepal.com/blog/vat-rules-in-nepal)). A business that is
not VAT-registered issues a PAN bill; abbreviated tax invoices go up to Rs 10,000 with IRD approval
([lookuptax](https://lookuptax.com/docs/country/nepal-vat-guidelines-indirect-tax)). The PAN is 9 digits and also serves as
the VAT number ([org-id.guide](https://org-id.guide/list/NP-IRD)). The official Rule 17 schedules (VAT Rules 2053, new
formats 2081/82) were not retrieved: **unverified**.

## 2. South Asia nearby

| Dataset                                                                                                                                                                                                                                     | Country / script              | Size                    | Fields / line items                                                                             | Licence                                   | Use for us                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| Indian GST invoices or Hindi receipts                                                                                                                                                                                                       | India                         | **None found**          | –                                                                                               | –                                         | Owner's own Indian receipts, if any         |
| [Multi-layout invoice dataset (ResearchGate)](https://www.researchgate.net/publication/353207991_Multi-Layout_Unstructured_Invoice_Documents_Dataset_A_Dataset_for_Template-Free_Invoice_Processing_and_Its_Evaluation_Using_AI_Approaches) | India (GSTIN fields), English | 630 PDFs, 4 layouts     | Supplier/buyer GSTIN, invoice number                                                            | **Unverified** (availability and licence) | Unknown; invoices, not receipts             |
| [BanglaFinDoc (Mendeley)](https://data.mendeley.com/datasets/8vdh8pktj4)                                                                                                                                                                    | Bangladesh, Bangla            | 334 images, 2,001 boxes | 9 field types (vendor, date, serial, goods, qty, unit price, total…); **boxes, no text values** | CC-BY-4.0                                 | Could be labelled by hand; semi-handwritten |
| [sinhala-ocr-lk-acts-1010](https://arxiv.org/abs/2606.29378)                                                                                                                                                                                | Sri Lanka, Sinhala            | 1,010 pages             | Page transcriptions of legal acts                                                               | Not checked                               | No (not receipts)                           |
| Pakistan / Urdu receipts                                                                                                                                                                                                                    | Pakistan                      | **None found**          | –                                                                                               | –                                         | –                                           |
| Indic OCR sets ([CVIT synthetic 90k, Mozhi](https://cvit.iiit.ac.in/usodi/tdocrmil.php))                                                                                                                                                    | India, 23 languages           | 90k images; 1.2M words  | Word or line text                                                                               | Not checked                               | No (not receipts)                           |

A Hugging Face forum thread asking for exactly this (Indian invoices and receipts in Hindi and other Indic languages)
got replies pointing at vendors and synthetic data, not public sets
([forum](https://discuss.huggingface.co/t/seeking-indic-document-dataset-india-invoices-receipts-utility-bills-payment-advices-packing-lists-commercial-invoices-credit-notes/177055),
seen through search results; the page returned 403 to a direct fetch). Roboflow "receipt OCR" projects
([example](https://universe.roboflow.com/workspace-ukpte/receipt_ocr)) are CC-BY-4.0 but hold bounding boxes for detection,
not field values, and do not say where the receipts are from.

## 3. Wider real-photo sets missing from §5

| Dataset                                                                                                                                                                                       | Size                               | Language                         | Line items                                                                 | Licence                                                                                             | Verdict                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **ReceiptBench** (ACL 2026, [arXiv 2605.22413](https://arxiv.org/abs/2605.22413), [GitHub](https://github.com/wwwT0ri/ReceiptBench), [HF](https://huggingface.co/datasets/T0rl/ReceiptBench)) | 10k, human-annotated               | 98% English (per search summary) | Yes (`detail`), plus seller, invoice number, tax number, times, currencies | Code MIT; HF tag MIT, but the README is empty and image provenance is not stated                    | **Local only** until provenance is checked        |
| [UniKIE-Bench](https://arxiv.org/abs/2602.07038) ([GitHub](https://github.com/NEUIR/UNIKIE-BENCH))                                                                                            | Receipt subsets of 202 zh + 207 en | English, Chinese                 | Not checked                                                                | Not stated on arXiv; repo not checked                                                               | Local only; small; receipts were its easiest type |
| KORIE ([MDPI Mathematics 14(1)](https://www.mdpi.com/2227-7390/14/1/187))                                                                                                                     | 748 scanned Korean receipts        | Korean                           | Yes                                                                        | **Not found**                                                                                       | Skip                                              |
| SVRD (ICDAR 2023, [arXiv 2306.03287](https://arxiv.org/abs/2306.03287))                                                                                                                       | 50+ document types, camera images  | Chinese mostly                   | Not receipt-focused                                                        | **Not found**; RRC registration                                                                     | Skip                                              |
| WildReceipt HF mirror ([Theivaprakasham/wildreceipt](https://huggingface.co/datasets/Theivaprakasham/wildreceipt/blob/main/README.md?code=true))                                              | about 1.7k                         | English                          | Partial                                                                    | Mirror says Apache-2.0; the original authors state none ([paper](https://arxiv.org/abs/2103.14470)) | Local only (a mirror cannot grant a licence)      |
| [wendys-llc/domestic-receipts](https://huggingface.co/datasets/wendys-llc/domestic-receipts/blob/main/README.md?code=true)                                                                    | Not shown                          | Not shown                        | Not shown                                                                  | CC-BY-4.0 tag                                                                                       | Inspect before use                                |
| TrainingDataPro ocr-receipts-text-detection ([HF](https://huggingface.co/datasets/TrainingDataPro/ocr-receipts-text-detection/tree/main/data))                                                | Small sample                       | English                          | Boxes only                                                                 | CC-BY-NC-ND-4.0                                                                                     | No (NC-ND)                                        |
| [AMuRD](https://arxiv.org/abs/2309.09800)                                                                                                                                                     | Not verified                       | Arabic, English                  | Items + class                                                              | Not verified                                                                                        | Overlaps CORU; skip                               |

SROIE's official licence is still unverified (the HF mirror's CC-BY-4.0 tag is the mirror's claim).

## 4. Building our own Nepal set (30–50 receipts)

### Mix (target 40)

| Kind                                                               | Count | Why                                                                                               |
| ------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------- |
| Supermarket thermal POS: Bhat-Bhateni, Big Mart, Salesberry, local | 8     | Long receipts (30+ lines), VAT inclusive/exclusive, loyalty lines, lakh grouping on big shops     |
| VAT tax invoice (कर बीजक), printed A5/A4 from billing software     | 5     | Seller PAN, VAT 13% separate, total in words, dual BS/AD dates                                    |
| PAN bill and handwritten "bill book" (carbon copy, pen)            | 6     | Handwritten Nepali and English, Devanagari numerals, no VAT                                       |
| Restaurant and café (with 10% service charge)                      | 5     | Service charge is not a tip; VAT on top of service                                                |
| Fuel (NOC dealers)                                                 | 3     | Litres × rate, small thermal                                                                      |
| Pharmacy                                                           | 3     | Batch and expiry columns, Supplies category                                                       |
| Ride and food delivery screenshots (Pathao, inDrive, Foodmandu)    | 4     | Screenshots, not photos; Travel vs Meals                                                          |
| Utility and fee receipts (NEA electricity, internet, eSewa/Khalti) | 3     | BS-only dates, Utilities and Fees                                                                 |
| One or two Indian receipts (INR, GST) if the owner has them        | 2     | INR, CGST/SGST lines                                                                              |
| **Worst cases** spread across the above                            | –     | at least 6 crumpled or folded, 4 faded thermal, 4 at an angle, 3 in dim light, 2 with flash glare |

Make sure the set includes amounts at and above Rs 1,00,000 (lakh grouping), receipts that show only a BS date, Devanagari
merchant names and at least five with Devanagari numerals.

### Photographing

- Use the phone's normal camera, or the in-app camera from PR #47, the way a user would: one shot, held by hand, no scanner
  app.
- Per receipt, take a "good" shot (flat, daylight, filling the frame), and for about half of them also a "realistic" shot
  (angled 20–30°, on a patterned table, folded or crumpled, indoor light). Each shot is its own fixture with the same
  ground truth, so the gap between them shows how much capture quality costs.
- Long receipts: one shot of the whole receipt from further away, and 2–3 overlapping parts for the multi-part work in
  [long receipt capture](2026-11-07-long-receipt-capture.md).
- Keep the original files. Upload-time shrinking happens in the app (`apps/web/lib/upload-prep.ts`), so the benchmark should
  send what the browser would (see the note in §5).

### Redaction

Redact before the files leave the phone's camera roll for any shared place, and again before anything is committed.

| Remove (fill with a solid box, not blur)                                                                              | Keep                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Card digits, masked or not, auth codes, terminal IDs and RRNs                                                         | Merchant name, branch address, phone of the business                                                                    |
| Customer name, phone, email, address, membership or loyalty numbers                                                   | **Business PAN/VAT number of the seller** (public: IRD lookup by PAN, [org-id.guide](https://org-id.guide/list/NP-IRD)) |
| **Buyer PAN when the buyer is a person** (it identifies a taxpayer)                                                   | Buyer PAN when the buyer is a company the owner controls, or remove it anyway to be safe                                |
| QR codes on bills (Fonepay/eSewa QR can carry merchant and transaction IDs)                                           | Invoice and bill numbers (not personal), date, time, items, amounts                                                     |
| Cashier names, signatures on bill books, vehicle numbers on fuel receipts                                             | Handwriting of item names and amounts                                                                                   |
| Faces, hands with rings, anything in the background                                                                   |                                                                                                                         |
| EXIF (GPS): strip it (`exiftool -all= file.jpg`), or re-export through the app's shrinker, which drops metadata (#25) |                                                                                                                         |

Redacting changes pixels, so redact the image first and label from the redacted copy. If a redacted field is something the
model would extract (it never is in our schema), leave it out of the ground truth.

### Ground truth JSON

Same shape as `bench/fixtures/*.json` (the extraction fields; `score.ts` skips absent fields and ignores unknown keys):

```json
{
  "merchant": ["Bhat-Bhateni Supermarket", "भाटभटेनी सुपरमार्केट"],
  "receiptDate": "2026-11-06",
  "category": ["Groceries"],
  "currency": "NPR",
  "subtotal": 104424.78,
  "tax": 13575.22,
  "tip": null,
  "total": 118000,
  "items": [{ "name": "Basmati Rice 25kg", "quantity": 2, "unitPrice": 4250, "totalPrice": 8500 }],
  "_meta": {
    "source": "own",
    "licence": "owner, all rights reserved",
    "kind": "supermarket-thermal",
    "capture": "crumpled",
    "dateShown": "2083-07-20 BS",
    "redacted": ["card", "loyalty"],
    "notes": "VAT inclusive; 10% discount line"
  }
}
```

- `category` is a list of acceptable values from `RECEIPT_CATEGORIES` in `packages/ai/src/categories.ts` (Meals,
  Groceries, Travel, Fuel, Office, Software, Equipment, Supplies, Utilities, Services, Fees, Other). A pharmacy can be
  `["Supplies"]`; a supermarket bill with mostly household goods `["Groceries", "Supplies"]`. Note the six existing
  synthetic fixtures use values outside that list (`Restaurant`, `Shopping`, `Grocery`), so today they can never score
  on category; the fix that accepts a list should also move them to `Meals`, `Supplies`/`Equipment` and `Groceries`.
- `merchant` as a list is new (see scoring changes). Put the printed form first, then common romanisations.
- Amounts are plain numbers: `1,18,000.00` on the receipt is `118000`.
- Service charge goes in no field (it is neither tip nor tax), as for CORD.
- `items`: every printed line that has a price. Leave `unitPrice` out where the receipt does not print it.
- Label with a pre-fill (one model run) and correct by hand, line by line; a second person checks totals add up.

### Where to store them

| Option                                                                                  | Verdict                                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bench/fixtures-local/own/` (gitignored), synced by the owner (private bucket or drive) | **Default.** Real receipts carry personal data even after redaction (shop plus time plus amount can identify a person); a public repo is forever, a gitignore is not   |
| Commit to `bench/fixtures/own-*` after a second redaction pass                          | Only receipts the owner is happy to publish: business-only purchases, nothing personal, after a second person checks. Reversible only by history rewrite, so be strict |
| A private Hugging Face dataset or R2 bucket fetched at bench time                       | Good later, when more than one machine runs the benchmark                                                                                                              |

`bench/ocr.ts` would read `bench/fixtures` and, when present, `bench/fixtures-local`, and report slices separately.
Add `/bench/fixtures-local/` to `.gitignore` in the PR that adds the loader.

### Bikram Sambat dates

How the app handles dates today:

- The prompt asks for `receiptDate` as ISO `YYYY-MM-DD` (`packages/ai/src/extract.ts`); the schema accepts any string up to
  32 characters (`packages/ai/src/schema.ts`). It is stored as text (`receipt_date`, `packages/db/src/index.ts`) and the
  history filters compare it as a string (`packages/core/src/repository.ts`, `gte`/`lte`).
- There is **no BS handling anywhere** (no matches for Bikram, Sambat, Nepali calendar or BS conversion in `packages/` or
  `apps/`).

So a receipt that prints only `२०८३/०७/२०` can come back as `2083-07-20`: a valid-looking ISO date 56–57 years in the
future that sorts last, falls outside every date filter and lands in the wrong month on the spending dashboard. Or the
model converts it itself, which it may get wrong by a day or two, because BS month lengths come from published tables, not a
formula.

Ground truth: **`receiptDate` holds the Gregorian (AD) date**, because that is what the app stores and filters on. Keep the
printed date in `_meta.dateShown`. Score `receiptDate` exactly as today. Add a diagnostic count: predicted year ≥ 2070
on an NPR receipt means "returned BS as AD".

App follow-up (a separate PR): add `dateCalendar: "gregorian" | "bikram_sambat"` and `dateAsPrinted` to the schema, ask the
model to transcribe the date as printed, and convert BS to AD in code with a lookup table (a vetted library or our own table,
under the dependency rules). Then the benchmark scores the transcription and the conversion separately.

## 5. Recommendation

### The set, in stages

| Stage | Slice                      | Count | Source                                                                                 | Where                                                                     | Covers                                                                            |
| ----- | -------------------------- | ----- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| –     | `synthetic-*` (existing)   | 6     | `make-fixtures.mjs`                                                                    | Committed                                                                 | Locale regressions (NPR lakh, KWD, EUR, IDR, tip, long)                           |
| a     | `cord-*`                   | 30    | CORD v2 **test** split, the first 30 by index that have `menu` and `total.total_price` | **Committed**, with `bench/fixtures/ATTRIBUTION.md` (CC-BY-4.0, Clova AI) | Real photos, line items, IDR separators, subtotal and tax                         |
| a     | `coru-*`                   | 20    | CORU, the first 20 receipts by index with item-level labels and a clear currency       | **Committed** (MIT notice in `ATTRIBUTION.md`)                            | Arabic/mixed script, noisy photos                                                 |
| b     | `sroie-*`                  | 30    | SROIE test, corrected labels                                                           | `bench/fixtures-local/`, downloaded by a script                           | Merchant, date, total on scans (MYR)                                              |
| b     | `receiptbench-*`           | 20    | ReceiptBench, a random sample                                                          | `bench/fixtures-local/`                                                   | Modern English receipts and invoices; checks our numbers against a 2026 benchmark |
| b     | `wildreceipt-*` (optional) | 10    | WildReceipt                                                                            | `bench/fixtures-local/`                                                   | In-the-wild photos                                                                |
| c     | `own-np-*`                 | 40    | The owner (§4)                                                                         | `bench/fixtures-local/own/`; a subset committed after review              | Nepal: lakh, BS dates, Devanagari, handwriting, VAT invoices, long receipts       |

Pick CORD by a fixed rule (first 30 by index), not by eye, so the choice is reproducible and not tuned to a model. Write a
small converter script (`bench/import-cord.ts`) that downloads into a scratch folder, maps fields (§5 of the parsers plan)
and writes the 30 fixtures; commit its output, not the raw dataset.

Report every slice separately, and admit a model on the `own-np` slice plus the overall field scores, not one average.

### Scoring changes

| Change                                                                                      | Why                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `category` may be a list; pass when the prediction is in it                                 | In flight. Receipts honestly fit two categories                                                                                                                                                                    |
| `merchant` may be a list; best similarity wins                                              | A Devanagari sign can come back romanised or the other way round, and both are correct                                                                                                                             |
| `normalize` keeps combining marks: `/[^\p{L}\p{M}\p{N}]+/gu` and `.normalize("NFC")`        | Today `[^\p{L}\p{N}]` strips Devanagari vowel signs and virama (they are `\p{M}`): "भाटभटेनी सुपरमार्केट" normalises to "भटभटनसपरमरकट", 8 code points becoming 5 for the first word, so different names look alike |
| `receiptDate` truth is AD; add a "BS returned as AD" count                                  | §4                                                                                                                                                                                                                 |
| Report `total` per slice and per currency                                                   | Lakh and separator errors show up as a total failure on one currency                                                                                                                                               |
| Items: also accept a match on `quantity × unitPrice` when `totalPrice` is absent from truth | Bill books often print rate and quantity but not the line total                                                                                                                                                    |
| Optional: a CER on `merchant` and item names for Devanagari slices                          | The 0.8 and 0.7 similarity thresholds are coarse for short Devanagari words                                                                                                                                        |

Lakh formatting itself needs no scoring change: amounts are numbers, so `1,18,000` either became `118000` or the total fails.

### Cost per full run

Prices from `packages/ai/src/models.ts` (Gemini) and PR #59 (Claude), USD per 1M tokens input/output: Haiku 5.5
$0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20, Gemini 3.8 Flash $0.75/$3.75 (doubling to $1.50/$7.50 from
2027-01-01), Gemini 3.5 Flash-Lite $0.30/$2.50.

Measured today (Haiku, synthetic): about 1,740 input and 880 output tokens per receipt. The synthetic PNGs are 420 px
wide and cost only about 180–480 image tokens on Claude (`⌈w/28⌉ × ⌈h/28⌉`,
[Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision#resolution-and-token-cost)), so about 1,550
of the 1,740 are prompt and schema. Real photos cost more:

- **Claude** (Haiku, Sonnet and Opus 5.5 are high-resolution tier: long edge up to 2,576 px, up to 4,784 image tokens): a
  1500×2000 photo is about 3,900 image tokens, a long receipt about 2,900. Estimate **about 5,500 input** per real receipt.
- **Gemini 3** spends a fixed 1,120 tokens per image at the default resolution
  ([media resolution](https://aistudio.google.com/docs/media-resolution)). Estimate **about 2,700 input**.
- Output grows with line items; thinking tokens count as output. Estimate **about 1,200 output**. These are estimates, not
  measurements; the first real run replaces them.

| Model                 | Per synthetic receipt (measured tokens) | Per real receipt (est.) | Full run, 6 synthetic + 120 real (est.) |
| --------------------- | --------------------------------------- | ----------------------- | --------------------------------------- |
| Claude Haiku 5.5      | $0.00061                                | $0.0012                 | **about $0.14**                         |
| Gemini 3.8 Flash      | $0.0046 (same tokens assumed)           | $0.0065                 | **about $0.81** (about $1.60 from 2027) |
| Gemini 3.5 Flash-Lite | $0.0027                                 | $0.0038                 | about $0.47                             |
| Claude Sonnet 5.5     | $0.0123                                 | $0.023                  | **about $2.80**                         |
| Claude Opus 5.5       | $0.0246                                 | $0.046                  | about $5.70                             |

All five models over the full set cost about $10 per run. That is cheap enough to run on every prompt or model change,
but not in CI on every push. Gemini's tokenizer differs from Claude's, so "same tokens assumed" in the synthetic column is
a proxy only.

### Next steps

1. Scoring PR: list-valued `category` and `merchant`, the Devanagari-safe normaliser, the BS diagnostic, and moving the six
   synthetic fixtures to canonical categories.
2. `bench/import-cord.ts` and `bench/import-coru.ts`, `ATTRIBUTION.md`, and the 50 committed fixtures.
3. `bench/fixtures-local/` loader, gitignore entry and slice reporting; SROIE and ReceiptBench download scripts.
4. Owner: collect, redact and label 40 Nepal receipts (§4), about 4–6 hours including labelling.
5. App follow-up: `dateAsPrinted` and `dateCalendar`, with BS to AD in code.

## Sources not verified

- The Kaggle "Nepali OCR Dataset" contents and licence (the page did not render).
- ReceiptBench's language split (98% English comes from a search summary of the ACL paper; the PDF did not parse) and its
  image provenance.
- Licences of UniKIE-Bench, KORIE, SVRD, AMuRD and the Indian multi-layout invoice dataset.
- NAAMII datasets (none found; not proof that none exist).
- Nepal's IRD Rule 17 invoice schedules, and whether BS dating is mandatory on invoices.
- Token counts for real photos, and Gemini's token count for our prompt.
