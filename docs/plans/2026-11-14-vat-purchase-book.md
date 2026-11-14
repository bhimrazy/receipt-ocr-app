# Nepal VAT purchase book (खरिद खाता) export: plan (2026-11-14)

Status: proposal. Nothing is implemented. Code facts are from `main` at `a7f0418`. Web sources were opened on
2026-11-14 and are listed in [Sources](#sources). What could not be confirmed is in [Not verified](#not-verified).
This plan builds on the [product review](../reviews/2026-11-14-receipt-data-product.md) (VAT register, decisions 12
and 13), the [data review](../reviews/2026-11-14-receipt-data-review.md) (D7, D8, `taxable_amount`) and the
2026-11-14 rows in [decisions.md](../decisions.md). It is last in the owner's build order (after receipt status and
duplicates, and after line editing).

## TL;DR

- **Layout.** We follow IRD's FY 2078/79 purchase-book form: 14 columns, read from IRD's notice. Later amendments may
  have dropped the goods and quantity columns. A secondary lead says they did, but the current Schedule 8 text could
  not be opened. So the layout lives in one table in code, and those two columns can be dropped without touching
  anything else.
- **No new date dependency.** `@receipt-ocr/calendar` already has the BS table, `adToBs`, `bsToAd` and
  `fiscalYearRange`. A BS month or fiscal year is an AD range on `receipt_date`, as the 2026-11-12 research settled.
- **Three schema additions, in two or three migrations, numbered at merge.**
  - `receipts.taxable_amount`;
  - a `workspace_settings` table holding the workspace PAN;
  - an export log (`vat_exports` plus `vat_export_rows`) for "added or changed since last export".
- **Which receipts go in.** By default: Reviewed, NPR, dated in the period, and not flagged as a possible duplicate.
  The screen shows what was left out, with counts, and each group has its own "Include" switch.
- **CSV with a UTF-8 BOM, no xlsx in v1.** Microsoft says a UTF-8 CSV opens correctly in Excel only when it has a
  BOM. Devanagari headings make that mandatory. Whether to add xlsx later depends on IRD's upload template.
- **Six small PRs**, the last of them optional. The owner decided all eight questions on 2026-11-14.

## 1. The official purchase-book columns

### What the rules say

- **The duty to keep the book.** Rule 23(1) of the VAT Rules 2053 requires a registered person to keep "Books of
  purchase and Sales as mentioned in Schedule-8 and Schedule-9". It is clause (g) in the English translation
  amended to 2072, and clause (छ) in the Nepali text the IRD notice cites.
- **Who certifies it.** Since FY 2078/79 the taxpayer certifies the book itself, for each tax period (Act section
  16(3); Rules rule 25 as amended by the 23rd amendment). A tax officer no longer does.

### Confirmed from an official source

The source is IRD's notice "मूल्य अभिवृद्धि करको खरिद बिक्री खाता सम्बन्धी जरुरी सूचना" ("Urgent notice on VAT
purchase and sales books"). It is issued by the Inland Revenue Department, Ministry of Finance, and applies from FY
2078/79. We read it as an image of the notice published by collegenp.com on 2021-07-13 (opened 2026-11-14).
ird.gov.np itself refused connections from our network that day. The notice is official; our copy of it is a mirror.

**Header fields:**

- करदाताको नाम (taxpayer name);
- करदाता दर्ता नं. (registration number, printed as nine boxes: the 9-digit PAN);
- कर अवधि: महिना … साल … (tax period: month and year).

