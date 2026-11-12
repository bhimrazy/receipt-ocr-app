# Extraction accuracy review: Bikram Sambat dates, bill numbers, confidence (2026-11-12)

Research-engineer review of receipt extraction, read from `main` at `297c628`. Scope: `packages/ai/src` (schema,
prompt, extraction), `packages/core` (where extracted values are normalised and saved), `packages/bench` (scoring and
fixtures). No model calls were made. Confidence numbers come from the raw results of the 2026-11-07 benchmark run
(prompt v1, gitignored, local); only aggregates are quoted here. The column design for new fields belongs to the
data-model review running alongside this one.

Builds on [dual-calendar dates](../plans/2026-11-07-dual-calendar-dates.md) (the plan, still unimplemented) and
[review state and flagging](2026-11-07-review-state-and-flagging.md). Where this review differs from the plan, it says
so.

## Verdict

- **A Bikram Sambat (BS) date fails because we ask for that.** Prompt v2 tells the model to return `null` when only a
  BS date is printed, and nothing in code can convert BS. If the model returns the BS digits anyway, two
  normalisation steps drop them. Nothing keeps the printed date, so we can't fix that receipt later without scanning
  it again.
- **The calendar is less ambiguous than it looks.** Once a receipt must be dated between 2000-01-01 and the upload
  day, an AD year (2000 to 2026 today) and a BS year (late 2056 to 2083 today) can't overlap, with four digits or two. The
  year alone settles the calendar. What stays ambiguous is **day/month order** on AD dates. A label such as
  Miti/मिति/B.S. becomes a consistency check.
- **Minimal fix:** the model copies dates as printed (`dates[]`), and a pure resolver in `packages/core` decides
  the date using a vendored BS month table. This is the plan's PR 1 plus a smaller PR 3. Leave out a free-text
  "reason" from the model; code records its own `check`.
- **Bill number and seller PAN/VAT:** add both, and write each definition so it lists what the field is *not*.
  Commons receipt `yinyang-kathmandu-2015` already shows the traps: `PAN : 500004393`, `Bill No. : 7104` and
  `Table No. : 27` within five lines.
- **Confidence is uncalibrated and differs by model.** Per-line confidence is noise for flagging: it caught 9 of 51
  wrong lines, and 87 of the 96 lines it marked were correct. Gemini Flash-Lite never marked a line. The overall
  `< 0.9` "Needs review" rule flags 68% of Haiku receipts and 4% of Flash-Lite receipts. Don't add per-field
  confidence numbers. Build "Needs review" from deterministic per-field checks (date check, arithmetic, missing
  fields), with confidence only as a per-model hint.

## 1. Why a BS date fails today

The path a receipt's date takes, with the point where each kind of BS date is lost:

| Step | Code | What happens to a BS date |
| --- | --- | --- |
| Prompt | `packages/ai/src/prompt.ts:74`: "If only a BS date is printed, return null rather than converting it." `schema.ts:14` repeats it: "A Bikram Sambat date alone gives null." | **BS-only receipt: the model returns `null`, as asked.** The printed text is never asked for, so it isn't stored anywhere |
| Wire schema | `schema.ts:45`: `receiptDate: z.string().max(32).nullable()` | Any string passes, e.g. `"2081-07-15"` or `"15/07/2081"` |
| Model call | `extract.ts:341-360`: `generateText` with `Output.object`; `result.output` returned as is | No date logic |
| Normalise | `packages/core/src/receipt-fields.ts:34-37` `parseReceiptDate`: real `YYYY-MM-DD` from 2000 on, else `null` | `15/07/2081` and `२०८१-०७-१५` → null. `2081-03-32` (BS months have 32 days) → null |
| Upper bound | `repository.ts:286-289` `plausibleDate`: SQL `case when date <= created_at::date + 1` | `2081-07-15` taken as AD is in the future → null. The comment on `repository.ts:283-285` names this case |
| Save | `repository.ts:466` stores the result; `repository.ts:474` stores `rawJson: extraction` | `raw_json` holds only the model's `receiptDate` (null). The printed date is gone |
| DB | `packages/db/src/index.ts:122-127` `receipts_receipt_date_check` | Last line of defence for the same bound |
| Review | `apps/web/components/receipt-result.tsx:102`: "No date was found." | Shown on the receipt page only. **"Needs review" is `confidence < 0.9` alone** (`repository.ts:160-161, 216-219, 641`), so a missing date doesn't put the receipt in that list |

