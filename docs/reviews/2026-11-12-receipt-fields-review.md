# Receipt data model review: bill number, BS dates, confidence, long-term fields (2026-11-12)

Scope: `main` at `297c628`, read-only. Covers `receipts` and `receipt_items` (`packages/db/src/index.ts:68-152`), the
extraction schema and prompt (`packages/ai/src/schema.ts`, `prompt.ts`), `packages/core/src/repository.ts`, the receipt
page and editor, the CSV, and [`docs/architecture/`](../architecture/README.md). It follows the
[database skill](../../.claude/skills/database/SKILL.md) and builds on the
[dual-calendar plan](../plans/2026-11-07-dual-calendar-dates.md), the
[review-state review](2026-11-07-review-state-and-flagging.md) and today's
[extraction review](2026-11-12-extraction-review.md), which owns prompts, the resolver and the benchmark and leaves
the column design to this one. No database was touched: the SQL below was not run and no `EXPLAIN` was taken. What
could not be checked is listed in [Not verified](#not-verified).

## Verdict

- **Add seven columns in one additive migration**, written by extraction v3: `invoice_number`, `seller_tax_id`,
  `discount`, `service_charge`, `receipt_date_calendar`, `review_reasons` on `receipts`, and `position` on
  `receipt_items`. All are nullable or have a constant default, so nothing is rewritten and the running code is
  unaffected.
- **Bill number: yes, `invoice_number text`, as printed. Not unique, no index yet.** Duplicates are flagged by a
  query, never rejected by a constraint.
- **BS dates: one stored date (AD), BS always derived, never a second column.** "Both filled automatically" is a
  property of what core returns (`receiptDate` and `receiptDateBs` on every dated receipt, in the UI, CSV and JSON),
  not of the table. What the receipt printed stays in `raw_json.dates[]`. One small column,
  `receipt_date_calendar`, records which calendar the stored date was read from. Vendor the month table; don't add
  a dependency.
- **Confidence: keep the overall number as an input, stop using it as the rule.** No per-field confidence
  numbers. Per-field signals are deterministic checks whose codes are stored in one column, `review_reasons`.
  "Needs review" reads that column, so `NEEDS_REVIEW_BELOW` leaves SQL. Per-line confidence stays as a nullable
  column and stops being requested once the A/B allows it.
- **Other fields:** seller tax id, discount and service charge now. Payment method, document type, time, decimal
  quantity and a duplicate pointer later, each with the feature that reads it. Fiscal year, buyer PAN per receipt,
  due date, addresses and rounding: never as columns.
- **Rule for every future field:** it goes to `raw_json` first (schema, prompt, benchmark). It becomes a column
  only when something filters, sorts, joins, edits or exports it.

Four defects found on the way, all in the data model's path:

| #   | Finding                                                                                                                                                                                                                                                             | Where                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Line items have no stored order.** The id is a random UUID, the table has no ordinal, and the read has no `ORDER BY`. Printed order survives only because rows usually come back in insertion order. The extraction schema promises "in printed order"            | `packages/db/src/index.ts:136`, `repository.ts:601-604`, `packages/ai/src/schema.ts:26`                                     |
| 2   | **"Copy JSON" exports the model's raw output, not the corrected receipt.** A user's edit reaches the CSV but not the JSON. Once `raw_json` also carries evidence such as `dates[]`, that leaks into the export too                                                  | `apps/web/components/receipt-result.tsx:448`, `receipt-actions.tsx:122`                                                     |
| 3   | **Weights and volumes are rounded to whole units.** `quantity` is an `integer` and core rounds `0.5 kg` to 1 and `33.9 L` to 34, so `quantity × unit_price` no longer equals `total_price`. The true value is still in `raw_json`                                   | `packages/db/src/index.ts:142`, `repository.ts:492`                                                                         |
| 4   | **The review checks exist twice, in React, and SQL knows none of them.** The page's checklist and the "Needs review" filter disagree: a 0.95 receipt whose amounts don't add up is not in the filter; a 0.85 receipt corrected by hand stays in it for good         | `receipt-result.tsx:66-104`, `content/content-example.tsx:19-36` (a partial copy), `repository.ts:216-220`, `repository.ts:641`              |

Also: `0001_billing.sql` has no `SET LOCAL lock_timeout` and adds a validated `CHECK` to `ocr_rounds` (line 49). The
baseline's comment says one `SET LOCAL` covers every pending file, which holds only while `0000` is pending. Every
new file needs its own first line.

## Proposed schema diff

Source of truth is `packages/db/src/index.ts`; `bun run db:generate` writes the file (one `ALTER` per column, same
effect) and the hand edits are the two `SET LOCAL` lines, `NOT VALID` and the two backfills. If extraction v3 ships
as two PRs, split the file along the same line; nothing below depends on the order.

```sql
-- apps/web/drizzle/0002_receipt_fields.sql
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s'; -- the two backfills; milliseconds at today's volume

-- Metadata-only: nullable, or a constant default (no table rewrite).
ALTER TABLE "receipts"
  ADD COLUMN "invoice_number" text,
  ADD COLUMN "seller_tax_id" text,
  ADD COLUMN "discount" numeric(12, 2),
  ADD COLUMN "service_charge" numeric(12, 2),
  ADD COLUMN "receipt_date_calendar" text,
  ADD COLUMN "review_reasons" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "receipt_items" ADD COLUMN "position" smallint DEFAULT 0 NOT NULL;

-- Single-column checks only, so code that doesn't know a column can't violate one.
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_number_check"
  CHECK (char_length(invoice_number) BETWEEN 1 AND 64) NOT VALID;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_seller_tax_id_check"
  CHECK (char_length(seller_tax_id) BETWEEN 1 AND 32) NOT VALID;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_discount_check" CHECK (discount >= 0) NOT VALID;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_service_charge_check" CHECK (service_charge >= 0) NOT VALID;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_receipt_date_calendar_check"
  CHECK (receipt_date_calendar IN ('ad', 'bs', 'both')) NOT VALID;
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_position_check" CHECK (position >= 0) NOT VALID;

-- Backfill 1: existing rows keep today's rule (repository.ts:161). Idempotent.
UPDATE "receipts" SET "review_reasons" = '{low_confidence}'
  WHERE "status" = 'completed' AND "confidence" < 0.9 AND "review_reasons" = '{}';
-- Backfill 2: freeze the order people see today.
UPDATE "receipt_items" i SET "position" = o.n
  FROM (SELECT id, row_number() OVER (PARTITION BY receipt_id ORDER BY ctid) - 1 AS n FROM "receipt_items") o
  WHERE o.id = i.id AND o.n <> 0;
```

```sql
-- apps/web/drizzle/0003_review_state.sql, the release after, with the review-state work
SET LOCAL lock_timeout = '5s';
-- First, before any ALTER takes ACCESS EXCLUSIVE in this transaction: the scan then runs under SHARE UPDATE EXCLUSIVE.
ALTER TABLE "receipts" VALIDATE CONSTRAINT "receipts_invoice_number_check";
-- ... one VALIDATE per constraint added NOT VALID in 0002 ...
ALTER TABLE "receipts"
  ADD COLUMN "reviewed_at" timestamp with time zone,
  ADD COLUMN "reviewed_by" text; -- FK to "user" ON DELETE SET NULL, added NOT VALID, with its index (review-state plan)
```

Later, each with the feature that reads it (not now):

```sql
-- Duplicate detection: the probe at completion, and exact search by bill number.
CREATE INDEX CONCURRENTLY "receipts_org_invoice_number_idx"
  ON "receipts" ("organization_id", "invoice_number") WHERE "invoice_number" IS NOT NULL;
ALTER TABLE "receipts" ADD COLUMN "duplicate_of" uuid;                  -- flagged, never blocked
-- Weights and volumes (expand, backfill from raw_json, contract).
ALTER TABLE "receipt_items" ADD COLUMN "quantity_exact" numeric(12, 3);
-- Reconciliation and Nepal VAT filters.
ALTER TABLE "receipts" ADD COLUMN "payment_method" text;                -- cash, card, wallet, bank, credit
ALTER TABLE "receipts" ADD COLUMN "document_type" text;                 -- receipt, tax_invoice, abbreviated, estimate, payment
ALTER TABLE "receipts" ADD COLUMN "receipt_time" time;
```

No new index in `0002`. "Needs review" keeps its plan shape: the same scan of `receipts_org_created_at_idx` with a
filter, where the predicate changes from `confidence < 0.9` to `review_reasons <> '{}'`. Run
`EXPLAIN (ANALYZE, BUFFERS)` on the seeded 10k workspace in the PR, as rule 6 asks.

## 1. Bill / invoice number

| Question   | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add it?    | Yes. It is printed on every bill from a PAN- or VAT-registered seller in Nepal, it is the invoice identifier in EN 16931 (BT-1) and in the IRD billing API (`invoice_number`), and with the seller's PAN it turns an expense list into a purchase register                                                                                                                                                                                              |
| Name       | `invoice_number` in the table, the wire schema (`invoiceNumber`) and the CSV. UI label: "Bill no."                                                                                                                                                                                                                                                                                                                                                      |
| Type       | `text`, as printed (trimmed, NFC), 1 to 64 characters, null when none. Never a number: `SI-080/81-00123`, leading zeros and Devanagari digits are all real. Normalise only when comparing                                                                                                                                                                                                                                                              |
| Unique?    | **No.** OCR misreads; the same bill is photographed twice on purpose; `merchant` is OCR free text and not a key; a unique violation inside `complete` (`repository.ts:457-501`) would fail a scan after the model call was paid for; counter slips reuse small numbers daily. In Nepal the real key is seller PAN + fiscal year + number, and numbering restarts each fiscal year                                                                       |
| Duplicates | A check at completion that adds the reason `possible_duplicate` (and later `duplicate_of`): same workspace, same normalised number, and the same `seller_tax_id` when both have one, else the same total and currency, with dates within a year. It sharpens the fuzzy rule already planned in the [cost and accuracy plan](../plans/2026-11-06-extraction-cost-accuracy.md) (exact file hash first, then merchant, date and total)                     |
| Index      | Not with the column: nothing reads it yet. The partial index above ships with the duplicate probe and gets its `EXPLAIN` then. History's search adds `invoice_number` to its `ILIKE` list (`repository.ts:213`), which is already a filtered scan of one workspace                                                                                                                                                                                      |
| Editable   | Yes: `ReceiptPatch` (`repository.ts:112-121`), the PATCH route's `text(body.invoiceNumber, 64)`, one editor input, one Details field. The wide event already logs changed keys only (`route.ts:136`)                                                                                                                                                                                                                                                    |

## 2. Nepali dates

**Stored: `receipt_date` (AD, exists) + `receipt_date_calendar`. Derived: BS. Evidence: `raw_json.dates[]`.**

| Piece                     | Where it lives                                                                                           | Why                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The day                   | `receipts.receipt_date date` (`index.ts:86`), unchanged                                                  | One canonical value for sorting, the range index (`index.ts:120`), the dashboard and FX. The existing `CHECK` (2000-01-01 to upload day + 1, `index.ts:124-127`) already rejects a BS year stored as AD                                                                                                                         |
| The BS date               | **Not stored.** `receiptDateBs` is added where core maps rows (`toSummary`, `repository.ts:271-275`, and `get`) | BS is a function of AD. A copy can only be wrong: after an edit, after a table fix, or after a rollback to code that doesn't know the column. Postgres can't check it (no table there, and a second copy of the table in SQL is the thing to avoid). Every reader is TypeScript and gets both fields from one place             |
| What was printed          | `raw_json.dates[]` (text, label, calendar, role), the extraction review's wire schema                    | It is the model's verbatim output, which `raw_json` already is (`repository.ts:474`), edits never touch it (`ReceiptPatch` has no such key), there can be several dates, and nothing filters on it                                                                                                                              |
| Which calendar it came from | `receipts.receipt_date_calendar`: `ad`, `bs`, `both`, or null                                          | The one fact about a derived value worth a typed column. `bs` means the AD date was computed, so a table correction re-derives exactly those rows (`WHERE receipt_date_calendar = 'bs'`, no JSON scan); the UI can say "printed as 9 Shrawan 2080". Null = no date, an old row, or a person set the date (the job then skips it) |
| Ambiguity, conflict       | `review_reasons`: `date_ambiguous`, `date_conflict`, `date_implausible`                                  | Same mechanism as every other check ([section 3](#3-confidence))                                                                                                                                                                                                                                                                 |

This replaces the plan's `receipt_date_check` (seven values mixing provenance with review status). Mapping: `agree` →
`both`; `single` → `ad` or `bs`; `ambiguous` and `conflict` → the calendar plus a reason; `implausible` → null date
plus a reason; `none` → null date; `user` → null calendar, date reasons cleared. If the owner prefers to keep
`receipt_date_check`, it works; it just becomes the first of several `<field>_check` columns.

The owner's rule, restated against this model:

| Receipt prints | Stored                                                             | Returned and shown                             |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| AD only        | AD, calendar `ad`                                                  | AD and BS (derived)                            |
| BS only        | AD converted from it, calendar `bs`; today this is null (`prompt.ts:74`) | BS (equal to the printed one) and AD     |
| Both, agreeing | AD, calendar `both`                                                | Both                                           |
| Both, differing | AD per the conflict policy, calendar `both`, reason `date_conflict` | Both, with the printed pair in the checklist  |

**Table or library: vendor the table**, as the plan and the extraction review say. Checked again today on the npm
registry: `nepali-date-converter` is 3.4.2, published 2026-10-29 (past the 7-day cooldown), MIT, no dependencies,
542 KB unpacked. It would pass the dependency rules. It still loses: a fix to the current year's row would wait for
a release plus seven days, its projected years changed two weeks ago, and we need our own parser, range policy and
month names anyway. The data we need is about 30 rows of 12 numbers.

**Range and validation**

- The table needs only what the `CHECK` admits: from the BS year containing 2000-01-01 (2056) to the current BS year,
  plus the next one once it is official. No projected rows: a receipt can't be dated in the future
  (`index.ts:124-127`), so the class of "projection was wrong" errors doesn't exist for stored dates. The plan's
  canary test (fail when today + 120 days is past the table) keeps the new-year row from being forgotten.
- A BS date is valid when its year is in the table, the month is 1 to 12 and the day is 1 to that month's length
  (29 to 32). It is accepted when its AD equivalent passes the existing `CHECK`. So there is **no BS constraint in
  Postgres**; `parseReceiptDate` (`packages/core/src/receipt-fields.ts:34-37`) gains a BS branch and the bound stays
  where it is (`repository.ts:280-289`, `:676-697`).
- Under those bounds an AD year (2000 to today) and a BS year (2056 to today + 57) never overlap, so the year
  settles the calendar. Day/month order is the resolver's problem, not the schema's.

**UI and CSV**

- Display: `25 Jul 2023 · 9 Shrawan 2080` wherever `formatDate(receipt.receiptDate)` is used today
  (`receipt-result.tsx:367`, `history-results.tsx:39`, `receipt-list.tsx:35`), romanised months and Latin digits.
  Both by default when the time-zone cookie is `Asia/Kathmandu` or the receipt printed BS; AD only otherwise. A
  per-user override (`user.date_display`) waits until someone asks for it.
- Editor: keep the AD `<input type="date">` (`receipt-editor.tsx:144`) and add a BS text field beside it; typing in
  either fills the other, with the month-length error inline. PATCH still sends one AD `receiptDate`.
- CSV: `receipt_date` stays ISO AD. Add `receipt_date_bs` next to it as text in the dotted form `2080.04.09` (the
  form the IRD billing API uses, and one a spreadsheet won't turn into a Gregorian date in the year 2080), plus
  `invoice_number` and `seller_tax_id`. Insert them in logical order now, before launch; after launch, only append.
  No fiscal-year column: it is derivable from either date.

## 3. Confidence

What exists and what reads it:

| Value                                         | Written                                | Read by                                                                                                                                                                                                                |
| --------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `receipts.confidence` (`index.ts:94`)         | Model's own score, `repository.ts:473` | **The whole "Needs review" rule**: `NEEDS_REVIEW_BELOW = 0.9` (`repository.ts:161`) in the History filter (`:216-220`) and the Home count (`:641`). Badges (`receipt-status.tsx:58`), the page checklist, CSV (`csv.ts:60`) |
| `receipt_items.confidence` (`index.ts:145`)   | Model's own score, `repository.ts:495` | The "hard to read" mark on a line below 0.75 (`receipt-result.tsx:87`, `:353`, `:410`; `format.ts:112-118`), item CSV (`csv.ts:95`). Lines can't be edited (`receipt-editor.tsx:116`), so the mark can never be cleared |
| Per-field confidence                          | Doesn't exist                          |                                                                                                                                                                                                                        |
| Arithmetic and missing-field checks           | Not stored; computed in the component  | The receipt page only (`receipt-result.tsx:79-104`). Not the filter, not the count                                                                                                                                     |

The benchmark never scored confidence (`packages/bench/score.ts` has no mention of it). The extraction review
measured it today: the 0.9 rule flags 68% of Haiku receipts and 4% of Flash-Lite ones, and the per-line mark is
right on 9 of the 96 lines it marks. Those figures are theirs; the conclusion matches what the code shows: one
threshold constant in SQL can't mean the same thing for every model in the chain.

**Minimal, durable model**

1. **`confidence` stays**, as the model's raw signal and a CSV column. It is an input, no longer the rule.
2. **`review_reasons text[]`** holds the codes of the checks that fired. One pure function in core computes it at
   completion and again on every edit; the page renders its text from the same codes, which removes the two React
   copies. Initial codes: `low_confidence` (decided at write time with a per-model threshold, or not at all),
   `totals_mismatch`, `no_merchant`, `no_date`, `no_total`, `date_ambiguous`, `date_conflict`, `date_implausible`.
   Later: `possible_duplicate`, `line_mismatch`.
3. **Needs review = `status = 'completed' AND review_reasons <> '{}'`**, and with the review-state columns
   `AND reviewed_at IS NULL`. An edit recomputes the reasons, so correcting a receipt finally clears it.
4. **No per-field confidence numbers**, in columns or in the prompt. A self-reported number per field has the same
   calibration problem three more times. If one is ever tried, it lives in `raw_json` and the benchmark scores it
   before a column exists.
5. **Per-line confidence: keep the column, plan to stop filling it.** It is already nullable, so dropping the field
   from the prompt needs no migration; the per-line mark moves to `quantity × unit_price ≈ total_price`. The landing
   page and FAQ promise a score per line (`landing-page.tsx:47`, `content-sections.tsx:198`), so the copy changes in
   the same PR. Don't drop the column or the CSV header until an export consumer has had notice.

No `CHECK` on the array's values: a new code then needs no migration, and readers ignore codes they don't know,
which is also what lets old code run against new rows. Core is the only writer and types the codes as a union.

The arithmetic check needs two new amounts to be worth storing. Today the prompt puts service charge and discounts
"in no field" (`prompt.ts:63`) and the check is `subtotal-or-items + tax + tip` against `total`
(`receipt-result.tsx:66-76`), so every bill with a 10% service charge trips it. With the new columns the identity is
`subtotal − discount + service_charge + tax + tip ≈ total`, also accepted without `tax` for tax-inclusive prices.
`discount` and `service_charge` are stored as non-negative amounts; core takes the absolute value of a printed
`-50.00`. They are `numeric(12,2)` like their neighbours and widen with them in the
[FX plan](../plans/2026-11-06-currencies-fx.md).

## 4. Other fields

Against EN 16931 / Peppol BIS 3.0 (the invoice core most e-invoicing shares), Nepal's IRD billing fields and what
expense tools keep:

| Concept                          | EN 16931      | Nepal IRD                              | Today                              | Verdict                                                                                                                                                                                              |
| -------------------------------- | ------------- | -------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoice number                   | BT-1          | `invoice_number`                       | none                               | **Now**                                                                                                                                                                                              |
| Issue date                       | BT-2          | `invoice_date` (BS)                    | `receipt_date`                     | Exists; BS derived                                                                                                                                                                                   |
| Currency                         | BT-5          | NPR                                    | `currency`                         | Exists                                                                                                                                                                                               |
| Seller trading name              | BT-28         | Seller name                            | `merchant` (`schema.ts:12`)        | Exists                                                                                                                                                                                               |
| Seller VAT identifier            | BT-31         | `seller_pan`                           | none                               | **Now**, as `seller_tax_id`: PAN in Nepal (9 digits), GSTIN, VAT ID. The purchase register needs it, it is the reliable merchant key (the dashboard groups by lower-cased name, `spend.ts:160`) and the duplicate rule uses it |
| Document-level discount          | BT-107        | Discount line                          | none (`prompt.ts:63`)              | **Now**, with service charge                                                                                                                                                                         |
| Document-level charge            | BT-108        | Service charge                         | none                               | **Now**                                                                                                                                                                                              |
| Sum of lines, VAT, total         | BT-106/110/112 | `total_sales`, VAT                    | `subtotal`, `tax`, `total`         | Exist                                                                                                                                                                                                |
| Taxable amount                   | BT-109, BT-116 | Taxable and exempt sales              | none                               | Later, with a purchase-register export. For one VAT rate it is `subtotal − discount + service_charge`                                                                                                |
| VAT breakdown by rate            | BG-23         | n/a (one rate)                         | `tax` is the sum (`schema.ts:20`)  | Later, as a child table, only when a multi-rate user needs it                                                                                                                                        |
| Payment means                    | BT-81         | n/a                                    | none                               | Later: `payment_method`, when statements are reconciled or filtered                                                                                                                                  |
| Document type                    | BT-3          | Tax invoice, abbreviated, estimate     | none                               | Later: only a tax invoice supports a VAT credit                                                                                                                                                      |
| Time of sale                     | n/a           | n/a                                    | none                               | Later, with duplicate detection                                                                                                                                                                      |
| Quantity with decimals, unit     | BT-129, BT-130 | Quantity                              | `integer` (`index.ts:142`)         | Later: `numeric(12,3)` by expand and contract, backfilled from `raw_json`. Unit of measure: never                                                                                                    |
| Line order                       | BT-126        | Serial no.                             | none                               | **Now**: `receipt_items.position`                                                                                                                                                                    |
| Buyer name and VAT identifier    | BT-44, BT-48  | `buyer_name`, `buyer_pan`              | none                               | **Never per receipt.** The buyer is the workspace. If VAT-credit checking is built, the workspace's PAN is one setting and "bill doesn't carry our PAN" is one reason code. It is also the user's own tax id |
| Fiscal year                      | n/a           | `fiscal_year` (`2073.074`)             | none                               | **Never stored.** It is a range of `receipt_date` (Shrawan to Asar), computed with the same table, and differs by country                                                                            |
| Rounding                         | BT-114        | Round-off line                         | none                               | Never: a tolerance in the check                                                                                                                                                                      |
| Due date, paid and due amounts, PO, terms | BT-9, BT-113, BT-115, BT-13, BT-20 | n/a                    | none                               | Never: accounts-payable fields, not receipt fields                                                                                                                                                   |
| Seller address, phone, legal name | BG-5, BT-27, BT-30 | Address                          | none                               | Never as columns; nothing reads them                                                                                                                                                                 |
| Tip                              | n/a           | n/a                                    | `tip`                              | Exists                                                                                                                                                                                               |

A `merchants` table (one row per seller per workspace, keyed by tax id) is the natural home for rules and merchant
clean-up later. Not now: the two columns on the receipt are what was printed on that document and stay correct
either way.

## 5. Migration plan

**Safety, per the skill**

- Through the Database Migration workflow, staging then production, then deploy by hand (`docs/architecture/db.md`,
  "Add a migration"). `lock_timeout` first; `statement_timeout` raised for the backfills.
- Every `ADD COLUMN` is nullable or has a constant default: catalog-only in Postgres 17 and 18, no rewrite.
- Every `CHECK` is added `NOT VALID` and validated in the next file, before that file's own `ALTER`s.
- No foreign key, no index, no enum type, no RLS change (`.enableRLS()` is per table).
- The two `UPDATE`s run while the transaction holds `ACCESS EXCLUSIVE` from the `ADD COLUMN`s. Production held 9
  receipts on 2026-11-09 ([database review](2026-11-09-database-review.md)), so this is milliseconds. Past roughly
  100,000 receipts the same statements belong in a job kind, in batches, outside the migration.

**What the old code tolerates** (migrate first, deploy after)

| Change                                    | Running code                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New nullable columns on `receipts`        | Unaffected. The insert (`repository.ts:421-430`) and the completion (`:462-480`) name their columns, Drizzle selects by name, and the raw SQL readers name theirs (`analytics/spend.ts:155-164`, `jobs/admin.ts:94`) |
| `review_reasons NOT NULL DEFAULT '{}'`    | Old inserts get `{}`. Old code keeps filtering on `confidence`, which is untouched. A receipt the old code completes in the minutes between migrate and deploy keeps `{}`; the same idempotent `UPDATE` can ride in a later file, as long as it runs before phase M changes how reasons are written |
| `position NOT NULL DEFAULT 0`             | Old completions write 0 for every line of a receipt; the new read orders by `(position, id)`, so those few receipts keep today's undefined order                                                       |
| `CHECK`s                                  | Each constrains one new column, so code that never writes it can't fail one. That is why `receipt_date_calendar` is not tied to `receipt_date IS NOT NULL`                                             |
| Rollback after deploy                     | Old code ignores the columns. Edits it makes leave `review_reasons` and `receipt_date_calendar` as they were, which is stale but harmless, and the next edit on new code recomputes                    |
| Seeds and e2e                             | Raw inserts name their columns (`apps/web/e2e/helpers.ts:83`, `e2e/dashboard.spec.ts:26`, `scripts/manifest-screenshots.ts:144`)                                                                       |

**Backfill policy**

| Column                              | Old rows                                                                                                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoice_number`, `seller_tax_id`, `discount`, `service_charge` | Stay null. The model was never asked, so `raw_json` doesn't hold them, and a completed receipt can't be re-read (`claimRetry` takes failed or stale rows only, `repository.ts:538`; attempts are capped at 3). Null means "not read"; the editor fills it |
| `receipt_date_calendar`             | Stays null (unknown). BS-only receipts scanned so far have a null date and no printed text in `raw_json` (`prompt.ts:74`), so they can't be re-resolved either; they show "No date was found" and take a typed date                                            |
| `review_reasons`                    | `{low_confidence}` where today's rule fires, in the migration. A job kind can recompute the full set from row and items later; no model call                                                                                                                   |
| `position`                          | Current physical order, in the migration                                                                                                                                                                                                                       |

Both databases hold test data only (`docs/architecture/db.md`, "Migrations"). None of this depends on a reset.

## Phased plan

| Phase | Scope                                                                                                                                                                                                                                                                                                                                                                                                                             | Size      | Depends on                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------- |
| S     | Migration `0002`. `position` written and read (`ORDER BY position, id`). `invoice_number` and `seller_tax_id` end to end: wire schema, `complete`, `ReceiptPatch`, PATCH, editor, Details, CSV, History search. `complete` also writes `low_confidence` into `review_reasons` under today's rule, so M only switches the read. "Copy JSON" built from the row. `data-model.md` and an `*.int.test.ts` for order, the checks and the patch                                                                                                         | S (1-1.5 d) | The two wire fields wait for prompt v3 on the bench; the rest doesn't |
| M     | Dates and checks: vendored BS table and converter; resolver result into `receipt_date` + `receipt_date_calendar`; `receiptDateBs` on what core returns; both dates in the UI, editor and CSV. `discount` and `service_charge` written, edited and exported. One `reviewReasons()` in core replacing the two React copies; filter and count read `review_reasons`; `NEEDS_REVIEW_BELOW` becomes a per-model input. `EXPLAIN` on the seeded set | M (3-4 d) | S; extraction review's v3 |
| L     | Each its own PR and migration: review state (`0003`: `reviewed_at`, `reviewed_by`, the `VALIDATE`s); duplicate detection (index, `duplicate_of`, reason); decimal quantity; `payment_method`, `document_type`, `receipt_time`; Nepal purchase-register export with BS-month and fiscal-year presets and the workspace PAN; per-line confidence removed from the prompt; amount widening with FX                                  | L         | Owner priorities          |

## Open questions for the owner

1. **BS not stored** (derived wherever it is shown or exported). This is the plan's question 1 again. The only case
   for a `receipt_date_bs` column is a reader that can't run our converter, such as raw SQL in a BI tool. None exists.
2. **`receipt_date_calendar` + `review_reasons`** in place of the plan's `receipt_date_check`. Agree?
3. **When AD and Miti disagree**, which one wins? The plan says AD. For a Nepali VAT bill the Miti is the date the
   books use, so "BS wins when the currency is NPR" is worth a thought.
4. **Per-line confidence**: fine to change the landing-page claim when it stops being a model score?
5. **CSV column order**: insert the new columns beside their neighbours now (before launch), append-only afterwards?

## Not verified

- No SQL here was executed and no plan was measured. `ORDER BY ctid` inside a window function and `VALIDATE` ahead of
  `ADD COLUMN` in one transaction are standard Postgres but should be seen passing on 17 and 18 in CI.
- That finding 1 has shown up in practice. The order is undefined by contract; whether any receipt has come back out
  of order was not tested.
- EN 16931 term numbers: BT-9, BT-29 to BT-32 and BT-115 were read on the
  [Peppol BIS 3.0 syntax page](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/tree/) today; the others
  are from memory of the standard.
- The IRD billing API field list (`seller_pan`, `buyer_pan`, `fiscal_year`, `buyer_name`, `invoice_number`,
  `invoice_date`, `total_sales`) comes from a search summary of an
  [IRD PDF](https://ird.gov.np/public/pdf/976029276.pdf) that returned 404 to a direct fetch, and from the
  [forum sample](https://discuss.frappe.io/t/central-billing-monitoring-system-api-documentation-for-nepal/34814)
  the plan already cites.
- The purchase register's columns (date, bill number, supplier name, supplier PAN, total, exempt, taxable, VAT) rest
  on Tally's help pages and secondary guides, not on Schedule 8 of the VAT Rules, which was not found. Whether a
  buyer PAN is mandatory on a tax invoice is disputed between sources.
- The confidence figures in section 3 are the extraction review's and were not re-measured.
- 2000-01-01 falling in BS 2056, and how Excel and Google Sheets import `2080.04.09`.
- `nepali-date-converter`'s version, date, licence and size are from the registry metadata today; its tarball was
  not opened.