| #   | Heading (as printed)                                | English                              | Our source                              |
| --- | --------------------------------------------------- | ------------------------------------ | --------------------------------------- |
| 1   | मिति                                                | Date                                 | `receipt_date` as BS, `2083.07.28` (D8) |
| 2   | बीजक/प्रज्ञापन पत्र नम्बर                           | Invoice or customs declaration no.   | `invoice_number`                        |
| 3   | आपूर्तिकर्ताको नाम                                  | Supplier name                        | `merchant`                              |
| 4   | आपूर्तिकर्ताको स्थायी लेखा नम्बर                    | Supplier PAN                         | `merchant_tax_id`                       |
| 5   | खरिद/पैठारी गरिएका वस्तु वा सेवाको विवरण            | Goods or services purchased/imported | Derived from items (§3.3)               |
| 6   | खरिद/पैठारी गरिएका वस्तुको परिमाण                   | Quantity                             | Derived from items (§3.3)               |
| 7   | जम्मा खरिद मूल्य (रू.)                              | Total purchase                       | `total`                                 |
| 8   | कर छुट हुने वस्तु वा सेवाको खरिद/पैठारी मूल्य (रू.) | Exempt purchases/imports             | Derived (§3.1)                          |
| 9   | करयोग्य खरिद (पूँजीगत बाहेक): मूल्य (रू.)           | Taxable purchase, non-capital: value | `taxable_amount` (§3.1)                 |
| 10  | करयोग्य खरिद (पूँजीगत बाहेक): कर (रू.)              | Taxable purchase, non-capital: VAT   | `tax`                                   |
| 11  | करयोग्य पैठारी (पूँजीगत बाहेक): मूल्य (रू.)         | Taxable import, non-capital: value   | Empty in v1 (§3.2)                      |
| 12  | करयोग्य पैठारी (पूँजीगत बाहेक): कर (रू.)            | Taxable import, non-capital: VAT     | Empty in v1                             |
| 13  | पूँजीगत करयोग्य खरिद/पैठारी: मूल्य (रू.)            | Capital purchase/import: value       | Empty in v1 (Q3)                        |
| 14  | पूँजीगत करयोग्य खरिद/पैठारी: कर (रू.)               | Capital purchase/import: VAT         | Empty in v1 (Q3)                        |