Tests pin this behaviour: `prompt.test.ts:31` asserts the "return null" sentence, and `receipts.int.test.ts:195-198`
asserts that `2080-04-09` is stored as null.

Measured: in the v2 A/B, "BS-only receipts now come back `null` by design", with Haiku at 67% on dates in the Nepal set
and Flash-Lite at 33%, "and [Flash-Lite] still sometimes converts a BS-only date itself, wrongly"
(`packages/bench/results/2026-11-07-prompt-v1-vs-v2.md:19-22`). The v1 raw results show what happens when a model
converts BS itself. On the owner's two BS-only receipts, Haiku returned dates 1 to 2 days off and once a wrong month,
and Flash-Lite returned one 5 days off. Those are plausible AD dates, so they pass every check and are silently wrong.
That's worse than `null`. **The model must not convert.**

The bench doesn't score what the app stores. `ocr.ts:77-84` scores the model's raw `receiptDate` against the answer
key (`score.ts:19, 99-105`), so it skips `parseReceiptDate` and the upload bound. Once a resolver exists, the bench must
score the resolver's output.

## 2. Detecting BS vs AD

### What makes it decidable

- **Year ranges don't overlap.** The plausible window is 2000-01-01 to upload day + 1 (`receipt-fields.ts:9-14`, DB
  check). In AD, that means years 2000 to 2026 today. In BS the same window runs from late 2056 (1 January 2000 is Poush 2056)
  to the current BS year, 2083. A four-digit year from 2027 to 2055 fits neither. With two digits, `yy ≤ 26` reads
  only as AD and `56 ≤ yy ≤ 83` only as BS. The ranges stay apart until AD 2056.
- **Day 32 exists only in BS.** Some BS months run 32 days. Validity per calendar comes from the month table.
- **Fiscal-year notation is not a date.** `2081/82`, `081/82` and `80/81` (the second part is the first plus one)
  name a Nepal fiscal year, Shrawan to Asar. The resolver must not read it as year/month. It adds BS context and a bound
  (the date falls inside that fiscal year). It also appears inside bill numbers: one in the owner's set ends in `-80/81`.
- **Devanagari digits** (U+0966-U+096F) are normalised to ASCII before parsing. A Nepali month name (बैशाख … चैत,
  Baisakh … Chaitra) marks BS. An English month name marks AD.
- **Labels.** `मिति`, `Miti`, `वि.सं.`, `बि.सं.`, `B.S.` mean BS. `A.D.`, `ई.सं.` mean AD. `Date` says nothing: the
  Yinyang receipt prints `Date : 2071/11/25` over `2015/03/09` with no calendar marker, which is the owner's case.
  The year decides, and a label that contradicts the year is a `conflict` (probably a misread digit).
- **Order conventions in the evidence we have.** BS with the year first is YMD (Yinyang `2071/11/25`). BS with the
  year last is DMY (all BS dates in the owner's six Nepal receipts, e.g. `09/04/2080` and a Miti
  `20/06/2080`). AD on Nepali POS printers was MDY on every receipt where a Miti settles it (two receipts). That's a small sample, so it is a tie-breaker, not a rule.

### Model output: transcribe, don't decide

