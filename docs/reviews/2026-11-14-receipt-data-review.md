# Receipt data model and review logic (2026-11-14)

Principal review of `main` at `f8d76be`, read-only. Checks what the 2026-11-12
[receipt fields](2026-11-12-receipt-fields-review.md), [extraction](2026-11-12-extraction-review.md) and
[dates and fields](2026-11-12-dates-and-fields-research.md) reviews agreed against what shipped (#216, #224, #227,
#228, #235), and covers line-item editing (data and API), merchant details, duplicates and old receipts' review
reasons. No build, test, server, model call or database query was run; see [Not verified](#not-verified). Already in
flight and not re-proposed here: line marks from arithmetic, raw JSON for admins only, landing and FAQ copy without
"confidence per line".

## Owner decisions

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | The in-flight arithmetic line marks need real quantities. Ship decimal quantity (`numeric(12,3)`, expand and contract) **before or with** them? | **Yes, before.** Otherwise every weighed line (0.75 kg) is flagged (P0-1) |
| D2 | Recompute `review_reasons` for every completed receipt with a job (no model calls), and drop `low_confidence` in the same pass? | **Yes to both.** Reviewed receipts keep their reviewed state (P0-2) |
| D3 | Duplicates: a `possible_duplicate` reason code only, or also a `duplicate_of` column? | **Reason code only**, matched again at read time. Flag the newer receipt, never block an upload |
| D4 | Line editing: one `PATCH` carrying the whole ordered `items` array plus a version, or one route per item? | **One PATCH with the array**, 409 on a stale version |
| D5 | When lines are edited, keep the printed subtotal and total and flag a mismatch, or recompute totals from the lines? | **Keep the printed values and flag them.** Never recompute silently |
| D6 | Approve a paid bench run (about $0.30, two runs per model) for prompt v4: no per-line confidence, plus `taxableAmount`? | **Yes**, after a `--dry-run` estimate |
| D7 | Merchant address, phone, branch, legal name and buyer PAN: keep "never as columns"? | **Keep it.** Add one amount column instead: `taxable_amount` (P1-3) |
| D8 | VAT register export: show the BS date on **every** NPR receipt, not only on receipts that printed BS? | **Yes, in that export only.** The receipt page keeps the 2026-11-12 rule |

## Ranked findings

| P | Finding | Evidence |
| --- | --- | --- |
| P0-1 | **Quantities are still rounded to whole units.** 0.75 kg is stored as `1` and 1.5 L as `2`. Any arithmetic check on `quantity × unit_price ≈ total_price` will flag every weighed line, and the page shows "× 1" for 0.75 kg. The true value exists only in `raw_json` | `packages/core/src/receipt-fields.ts:165-173`, `packages/db/src/index.ts:180-181`, `apps/web/components/receipt-result.tsx:386` |
| P0-2 | **Receipts completed before #224 have no field checks.** Migration 0003 only wrote `{low_confidence}` where confidence < 0.9. Every other old row kept `{}`, so a missing date, missing total, totals mismatch or date problem never shows "Needs review". This explains the owner's undated receipt with no flag (unless it was saved: see P1-5) | `apps/web/drizzle/0003_receipt_fields.sql:20-22`, `packages/core/src/repository.ts:223`, `apps/web/components/receipt-list.tsx:34-35` |
| P1-1 | **Duplicates are not detected.** There is no `possible_duplicate` code, no probe and no file hash, so three rows of the same 3,701.60 bill pass silently. For VAT, that is a double-claimed input credit | `packages/core/src/review-reasons.ts:8-19`; `grep possible_duplicate` finds nothing; `receipts` has no hash column (`packages/db/src/index.ts:68-170`) |
| P1-2 | **Lines can't be edited.** `update` reads items only for the totals check, and `totals_mismatch` doesn't depend on the items | `packages/core/src/repository.ts:863-874`, `review-reasons.ts:101-107`, `receipt-result.tsx:402-403` |
| P1-3 | **The VAT purchase register can't be produced in full.** We have date (AD, plus BS when printed), bill number, supplier name, supplier PAN and VAT. The taxable amount and exempt purchases are missing, and `subtotal − discount + service_charge` gives them only for single-rate bills with no exempt lines | `csv.ts:39-61`, `csv.ts:28-36` (BS only when printed) |
| P1-4 | **STATUS disagrees with the code.** It says "Copy JSON from the row" shipped, but both copies still serialise `rawJson`. It says the PATCH "validates by hand", but it is Zod (`parseReceiptPatch`) | `docs/STATUS.md:337` vs `receipt-actions.tsx:135`, `receipt-result.tsx:408`; `STATUS.md:470` vs `packages/core/src/receipt-patch.ts:250-321`, `route.ts:108` |
| P1-5 | **Saving marks a receipt reviewed even when reasons remain.** An undated receipt saved for another field leaves Needs review with `no_date` still set. This is the owner's 2026-11-13 "save = reviewed" rule; flagged so it is a choice, not a surprise | `repository.ts:875`, `receipt-list.tsx:34` |
| P2-1 | **The rounding slack is too loose.** Any whole-number total accepts a gap up to 0.99 in either direction, for every currency. Round-to-nearest needs at most 0.50 | `review-reasons.ts:68-69` |
| P2-2 | `invoice_number` and `merchant_tax_id` are not searchable from Receipts | `repository.ts:284-287` |
| P2-3 | Amounts are `numeric(12,2)` and the editor takes at most 2 decimals, so KWD, BHD and OMR lose their third decimal; the prompt reads them | `index.ts:96-103`, `receipt-patch.ts:178`, `packages/ai/src/prompt.ts:37` |
| P2-4 | The v2/v3 A/B table lives only in the body of PR #228. `packages/bench/results/` stops at 2026-11-07 | `ls packages/bench/results` |
| P2-5 | `quantity >= 1` refuses return or void lines (negative or fractional) | `index.ts:191` |

## 1. Agreed on 2026-11-12 vs shipped

| Item | State | Evidence | Still right? |
| --- | --- | --- | --- |
| `review_reasons text[]`, no CHECK on values; Needs review = completed, reasons non-empty, not reviewed | Shipped | `index.ts:110-117`, `repository.ts:223` | Yes |
| Codes `no_merchant`, `no_date`, `no_total`, `no_currency`, `totals_mismatch`, `date_*` | Shipped | `review-reasons.ts:8-19, 83-94` | Yes |
| `line_mismatch` | Not shipped (in flight) | absent | Yes, but only on exact quantities (P0-1) |
| `possible_duplicate` | Not shipped | absent | Yes (§6) |
| `low_confidence` with a per-model threshold, or not at all | Not at all for new receipts; old rows keep the backfill | `review-reasons.ts:17`, `0003:20-22` | Drop the backfilled code in the recompute (D2) |
| `serviceCharge` and `discount` in the totals check | Shipped | `review-reasons.ts:56-77`, `schema.ts:61-64` | Yes; the slack needs tightening (P2-1) |
| Decimal quantity `numeric(12,3)` | Not shipped | `receipt-fields.ts:169-173` | Yes, and now urgent (P0-1) |
| `receipt_items.position`, backfilled, read `ORDER BY position, ctid` | Shipped | `index.ts:185-186`, `0003:23-32`, `repository.ts:735` | Yes |
| Prompt v3 A/B, 2 runs × 2 models | Shipped (#228; about $0.25; Nepal stored date 67%→100% on Haiku, 17%→100% on Flash-Lite) | PR #228 body | Yes; commit the table (P2-4) |
| Remove per-line confidence after an A/B | Not shipped: still requested | `schema.ts:33, 88` | Yes (§2) |
| Zod at the PATCH, 400 on a bad field, unknown keys refused | Shipped | `receipt-patch.ts:250-321` | Yes; extend it for items (§3) |
| "Copy JSON" built from the row | Not shipped, though STATUS says so | `receipt-actions.tsx:135` | Covered by the in-flight admin-only track |
| CHECKs `NOT VALID`, then `VALIDATE` in the next file | Shipped | `0003:12-17`, `0004:8-13` | Yes |
| Bill number and tax id searchable | Not shipped | `repository.ts:284-287` | Yes, cheap (P2-2) |

## 2. Confidence end state

- **Store:** keep `receipts.confidence`, the model's overall number, as a hint (`index.ts:108-109`). Keep
  `receipt_items.confidence` nullable, and stop filling it once v4 ships. A line a person edits gets `null`.
- **Show:** nothing in the user UI. After the recompute, the `low_confidence` checklist line
  (`apps/web/lib/receipt-checks.ts:55-56`) has no rows left to show. Admins can still see the number.
- **Export:** keep both CSV `confidence` headers so importers see the same shape (`csv.ts:55, 105`). Item cells go
  empty once v4 ships. Drop the headers only after notice.
- **Ask the model:** overall only. Per-line confidence was noise on the 2026-11-07 data: 87 of 96 marked lines were
  correct, and Flash-Lite never marked one.
- **Cost of dropping it:** `"confidence":0.85,` is about 7 output tokens per line. At the project's prices
  (`packages/ai/src/models.ts`: Haiku $0.50/M output, Flash-Lite $2.50/M), a 20-line receipt saves about $0.00007 on
  Haiku (about 5% of its $0.00135 per Nepal receipt) and $0.00035 on Flash-Lite (about 19% of $0.00182). It also cuts
  latency on long receipts. Accuracy risk: the field may act as a pause per line. Unmeasured; that is what the A/B is for.
- **Measure:** prompt `v4` = v3 minus `items[].confidence`, plus `taxableAmount` (§4), so one paid run covers both.
  `bun run bench:ocr --prompt v3|v4 --prep app --models anthropic:claude-haiku-5-5,google:gemini-3.5-flash-lite`,
  two runs each, on the synthetic, Commons and private Nepal sets: the same shape as #228, about $0.25 to $0.30.
  Run `--dry-run` first and get the owner's OK (D6). Bar: items F1, total and subtotal no worse than one receipt per
  set; output tokens down. Add a free scorer metric: the share of lines where `|q×u − t| > 0.01`, on the stored
  quantity.

## 3. Line-item editing: data and API

**Shape.** Extend the existing `PATCH /api/receipts/[id]`. Don't add per-item routes. One request carries the
header fields and an optional `items` array: the full list, in display order. That gives one transaction, one
reasons recompute and one `reviewed_at` stamp, and a reorder is atomic. Per-item routes would take N round trips,
leave half-saved states and recompute the reasons N times.

```ts
// packages/core/src/receipt-patch.ts, extending receiptPatchSchema
items: z.array(z.strictObject({
  id: z.uuid().optional(),                 // existing line; omitted = new line
  name: limited("Item", 300),              // required, 1..300 after trim
  quantity: quantity(),                    // decimal string or number, > 0, ≤ 1,000,000, ≤ 3 decimals
  unitPrice: amount("Unit price"),         // nullable
  totalPrice: amount("Line total"),        // nullable; negative allowed (discount lines)
})).max(300).optional(),
version: z.iso.datetime().optional(),      // the row's updatedAt the editor loaded; required when items is sent
```

- **Money:** decimal strings on the wire, parsed by the existing `parseAmount`, stored as `numeric(12,2)`, compared
  in integer minor units (`cents()`, `review-reasons.ts:44-48`). Don't switch the storage to integer minor units.
  Every reader already handles numeric strings, and 3-decimal currencies are a widening of the column (P2-3).
- **Apply, in `ReceiptRepo.update` under the existing `FOR UPDATE` (`repository.ts:841-846`):**
  1. Return 409 if `version ≠ row.updatedAt`.
  2. Every given `id` must belong to this receipt, else 400.
  3. Update the matched lines, insert the new ones and delete the omitted ones.
  4. Set `position` to the array index.
  5. Set `confidence = null` on changed or new lines.
  6. Mark `items` as changed.
- **Reasons:** add `"items"` to `totals_mismatch`'s dependencies, and give `line_mismatch` `["items"]`
  (`review-reasons.ts:101-107`). Totals are never recomputed (D5): a printed total is evidence. The editor can offer
  "use line sum as subtotal" as an explicit action.
- **Reviewed and undo:** saving stamps reviewed, as header edits already do (`repository.ts:875`). Undo on the
  client re-sends the previous payload with the new `version`. There is no server history.
- **Audit:** `reviewed_by` and `reviewed_at` already record who saved last, and `raw_json` keeps what the model
  read, so "changed from the scan" can be derived per field. The wide event logs changed keys only (`route.ts:112-115`);
  add `items: true` and a line count. A per-edit history table can wait until an accountant workflow asks for one.
- **Two editors:** today header edits are last-writer-wins, per field. With items, `version` is required. A stale
  save gets 409 "This receipt changed; reload", and the client keeps the form contents.
- **CSV:** item `quantity` becomes a decimal (`0.750`; whole numbers print as `1`), and edited lines have an empty
  `confidence`. Headers don't change.

**PRs**

| PR | Scope | Migration |
| --- | --- | --- |
| 1 | Decimal quantity, expand: `ADD COLUMN quantity_exact numeric(12,3)` (nullable, `CHECK (quantity_exact > 0) NOT VALID`), backfilled from `raw_json->'items'->position->>'quantity'` only where the stored line count equals the `raw_json` count. Core writes both columns; readers prefer `quantity_exact`. The in-flight `line_mismatch` reads it | **0009**, `lock_timeout` first |
| 2 | Items in PATCH: schema, `version`, 409, diff-apply, reasons dependencies, int tests (reorder, delete, add, stale version, foreign id) | none |
| 3 | `receipt.recheck` job (§5) | none |
| 4 | Duplicate probe and `possible_duplicate` (§6) | none |
| 5 | Contract, one release after PR 1: `VALIDATE`, then rename or drop the integer `quantity` | **0010** |

## 4. Merchant details and the VAT register

Nepal VAT purchase register columns (Tally and secondary guides; Schedule text not found, as on 2026-11-12): date
(BS), bill number, supplier name, supplier PAN, total purchase, exempt purchase, taxable purchase, VAT.

| Column | From stored fields? |
| --- | --- |
| Date (BS) | Derived. CSV fills `receipt_date_bs` only when the receipt printed BS (`csv.ts:28-36`); the register export should derive it for every NPR receipt (D8) |
| Bill number, supplier PAN | `invoice_number`, `merchant_tax_id` |
| Supplier name | `merchant` (trading name). With the PAN, enough to identify the supplier |
| VAT | `tax` |
| Taxable, exempt | **Missing.** Nepali VAT bills print "Taxable Amount" (and often a non-taxable line). Inclusive supermarket prices make `total / 1.13` wrong once one exempt item is on the bill |

Recommendation (D7):

- Keep "never as columns" for address, phone, branch and legal name. No paying use reads them, and they would
  add personal-data surface.
- Don't extract the buyer PAN per receipt. Its one use, "this bill doesn't carry our PAN, so no VAT credit", needs
  one workspace setting and one reason code later.
- Add `taxable_amount numeric(12,2)`, printed only, nullable, in v4 (same paid run). Exempt purchase is then
  `total − taxable − VAT`, within the rounding slack.

## 5. Old receipts' review reasons (P0-2)

**Mechanism.** Before #224, nothing wrote `review_reasons`. Migration 0003 added the column with default `{}` and
wrote `{low_confidence}` only where confidence < 0.9 (`0003:20-22`). Since #224 and #228, `complete` computes the
full set (`extraction-fields.ts:107`, `repository.ts:602-611`). A receipt completed earlier with confidence ≥ 0.9 and
no date therefore has `{}`, and no badge (`receipt-list.tsx:35`). The owner's rows were not queried. A read-only
check for staging or production, with the owner's OK through the coordinator:
`select count(*) filter (where receipt_date is null), count(*) filter (where total is null), count(*) from receipts where status = 'completed' and review_reasons = '{}' and reviewed_at is null;`

**Job `receipt.recheck`.** A job kind in `packages/core/src/jobs/kinds`; one enqueue per deploy that adds a code.

- **Batches:** keyset over `(id)`, 200 receipts per transaction, each row `FOR UPDATE SKIP LOCKED` so an open edit
  wins. No model calls.
- **Fields checks:** `reviewReasons()` on the stored row and items (`review-reasons.ts:83`). This uses the edited
  values, not `raw_json`.
- **Date reasons:**
  - Re-run `resolveReceiptDate` on `raw_json.dates` only while `receipt_date` still equals the resolver's date. A
    person's date wins, and their date reasons stay cleared (`editedReasons`, `review-reasons.ts:119-125`).
  - Rows from before v3 have no `dates[]`; they get only `no_date`.
- **`low_confidence`:** dropped (D2).
- **Unknown codes:** kept, as `editedReasons` does.
- **Idempotent:** it writes only where the computed array differs, and it never touches `reviewed_at` or
  `updated_at`. A reviewed receipt stays reviewed, so the person's "looks right" stands. It shows the new reasons
  only if someone clears the review.
- **Tests:** an int test with pre-v3, v3, edited-date and reviewed fixtures; a second run is a no-op.

## 6. Duplicates: data side

- **Probe:** in `complete`'s transaction, after the row is written, within the same workspace. Never block an
  upload or a completion.
  1. **Strong:** `identifierKey(merchant_tax_id)` and `identifierKey(invoice_number)` both equal
     (`extraction-fields.ts:49-52`). Candidates come from `receipt_date` within ±400 days, through
     `receipts_org_receipt_date_idx` (`index.ts:150`). Numbering restarts each fiscal year, so a bill number alone
     is not a key.
  2. **Fallback**, when either id is missing: `merchantKey(merchant)` (`merchant-key.ts:31`) and `total` and
     `currency` equal, and the same `receipt_date`. When there is no date, `created_at` within 7 days through
     `receipts_org_created_at_idx`. This catches the 3,701.60 × 3 and 185.00 × 2 cases.
- **Write:** `possible_duplicate` on the newer receipt only. The older one stays clean. "Not a duplicate" is the
  existing Mark reviewed.
- **No `duplicate_of` column** (D3). The detail page finds the match again with the same query, so deleting the
  original can't leave a dangling pointer. Add the column only if a merge flow is built.
- **No new index** at today's volume: both probes ride existing indexes, and the comparison happens in TypeScript on
  a handful of rows. Re-check with `EXPLAIN (ANALYZE, BUFFERS)` on the seeded 10k workspace in the PR. Past that, a
  partial index `(organization_id, merchant_tax_id) WHERE merchant_tax_id IS NOT NULL`, `CONCURRENTLY`.
- **Race:** two copies completing at the same moment can miss each other. The recheck job (§5), which also runs the
  probe, catches them later.
- **Identical bytes** (the same photo uploaded twice) belong to the upload idempotency work from the
  [principal review](2026-11-12-principal-review.md) (finding 4), as a content hash. They are not this reason code.

## 7. Other correctness checks

- **BS `dd/mm/yyyy` and `date_ambiguous`:** no false alarm. A BS year-last date yields one reading (DMY), so
  ambiguity can't fire (`packages/calendar/src/resolve.ts:203-210`: one `bsReading`). `date_ambiguous` fires only when:
  - an AD date has two valid orders and no Miti (`:283`);
  - the date is more than 3 years old (`:306`);
  - a BS date is past the official table, 2083 (`:309-310`, `bs-table.ts:5`).
- **Tax-inclusive totals:** the check accepts base = total (`review-reasons.ts:71-72`), so inclusive bills pass.
  It also means a total misread as the subtotal passes. That is a known follow-up (`STATUS.md:385`); `taxable_amount`
  gives the check a second identity.
- **Currency:**
  - A null currency adds `no_currency` (`review-reasons.ts:91`) but displays as USD (`index.ts:94`,
    `receipt-checks.ts:44`).
  - A null currency also makes the AD date win a conflict that the 2026-11-12 decision gives to BS on NPR bills
    (`resolve.ts:294`).
  - A workspace default currency would fix both. P2.
- **Amounts:** `storableAmount` stores `String(value)` of a float (`receipt-fields.ts:157-160`), and Postgres
  rounds it to 2 places on insert. That is correct for 2-decimal currencies.

## Not verified

- No database was queried. Whether the owner's undated and duplicate receipts are pre-#224 rows (P0-2) or saved
  rows (P1-5) is inferred from code. The SQL in §5 settles it.
- No tests, builds or model calls were run. Token and cost figures are estimates from `models.ts` prices and the
  #228 table.
- The VAT register columns and the claim that "Taxable Amount" is printed on most Nepali VAT bills come from the
  2026-11-12 research and the owner's receipts as described there, not from the VAT Rules text.
- The `quantity_exact` backfill assumes `position` equals the `raw_json.items` index, which holds for rows written
  by `storedExtraction` (`extraction-fields.ts:92-94`) and by the 0003 backfill. Unchecked on real rows.