- **Totals.** The form closes with a कुल जम्मा (grand total) row.
- **Footer note.** A taxpayer who doesn't issue electronic invoices may enter a bill as a single lump sum in two
  cases: when one bill has more than two goods of different price and kind, and when the seller is a retailer.
  Translated from "एकमुष्ठ रूपमा बिलको रकम प्रविष्टि गर्न सकिनेछ" ("the bill's amount may be entered as a lump
  sum").

### The older form, for comparison

An unofficial English translation of the Rules, amended to 2072, has an "Annexure – 8, Purchase Book" with fewer
columns:

- date, bill no., supplier's name, supplier's PAN;
- total purchase amount;
- "Tax Discount" (exempt) purchase amount;
- taxable purchase (amount, tax) and taxable import (amount, tax).

The 2078/79 form adds three things: the customs declaration number, goods and quantity, and the capital split.

### Not confirmed

- **Later amendments.** IRD lists "VAT Rules 2053 (with the 27th amendment)", dated 18 Poush 2082. We could not open
  it: ird.gov.np and lawcommission.gov.np refused connections, and the copies we found are PDFs we did not process.
- **A secondary lead** (a developer's research note, unconfirmed) says three things:
  - the 25th amendment (2080) removed the goods-name and quantity columns from Schedule 9, the sales book;
  - the 26th amendment (2081) renamed निकासी to निर्यात;
  - Schedule 9 was later taken out of the Rules, and the sales book became "as the Department prescribes".

  Nothing we found says whether Schedule 8 changed the same way.

- **IRD's Excel upload template.** We have not seen it. A 2021 Clickmandu article on the new form says three things
  about it:
  - quantity and unit go in separate cells, or the upload fails;
  - a bill with many items is entered as "विविध सामान" (miscellaneous goods);
  - no totals row is entered.

  That suggests the upload sheet differs from the printed form: it has a unit column and no कुल जम्मा.

**Design consequence.** The layout is a constant: an ordered list of `{ key, heading, value(row) }`. Dropping columns
5 and 6, or adding a unit column, is a one-line change plus its test. Owner to-do T1 checks the layout against the
official texts before launch.

## 2. BS months and fiscal-year filters

- **The calendar is already ours.** `packages/calendar` has the BS month table (2056–2090, official through 2083),
  `adToBs`, `bsToAd`, `bsDotted` (the `2083.07.28` form IRD's billing API takes) and `fiscalYearRange(startYear)`
  (1 Shrawan to the end of Asar). The [dual-calendar plan](2026-11-07-dual-calendar-dates.md) vendored the table on
  purpose:
  - nine libraries disagreed on some years;
  - three years were corrected after release;
  - a vendored table adds no supply-chain risk.

  A library would have to earn its place against about 1.5 KB of tested data. No library is added. That also takes
  the exact-pin and 7-day cooldown rules out of play.

- **To add:** `bsMonthRange(year, month)` returns `{ from, to }` in AD, and `fiscalYearMonths(startYear)` returns the
  12 months, Shrawan to Asar, as BS year and month pairs. Both are pure functions with unit tests at month and year
  edges. The tests check that 1 Shrawan 2083 is 2026-07-17 and that the end of Asar 2083 is 2026-07-16, against
  the table.
- **Filter semantics.** A period is an AD range on `(organization_id, receipt_date)`, served by
  `receipts_org_receipt_date_idx`. URL parameters stay ISO; the BS label is only for display. The tax period on the
  export is a BS month. The fiscal year is a convenience range: it exports 12 months in one file, sorted by date.
- **Projected years.** FY 2083/84 ends on the last day of Asar 2084, and the table's 2084 row is a projection. Months
  past `BS_OFFICIAL_THROUGH` are allowed, with a warning on screen: "Nepal's calendar for 2084 isn't official yet;
  dates near month ends may move". The yearly table update (in [dates](../architecture/dates.md)) is owner to-do T3.
- **Where the presets show.** On the VAT export page always, since the page only makes sense for Nepal. On the
  receipts list, presets keep their current rule (`Asia/Kathmandu` time zone) until a workspace calendar setting
  exists (§3.4).

## 3. Amounts, imports and the workspace PAN

### 3.1 Taxable and exempt amounts

- **New column `receipts.taxable_amount numeric(12,2)`.** Nullable, with `CHECK (taxable_amount >= 0)` added
  `NOT VALID`. It holds the printed amount, as D7 decided. It is editable in the receipt editor and read by
  extraction prompt v4: D6 approves that paid bench run, after a dry run. Appended to the general CSV.
- **Fallback when nothing is printed**, for NPR only, at the single 13% rate:
  - If `tax > 0`: taxable = `round(tax / 0.13, 2)`. It is accepted only when it agrees with
    `subtotal − discount + service_charge` within the totals check's rounding slack (`review-reasons.ts:69`). The
    row is marked `derived` in the reference columns.
  - If they disagree: column 9 is left empty and the receipt is listed under "Needs a look", with a new reason
    `vat_split_unknown`.
- **Exempt (column 8)** = `total − taxable − tax`:
  - within the slack, it is 0;
  - when negative beyond the slack, the column is left empty and the row is flagged.

  Service charge is treated as part of the taxable value. That is common practice on Nepali bills, but not checked
  against the Act (see Not verified).

- **No VAT on the bill** (`tax` null or 0): the whole total goes in column 8. The supplier is then either not VAT
  registered or sells only exempt goods. Whether purchases from non-VAT suppliers belong in the book at all is Q4.

### 3.2 Imports

Imports are documented by a customs declaration (प्रज्ञापन पत्र), not a shop receipt, and our users photograph
receipts. Columns 11 and 12 stay empty in v1, and so does the customs-declaration half of column 2. An "Import"
document type comes later, if a customer asks; it would be a review reason first, as the product review said for
document types.

### 3.3 Goods and quantity (columns 5 and 6)

Following the footer note's lump-sum rule:

- **One line item:** its name, and its quantity when the quantity is a plain number.
- **Otherwise:** "विविध सामान" (miscellaneous goods), with the quantity left empty.

Decimal quantities depend on the line-editing track (`quantity_exact`). Before it ships, use the integer `quantity`
or leave the cell empty. Both columns sit behind the layout table, so they can be dropped (§1).

### 3.4 Workspace PAN

- **Where it lives:** a new table `workspace_settings`.
  - Columns:
    - `organization_id text` primary key, references `organization` with on delete cascade;
    - `pan text` with `CHECK (pan ~ '^[0-9]{9}$')`;
    - `updated_at`, and `updated_by` (set null).
  - RLS enabled, like every table.
  - Not `organization.metadata`: that is unvalidated text that Better Auth owns and rewrites. A table gives us a
    CHECK and a place for the later settings the research already names: the workspace calendar (AD, BS or both) and
    the home currency.
- **Validation.** Strip spaces and dashes and turn Devanagari digits into ASCII digits (`asciiDigits`). Then require
  exactly 9 digits. No checksum: we found no published PAN check digit.
  - The error reads: "A PAN has 9 digits."
  - The example in the field is `123456789`, obviously fake.
- **Who can change it:** owners and admins. Members see it read-only. Telemetry records `pan_set: true`, never the
  value. A PAN can identify a sole proprietor, so it counts as personal data. It goes in the PR's field audit and on
  the [data protection](../architecture/security/data-protection.md) page.
- **UI:** Settings → Workspace → "PAN (for the VAT purchase book)".
  - Optional, and asked for only by the export page: "Add your PAN to fill the header".
  - The header's taxpayer name is the workspace name, editable in the export dialog. It is not stored.
- **"Bill doesn't show your PAN."** The product review proposed this reason. It needs the model to read the buyer
  PAN off the bill, and 2026-11-14 decided "no buyer PAN columns". The reason waits for Q5.

## 4. Which receipts go in

**Default rule.** A receipt goes in when it is:

- `status = 'completed'`;
- `currency = 'NPR'`;
- dated in the period;
- `reviewed_at IS NOT NULL`;
- not carrying an open `possible_duplicate`.

This is decision 12. The rule is one core function, so the screen count and the file always agree.

**Left out, always counted on screen, never dropped silently:**

| Group                             | Shown as                                     | Override                                                                                                                                               |
| --------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Not reviewed (incl. Needs review) | "7 reviewed, 2 not reviewed left out"        | "Include not reviewed" switch; the rows are marked `not_reviewed` in the reference columns                                                             |
| Possible duplicates               | "1 possible duplicate left out"              | Resolve it on the receipt ("Not a duplicate" or delete one copy). A separate "Include possible duplicates" switch, off by default, also marks the rows |
| Undated                           | "3 receipts have no date"                    | None: set a date. Links to the filtered list                                                                                                           |
| Not NPR                           | "2 receipts in other currencies"             | None in v1                                                                                                                                             |
| Amounts that don't split          | Listed under "Needs a look" but **included** | Fix `taxable_amount` on the receipt                                                                                                                    |

- **Duplicate state comes from #278.** What counts as "resolved" (the duplicate mark dismissed, or the receipt
  marked reviewed) is whatever #278 ships. This plan reads it through one helper and does not redefine it.
- **Switches are not remembered.** They reset every time the page opens, so the default stays the safe one.

## 5. "Added since last export"

`created_at > last export time` alone is wrong. A receipt uploaded earlier but reviewed after the export would be
missed, and an amount edited after the export would go unnoticed. What has to be recorded is what each export
contained.

- **`vat_exports`:**
  - `id`, `organization_id` (cascade);
  - `period_from` and `period_to` (AD dates), plus `period_label` (`2083-07`, or `FY 2083/84`);
  - `exported_at`, `exported_by` (set null), `row_count`;
  - the switches used (`include_unreviewed`, `include_duplicates`);
  - `layout_version`.
- **`vat_export_rows`:**
  - `export_id` (cascade), `receipt_id`;
  - `row_hash`: a SHA-256 of the exported column values.

  `receipt_id` has no foreign key, so a deleted receipt can still be shown as "removed since last export".

- **Marking.** The latest previous export overlapping the same period is the baseline. Each row gets a
  `since_last_export` value: `new`, `changed` or empty. Rows in the baseline but no longer in the export are listed
  on screen as removed. The first export of a period has no marks.
- **A filed period changed.** When a receipt dated in an exported period is added, edited or removed later, the
  export page shows: "Kartik 2083 changed since you exported it on 2083.08.05".
- **Size.** About 200 rows a month per busy workspace. At 5,000 rows (`MAX_EXPORT_ROWS`) per export, that is still
  small.
- **Retention** follows the receipts: rows live until the workspace is deleted. The export log is
  workspace-visible metadata, not an admin audit entry.
- **Optional, and last.** Exports are useful without the log, so this is PR 6.

## 6. CSV vs xlsx, and the BOM

**What's true:**

- **Excel on Windows.** Microsoft: "You can open a CSV file encoded with UTF-8 normally if it was saved with BOM
  (Byte Order Mark)". Without one, Excel reads the file in the system's legacy code page, which garbles Devanagari.
  The workaround is Data → From Text/CSV with File origin "65001: Unicode (UTF-8)". An accountant can't be expected
  to do that.
- **Excel for Mac.** Microsoft's page names no platform, and secondary sources report the same behaviour on the Mac
  (no BOM means a legacy encoding). We have not tested it; see T2.
- **Other tools.** Google Sheets and LibreOffice detect UTF-8 either way. Most CSV parsers handle a BOM, but a naive
  one sees `﻿` glued to the first heading.

**Decision proposed:**

- **The VAT export is a CSV with a BOM, always.** Its headings are Devanagari, and without the BOM they break in the
  most common tool.
- **Two header rows?** The printed form has two-level headings, as in columns 9 to 14. The CSV flattens them to one
  row: "करयोग्य खरिद (पूँजीगत बाहेक) मूल्य (रू.)". Importers want one header row.
- **Header block?** No taxpayer, PAN or period rows above the table, so the file stays importable. That information
  goes in the file name and on screen: `kharid-khata-2083-07-123456789.csv` (fake PAN).
- **No कुल जम्मा row in the CSV.** Totals are shown on screen. The upload template appears to forbid a totals row
  (Clickmandu, §1).
- **Two layouts behind one switch:**
  - "IRD columns only", the default: exactly the 14 columns.
  - "With reference columns": the 14 columns plus `receipt_id`, `receipt_date` (AD), `review_status`,
    `since_last_export`, `amounts` (`printed` or `derived`) and `link`.
- **Unchanged:** the CSV injection guard and RFC 4180 quoting (`apps/web/lib/csv.ts`).
- **No xlsx in v1.** Make an xlsx only if IRD's upload template turns out to need one (T1). Writing it needs a zip
  writer: either a dependency, vetted under the AGENTS.md rules (exact pin, 7-day cooldown, publisher check), or
  about 150 lines over `node:zlib`. Decide then.
- **The general CSV keeps no BOM for now.** Its headers are ASCII, and adding a BOM changes the first heading for
  every existing importer. Q6.

## 7. Schema and migrations

| Migration (number at merge) | Change                                                                                                              | Lock and rollout notes                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| A: `workspace_settings`     | New table, RLS, CHECK on `pan`                                                                                      | New table: no lock on existing ones           |
| B: `receipt_taxable_amount` | `ADD COLUMN taxable_amount numeric(12,2)`, `CHECK (taxable_amount >= 0) NOT VALID`; `VALIDATE` in a later migration | `lock_timeout` first; nullable, so no rewrite |
| C: `vat_exports`            | `vat_exports`, `vat_export_rows` (PK `(export_id, receipt_id)`), index `(organization_id, period_from)`, RLS        | New tables                                    |

- **Order with other tracks.** `main` has `0009`, and `0010` is #275's (Data API grants). The storage-cap track adds
  `receipts.file_bytes` and drops `user_credentials`. Line editing adds `quantity_exact`, and later contracts
  `quantity`. All are numbered only when generated just before merge, and regenerated on rebase so the snapshot
  `prevId` chain stays linear and the journal `when` keeps increasing (drizzle silently skips an older `when`).
  Since this track is last in the build order, A to C will very likely follow both of those tracks.
- **One migration or three?** A and B could share one, as both are additive. They stay separate so each PR is
  reviewable and reversible on its own.
- **Architecture docs, same PRs:** [data model](../architecture/data-model.md) and [db](../architecture/db.md) get
  the new tables and column, [dates](../architecture/dates.md) gets the month helpers, and a new flow page,
  `flows/vat-export.md`, comes in PR 4.

## 8. PR split

Each PR is small, ordered, and has its own tests and gates.

| PR  | Scope                                                                                                                                                                                                                                                             | Migration | Depends on        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------- |
| 1   | Calendar: `bsMonthRange`, `fiscalYearMonths`, unit tests at edges; month and FY presets helper in core                                                                                                                                                            | none      | none              |
| 2   | Workspace PAN: `workspace_settings`, core service (get, set with validation, owner/admin only), Settings → Workspace field, telemetry field audit, data-protection page                                                                                           | A         | none              |
| 3   | `taxable_amount`: column, PATCH and zod, editor field, general CSV appended column, `vat_split_unknown` reason. Prompt v4 extraction is separate: the D6 paid bench run, after a `--dry-run`                                                                      | B         | none              |
| 4   | Core `vatPurchaseBook(scope, period, switches)` (selection, counts, row mapping, layout table); CSV writer with BOM; thin route `GET /api/receipts/vat-purchase-book`; unit and int tests (period edges, exclusions, derived amounts, CSV bytes start `EF BB BF`) | none      | 1, 3; #278 merged |
| 5   | UI: Receipts → Export → "VAT purchase book (Nepal)" page. Period picker (BS month, FY), counts and switches, a preview of the first rows, download. Screenshots at 390 px in light and dark, and at 1440 px; `preview` label                                      | none      | 2, 4              |
| 6   | Export log: `vat_exports` and rows, `since_last_export` marks, "changed since you exported it" notice                                                                                                                                                             | C         | 5                 |

Later, each only on demand: a capital-purchase flag (Q3), import documents, xlsx, the buyer-PAN reason (Q5), the
workspace calendar setting, and "Pro only" gating (Q7).

## Owner decisions (2026-11-14)

| #   | Question                                                                      | Decision                                                                                              |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Q1  | Base v1 on the 2078/79 14-column form while later amendments are unconfirmed? | Yes. The layout is one table in code so columns 5 and 6 can be dropped; T1 confirms before launch     |
| Q2  | Default file: IRD columns only, with reference columns as an option?          | Yes. A separate "VAT purchase book (Nepal)" export; reference columns behind a switch, off by default |
| Q3  | Capital purchases (columns 13–14): a per-receipt "capital purchase" flag?     | Not in v1; everything goes in 9–10                                                                    |
| Q4  | Bills with no VAT: include them, all in the exempt column?                    | Yes, all in column 8, marked in the reference columns. An accountant confirms                         |
| Q5  | Read a yes/no "bill shows your PAN" to warn when it's missing?                | Later. The "no buyer PAN" decision stands for v1                                                      |
| Q6  | BOM on the general receipts CSV too?                                          | Not yet; only the IRD file gets one, until T2 shows Excel garbling the general CSV                    |
| Q7  | Free and Pro, or Pro only?                                                    | Free and Pro                                                                                          |
| Q8  | Fiscal-year export: one file or 12?                                           | One file sorted by date                                                                               |

## Owner to-dos

- **T1.** Check the current Schedule 8 (27th amendment) and IRD's Excel upload template against the official texts.
  Confirm whether columns 5 and 6 still exist, whether a unit column exists, and whether a totals row is allowed. An
  accountant or the local IRO can answer this.
- **T2.** Open a test export with a Devanagari merchant name (test data) in Excel on Windows and on the Mac, with and
  without the BOM.
- **T3.** Update the BS table when the 2084 calendar is official, before the end of FY 2083/84.

## Sources

All opened 2026-11-14.

- **IRD notice** "मूल्य अभिवृद्धि करको खरिद बिक्री खाता सम्बन्धी जरुरी सूचना" (FY 2078/79 forms), image published on
  collegenp.com, 2021-07-13:
  [notice image](<https://www.collegenp.com/uploads/2021/07/Inland-Revenue-Department-(IRD)-Published-VAT-Purchase-and-Sales-Book-New-Format.png>),
  [article](https://www.collegenp.com/news/inland-revenue-department-ird-published-vat-purchase-and-sales-book-new-format).
  **Official text, mirrored.**
- **Value Added Tax Rules, 2053 (1996), amendment up to 2072**, unofficial English translation hosted by NIDS:
  [PDF](https://www.nids.org.np/wp-content/uploads/2019/11/VATRule6232016111129AM.pdf). Rule 23(1)(g); Annexure 8,
  "Purchase Book".
- **IRD's list of VAT Rules texts**, naming the 27th-amendment edition dated 18 Poush 2082:
  [ird.gov.np](https://ird.gov.np/category/valueaddedtaxrules/). Seen in search results; the site refused
  connections, so the text was not read.
- **Clickmandu, 25 Bhadau 2078**, on filling and uploading the new books:
  [article](https://clickmandu.com/2021/09/167748.html).
- **Bizmandu, 2078 Shrawan 32 (16 Aug 2021)**, on the 14-column sample:
  [article](https://bizmandu.com/content/20210816104824.html).
- **Microsoft Support**, "Opening CSV UTF-8 files correctly in Excel" (undated page):
  [support.microsoft.com](https://support.microsoft.com/en-us/office/opening-csv-utf-8-files-correctly-in-excel-8a935af5-3416-4edd-ba7e-3dfd2bc4a032).
- **In-repo:** the [dual-calendar plan](2026-11-07-dual-calendar-dates.md) (why the BS table is vendored) and the
  [dates and fields research](../reviews/2026-11-12-dates-and-fields-research.md) (BS filters as AD ranges, IRD's
  dotted date).

## Not verified

- **The current Schedule 8.** We have not read it after the 23rd amendment, nor whether the 25th to 27th amendments
  or the Finance Act 2083 changed it. The goods and quantity removal comes from a secondary lead, and only for the
  sales book.
- **IRD's Excel upload template:** its columns, a unit column, and whether a totals row is allowed.
- **Excel for Mac without a BOM:** untested.
- **Service charge** as part of the taxable value, and the treatment of purchases from non-VAT suppliers in the book.
- **A PAN check digit:** none found. We validate 9 digits only.
- **The one-year limit** on claiming input VAT. It is from the product review and is still unchecked; it doesn't
  change this plan.