| Field | Keep? | Why |
| --- | --- | --- |
| `dates[].text` (as printed, Devanagari kept) | Yes | The evidence. Code parses it, and it lands in `raw_json`, so a table fix can re-resolve old receipts |
| `dates[].label` | Yes | Separates Miti from Date, and due/expiry dates from the sale date |
| `dates[].calendar` (`ad` / `bs` / `unknown`) | Yes, as a hint | Cheap enum. Code overrides it with the year range |
| `dates[].role` (`transaction` / `other`) | Yes | Due, delivery and expiry dates appear on invoices |
| `receiptDate` (model's AD reading) | Keep | Tie-breaker for day/month order. Old `raw_json` rows have only this |
| Free-text `reason` | **No** | Costs output tokens, nothing can verify it, and it's another place for injected text to land. Code records its own `check` |

### Decision table (resolver, `packages/core`, pure)

Order of operations: normalise digits and month names → drop fiscal-year tokens → calendar from the year → readings
by order convention and per-calendar validity → AD/BS cross-check → bounds (≥ 2000-01-01, ≤ upload day + 1) →
tie-break → store a date and a `check`. "Flag" means the date check puts the receipt in Needs review, with a checklist
line that shows the printed text and the readings.

| # | Printed (examples) | Resolver | Stored | `check` | Flag |
| --- | --- | --- | --- | --- | --- |
| 1 | `2071/11/25` and `2015/03/09` under one `Date` (Yinyang) | BS (year ≥ 2056) and AD (year ≤ upload year), both year first so YMD; BS→AD = 2015-03-09 | 2015-03-09 | `agree` | No |
| 2 | `Date 10/07/2023`, `Miti 20/06/2080` | AD readings 10 Jul / 7 Oct; Miti DMY → 2023-10-07; only MDY matches | 2023-10-07 | `agree` | No |
| 3 | `09/04/2080` only, no label | BS by year; year last so DMY; Shrawan 9 2080 | 2023-07-25 | `single` | No |
| 4 | `२०८१/०७/१५`, `2081-07-15`, `15/07/81` | Digits normalised; BS by year (`81` can only be BS); convert | AD equivalent | `single` | No |
| 5 | `१५ कार्तिक २०८१`, `15 Kartik 2081` | Month name → BS | AD equivalent | `single` | No |
| 6 | `25/07/2023` alone | AD; 25 > 12, so only DMY is valid | 2023-07-25 | `single` | No |
| 7 | `05/06/2024` alone, no Miti | AD; both orders valid. Take the model's `receiptDate` if it's one of the two, else the locale prior (none for Nepal) | Best reading | `ambiguous` | **Yes**, with one-tap "5 Jun / 6 May" |
| 8 | AD and Miti both printed, no reading pair converts to the other | Prefer the AD reading (single valid, else the model's) | AD reading | `conflict` | **Yes** |
| 9 | Label disagrees with the year (`मिति 2024-…`, or `A.D.` with 2081) | Year wins | Per year | `conflict` | **Yes** (probably a misread digit) |
| 10 | `FY 2081/82`, `081/82`, a bill number ending `-80/81` | Not a date. Used as BS context and as a bound (Shrawan 1 2081 to the end of Asar 2082) | (no change) | `conflict` if the date falls outside | If outside |
| 11 | BS day 32 (`32/03/2081`) | Valid only if that BS month has 32 days in the table | AD equivalent, or null | `single` / `implausible` | If invalid |
| 12 | BS year past the table, AD after upload + 1, year 2027 to 2055, before 2000 | No calendar fits | null | `implausible` | **Yes**, show the printed text |
| 13 | Date text printed but unparseable | Nothing parses | null | `implausible` | **Yes**, show the printed text |
| 14 | More than 3 years before the upload (owner's bound, plan Q4) | Valid but old | Date | `ambiguous` | Yes |
| 15 | No date printed (`dates: []`, `receiptDate: null`) | Nothing to resolve | null | `none` | No (the existing "No date was found." line stays) |
| 16 | Old row: no `dates` in `raw_json` | Fall back to `receiptDate` through today's `parseReceiptDate` + bound | As today | `single` / `none` | As today |

When it's ambiguous, store the best reading and flag it. Don't store null. A date in the right month is still useful
in reports, and the flag tells the person to check it. The printed text stays in `raw_json` and appears in the
checklist line.

Unverified assumption: BS dates are never printed MDY. No receipt we have shows it. If the bench or users find one,
treat BS with the year last like AD (both orders, flag when ambiguous).

### Smaller than the plan where it can be

- **Same as the plan:** vendored month table (no dependency), resolver in core, BS derived from AD and never stored,
  printed text in `raw_json`, a `receipt_date_check` column. The column design is the data-model review's call.
- **Smaller:** `dates[]` has at most **4** entries (the plan says 6). No learned per-merchant order. No BS display or
  CSV in this step. The table needs BS 2056 to the current year (+1 for the new-year crossover). Years before 2070 are
  only for old receipts and can wait if they're costly to verify.
- **Added to the plan:** fiscal-year tokens (row 10) and the label-vs-year conflict (row 9). Needs review must include
  the date check (§4).
- **The plan's current-state table (§1) is stale.** Prompt v2 now has the Miti rule. `receipt_date` is a real `date`
  with a check and an index (#127).

## 3. Bill number and seller PAN/VAT

Nepal context: a PAN- or VAT-registered seller issues a numbered bill
([NPR payments plan](../plans/2026-11-07-payments-nepal.md), "Bills"). Restaurant and POS bills print a lot of numbers
close together. The Yinyang receipt has PAN, phone, Bill No., Table No. and the print time within five lines.

| Field | Definition (schema description) |
| --- | --- |
| `invoiceNumber` (`string \| null`, max 64) | The seller's bill or invoice number that identifies this sale in their books: labelled Bill No., Invoice No., Inv. No., Tax Invoice No., Receipt No., बिल नं., बीजक नं. Copy it exactly as printed, with prefixes, dashes, slashes and fiscal-year parts (`SI-0042-81/82`). `null` when none is printed. Not a PAN or VAT number, phone number, table, KOT, order, token, queue, counter, terminal, cashier, card, approval, reference or transaction id. For a payment or transfer screenshot, `null` |
| `sellerTaxId` (`string \| null`, max 32) | The seller's tax registration number as printed: PAN, VAT No., PAN/VAT No., स्थायी लेखा नं. (Nepal, 9 digits), GSTIN (India, 15 characters), VAT ID, ABN, TIN. `null` when none is printed. Never the buyer's PAN (Buyer's PAN, Customer PAN, क्रेताको स्थायी लेखा नं.) |

Deterministic checks after the model, in core:

- Normalise for comparison and dedup only (NFKC, Devanagari digits to ASCII, upper case, no spaces). Store as printed.
- If `invoiceNumber` equals `sellerTaxId` after normalising, set `invoiceNumber` to null: the model took the PAN.
- If the currency is NPR and `sellerTaxId` isn't 9 digits, keep it but don't use it for matching.
- Don't extract buyer fields (buyer name and PAN). They are personal data and nothing uses them yet.
- A fiscal-year suffix in `invoiceNumber` gives the date resolver a bound (row 10).

A payment reference (eSewa or Khalti transaction id) is useful for duplicate detection, but it's a different field.
Leave it out until duplicate detection is designed.

## 4. Confidence

Data: 296 successful runs from 2026-11-07 (Haiku, Sonnet and Opus 5.5 and Gemini 3.5 Flash-Lite; 37 receipts × 2
preps; prompt v1). "Wrong" means total, merchant, subtotal, tax or currency scored 0. Date is excluded because BS-only
nulls were wrong on purpose. These figures come from one run per receipt and are not significant on their own.

**Overall confidence and the `< 0.9` Needs-review rule** (`repository.ts:161`):

| Model | Runs | Wrong | Flagged (< 0.9) | Wrong and flagged |
| --- | --- | --- | --- | --- |
| Haiku 5.5 | 74 | 17 | 50 (68%) | 16 |
| Sonnet 5.5 | 74 | 16 | 43 (58%) | 12 |
| Opus 5.5 | 74 | 10 | 31 (42%) | 6 |
| Gemini 3.5 Flash-Lite | 74 | 18 | 3 (4%) | 1 |

The same threshold means something different for each model. Haiku catches almost every error but flags two thirds
of receipts. Flash-Lite answers 0.95 to 0.99 almost every time and catches 1 error in 18. The suggested chain is Haiku,
then Flash-Lite (`results/2026-11-07-real.md`), so the meaning of "Needs review" would depend on which model happened
to answer.

**Per-line confidence** (lines matched to the answer key by the bench's own rule, `score.ts:62-85`; the UI marks a
line below 0.75, `apps/web/lib/format.ts:112-118`):

| Model | Correct lines (mean, marked) | Wrong or extra lines (mean, marked) |
| --- | --- | --- |
| Haiku | 368 (0.83, 55) | 11 (0.74, 4) |
| Sonnet | 371 (0.89, 20) | 14 (0.80, 3) |
| Opus | 373 (0.91, 12) | 17 (0.84, 2) |
| Flash-Lite | 375 (0.96, 0) | 9 (0.95, 0) |

On average, wrong lines score a little lower for the Claude models. As a flag it is noise: 9 of 51 wrong lines are
marked, and 87 of 96 marked lines are correct. Values cluster on round numbers (0.95, 0.9, 0.85, 0.8 are 78% of all
line scores).

**Recommendation:**

- **Don't add per-field confidence numbers** for merchant, date or total. They'd be self-reported the same way, and
  nothing suggests better calibration (unmeasured). The per-field signal the review plan asked for comes from
  deterministic checks instead:
  - date: the resolver's `check` (`ambiguous`, `conflict`, `implausible`);
  - total: missing, or the arithmetic check;
  - merchant: missing;
  - invoice number: equals the PAN;
  - currency: inferred rather than printed (a later, cheap enum).
- **Needs review = any per-field check fires, OR overall confidence is below a per-model threshold** taken from the
  bench (or dropped from the rule until one model meets the bar below). Today's rule counts only confidence
  (`repository.ts:216-219, 641`). The review-state plan already moves to checks plus a state.
- **Per-line flag:** replace model confidence with `|quantity × unitPrice − totalPrice| > 0.01` and with a sum of lines
  that doesn't match the subtotal. Remove `items[].confidence` from the schema in v3 only after the A/B shows no
  accuracy change; it saves about 7 output tokens per line. The landing page promises a confidence score "for each line"
  (`apps/web/components/landing-page.tsx:47`), so this is a product decision.
- **Fix the arithmetic check's main false alarm in Nepal.** Restaurant bills add a 10% service charge, which has no
  field (`prompt.ts:63`). So subtotal + tax ≠ total on every such bill (Yinyang: 595 + 85.09 vs 739.59). The check
  fired on 31 of 74 Haiku runs and caught 8 of 17 wrong ones. Add `serviceCharge` and `discount` amounts so the check
  balances.
- **Bar before any confidence drives the rule:** per model, at the chosen threshold, catch ≥ 80% of key-field errors
  while flagging ≤ 30% of receipts, measured on at least two runs. No model meets both today.

## 5. Prompt and schema changes (diff sketch, prompt v3)

New version `v3` in `PROMPT_VERSIONS` (`prompt.ts:24-26`), so the A/B against v2 stays possible.

```diff
 // packages/ai/src/schema.ts, FIELD_DESCRIPTIONS
   receiptDate:
-    "The transaction date in the Gregorian (AD) calendar as YYYY-MM-DD, or null when none is printed or legible. When a Bikram Sambat date (Miti, year 2070 to 2090) is printed beside it, the AD date is often MM/DD/YYYY: choose the day and month order that matches the Miti's month. A Bikram Sambat date alone gives null.",
+    "Your reading of the transaction date in the Gregorian (AD) calendar as YYYY-MM-DD, or null. Never convert a Bikram Sambat date: when only a BS date is printed, null. The stored date is decided from `dates`.",
+  dates:
+    "Every date printed on the receipt, in printed order, at most 4: the sale or issue date, a Miti beside it, due or delivery dates. Not a fiscal year such as 2081/82. [] when none is printed.",
+  dateText:
+    "The date exactly as printed: same digits (Devanagari stays Devanagari), separators and month names, without the time.",
+  dateLabel: "The label printed with it (Date, Miti, मिति, वि.सं., Bill Date, Due Date), else null.",
+  dateCalendar:
+    "bs when its label (Miti, मिति, B.S., वि.सं.), a Nepali month name or a year from 2056 on shows Bikram Sambat; ad when its label, an English month name or a year up to today's shows Gregorian; else unknown.",
+  dateRole: "transaction for the sale or issue date and its Miti; other for due, delivery, expiry or print dates.",
+  invoiceNumber:
+    "The seller's bill or invoice number (Bill No., Invoice No., Inv. No., Receipt No., बिल नं.), copied exactly with prefixes and fiscal-year parts. null when none is printed. Not a PAN or VAT number, phone, table, KOT, order, token, terminal, cashier, card, approval or transaction id.",
+  sellerTaxId:
+    "The seller's tax registration number as printed (PAN, VAT No., PAN/VAT No., स्थायी लेखा नं., GSTIN, VAT ID), else null. Never the buyer's PAN.",
+  serviceCharge: "A printed service charge amount (Service Charge 10%, SC), else null. Not tax, not tip.",
+  discount: "A printed bill-level discount as a positive amount, else null. Not a discount under one line.",

 // buildSchema
     receiptDate: d(z.string().max(32).nullable(), "receiptDate"),
+    dates: d(
+      z.array(z.object({
+        text: d(z.string().max(40), "dateText"),
+        label: d(z.string().max(40).nullable(), "dateLabel"),
+        calendar: d(z.enum(["ad", "bs", "unknown"]), "dateCalendar"),
+        role: d(z.enum(["transaction", "other"]), "dateRole"),
+      })).max(4),
+      "dates",
+    ),
+    invoiceNumber: d(z.string().max(64).nullable(), "invoiceNumber"),
+    sellerTaxId: d(z.string().max(32).nullable(), "sellerTaxId"),
+    serviceCharge: d(z.number().nullable(), "serviceCharge"),
+    discount: d(z.number().nullable(), "discount"),
```

```diff
 // packages/ai/src/prompt.ts, V3_SYSTEM <dates> (v2's block is prompt.ts:70-77)
 <dates>
-- receiptDate is the Gregorian (AD) transaction or issue date. Prefer it over due, delivery or expiry dates.
-- Decide day and month order from the country and from other dates on the receipt. US receipts print MM/DD/YYYY. Nepali POS systems often print the AD date as MM/DD/YYYY.
-- If both an AD date and a Bikram Sambat (BS) date, often labelled Miti (years 2070 to 2090), are printed, return the AD date and use the Miti to settle day and month order: BS month m falls in AD month m+3 or m+4 (Baisakh, month 1, starts about 14 April). For example, Date 10/07/2023 with Miti 20/06/2080 is 2023-10-07.
-- If only a BS date is printed, return null rather than converting it.
+- Copy every printed date into dates character for character, with its label. Don't convert calendars, reorder day and month, or change Devanagari digits: code does that.
+- Nepali receipts often print a Bikram Sambat (BS) date next to or instead of the Gregorian (AD) one, labelled Miti or मिति, or with no label. A year from 2056 on is BS. 2081/82, 081/82 or 80/81 is a fiscal year, not a date.
+- receiptDate is your AD reading of the sale date. Decide day and month order from the country and from a Miti beside it (BS month m falls in AD month m+3 or m+4). If only a BS date is printed, receiptDate is null and the BS date still goes in dates.
 - A two-digit year is usually the last part (DD-MM-YY or MM-DD-YY) and means 20YY.
 - Never return a date after today, or before 2000 unless a four-digit year says so.
 </dates>
+
+<numbers-on-the-bill>
+- invoiceNumber is the bill or invoice number. Receipts print many numbers near it: a PAN or VAT number, phone, table, KOT, order or token number. None of those is the bill number; when only those are printed, invoiceNumber is null.
+- sellerTaxId is the seller's PAN or VAT number, never the buyer's.
+</numbers-on-the-bill>
```

`<amounts>` (`prompt.ts:62-64`) changes the same way: service charge and bill-level discount go in their own fields,
and nothing else changes.

Wiring: in `ReceiptRepo.complete` (`repository.ts:466`), the resolver replaces `parseReceiptDate`, takes
`extraction.dates`, `extraction.receiptDate`, `extraction.invoiceNumber` and the row's upload day, and writes `date` +
`check`. The SQL upper bound (`plausibleDate`) stays as a backstop. The tests to change are `prompt.test.ts:24-33` and
`receipts.int.test.ts:195-198`. Update `docs/architecture/ai.md` (the prompt) and `core.md` (the resolver) in the same
PR. Cost: about +350 input tokens (descriptions) and +40 to 60 output tokens per call. Removing per-line confidence
would offset the output on long receipts.

The owner's failing receipt was read under v2, so its `raw_json` has no printed date. A retry after v3 ships is the
only way to recover it.

## 6. Measuring it

### Fixtures to add

All synthetic, rendered by `make-fixtures.mjs` with invented merchants and an obviously fake PAN (`999000001` style).
The repo is public, so no real receipts, names or PANs, apart from the Commons image already committed.

| Fixture | Prints | Truth | Tests |
| --- | --- | --- | --- |
| `npr-bs-only-dmy` | `मिति: 09/04/2080` only | 2023-07-25, `single` | BS-only, DMY, Devanagari label |
| `npr-bs-devanagari` | `मिति: २०८१/०७/१५` | AD equivalent, `single` | Devanagari digits, year first |
| `npr-bs-nolabel` | `Date: 2081-07-15`, no marker | AD equivalent, `single` | The owner's case: no BS/AD marker |
| `npr-bs-monthname` | `१५ कार्तिक २०८१` | AD equivalent | Nepali month name |
| `npr-ad-miti-mdy` | `Date 10/07/2023`, `Miti 20/06/2080` | 2023-10-07, `agree` | Order settled by the Miti |
| `npr-ad-miti-dmy` | `Date 07/10/2023`, `Miti 20/06/2080` | 2023-10-07, `agree` | The same check in the other order (no rule of thumb) |
| `npr-ad-ambiguous` | `05/06/2024` only | `dateCheck: ambiguous` | Must be flagged, never `single` |
| `npr-fy-trap` | `FY 2081/82`, `Bill No: INV-81/82-00123`, BS date | BS date; FY not a date | Fiscal-year token |
| `npr-day32` | `32/03/2081` (a 32-day Asar) | AD equivalent | Day 32 only valid in BS |
| `npr-future-bs` | BS year past the table | null, `implausible` | Upper bound (fixed upload day) |
| `npr-bill-traps` | PAN, phone, Table No., KOT No., Token, Bill No. | `invoiceNumber`, `sellerTaxId` | Bill number vs PAN, table and KOT |
| `npr-no-bill` | Order No. and Token only | `invoiceNumber: null` | Precision: no number made up |
| `npr-service-charge` | Sub Total, 10% SC, 13% VAT, G.Total | `serviceCharge`, sums balance | Arithmetic false alarm |
| `usd-invoice-ids` | `Invoice #`, `Order #`, `Customer ID`, EIN | `invoiceNumber`, `sellerTaxId` | Not Nepal-only |

Also add `invoiceNumber: "7104"` and `sellerTaxId: "500004393"` to the answer key of the committed
`yinyang-kathmandu-2015.json`, which is already the best real case for an unlabelled dual date (`Table No. : 27` is
the trap). The owner's private Nepal set (6 receipts, `~/receipt-ocr-real-receipts/nepal`) gets the same keys
locally. Ask the owner for the ten receipts with both dates (plan Q6). They decide whether POS Miti values are off by
a day.

### Scorer and runner changes

- `ocr.ts` runs the resolver on each extraction and scores the **stored** date with a fixed upload day per fixture
  (`_meta.uploadDay`, default the run day), so the result is reproducible.
- New scored fields: `dateCheck` (exact, when the key has one), `invoiceNumber` and `sellerTaxId` (exact after the
  normalisation in §3; `null` must match `null`), `serviceCharge`.
- Diagnostics in the summary: "BS returned as AD", "order swapped", "null though printed", "fiscal year read as a
  date", "PAN returned as bill number".
- Two runs per model on the Nepal slice: one receipt moves a 6-receipt slice by 17 points.

### Pass bar (v3 vs v2, Haiku 5.5 and Flash-Lite, prep `app`)

| Metric | Bar |
| --- | --- |
| Stored date, Nepal slice (synthetic + owner's 6 + Yinyang), unambiguous fixtures | ≥ 95% (v2: Haiku 67%, Flash-Lite 33%) |
| Ambiguous / implausible fixtures | 100% flagged; **0 wrong dates that aren't flagged** on the Nepal slice |
| Date flag rate on non-Nepal sets | ≤ 10% of receipts |
| Stored date, non-Nepal sets | No receipt that passed on v2 fails on both v3 runs |
| `invoiceNumber` | ≥ 90% exact where printed; 100% `null` or correct on the trap fixtures (never a PAN, table or KOT) |
| `sellerTaxId` | ≥ 95% exact |
| Other fields (total, tax, subtotal, merchant, itemsF1) | No drop beyond one receipt per set |
| Cost | Input +≤ 15%, output +≤ 10% per call vs v2 |

Get the spend estimate with `bun run bench:ocr --dry-run` and the owner's approval before the paid run. v3 ships only
with the before/after table in the PR.

## Order of work

1. **Core, no model change** (about 1.5 d): vendored BS table, converter, parser (Devanagari digits, month names,
   fiscal-year tokens), resolver following the decision table, unit tests with rows 1 to 16 as cases.
2. **Extraction v3** (about 2 d): schema and prompt above, resolver in `complete`, columns from the data-model review
   (`receipt_date_check`, `invoice_number`, `seller_tax_id`, `service_charge`, `discount`), bench fixtures and scorer,
   A/B attached.
3. **Review rule** (about 1 d): Needs review counts the date check and the other per-field checks; a checklist line
   with the printed date and one-tap readings; per-line flag from arithmetic.

BS display, `date_bs` CSV and fiscal-year filters follow the plan's PRs 4 and 5, after this.
