# Dates and receipt fields: research and decisions (2026-11-12)

Read-only research on `main` at `297c628`. It answers four open owner questions with outside evidence and closes the
column design left open by today's [receipt fields review](2026-11-12-receipt-fields-review.md) and
[extraction review](2026-11-12-extraction-review.md) (both on PR #215), on top of the
[dual-calendar plan](../plans/2026-11-07-dual-calendar-dates.md). It follows the
[database skill](../../.claude/skills/database/SKILL.md). No database was touched and no SQL here was run. Every
outside source was opened on 2026-11-12 unless marked otherwise; what could not be confirmed is in
[Not verified](#not-verified).

Owner decisions taken as given: the model copies dates as printed and code resolves BS vs AD with bounds from each
receipt's upload day; on an NPR bill where AD and Miti disagree, BS wins and the receipt is flagged; add bill number,
seller PAN/VAT, discount, service charge and line order; "Needs review" comes from deterministic checks.

## Verdict

- **Storage: one canonical Gregorian `date` plus a calendar tag; the printed text stays in `raw_json`.**
  `receipts.receipt_date` (exists) is the only stored date. One new column, `receipt_date_calendar`, records the
  calendar the receipt printed. Not two date columns, not a composite type, not JSON. Every system we checked does
  this: ZATCA, Java, Temporal and RFC 9557, Django's Jalali field, and Nepal's own compliant software.
- **Display: the receipt's printed calendar decides, with no setting.** A receipt that printed BS shows
  `9 Shrawan 2080 · 25 Jul 2023`; every other receipt shows `25 Jul 2023` and nothing else. A foreign user never sees
  BS unless a receipt they uploaded printed it.
- **Preference: not now. When it comes, one per workspace, not per user**, and it only adds BS (to receipts that
  printed AD, to month presets, dashboard buckets and the CSV). It arrives with the Nepal purchase-register export.
- **Sorting and filtering use `receipt_date` only.** A BS month or fiscal year is an AD range computed in code. CSV
  carries `receipt_date` (ISO, always) and `receipt_date_bs` (text, when BS was printed).
- **Fields: four are required for a receipt to be usable without review: merchant, date, total, currency.** Every
  extractor we compared returns them, and they are what Expensify and Ramp depend on. Required means "missing adds a
  review reason", never `NOT NULL`.
- **Seven columns in one additive migration, `0003`:** `receipt_date_calendar`, `invoice_number`, `merchant_tax_id`,
  `discount`, `service_charge`, `review_reasons`, and `receipt_items.position`. Everything else stays in `raw_json`
  until a feature filters, sorts, edits or exports it.
- **Names: no existing column is worth a rename.** One proposed name changes before it ships: `seller_tax_id` becomes
  `merchant_tax_id`, so the table uses one word for the party.

## 1. Storing a date printed in another calendar

### What real systems do

| System                                    | What it stores or sends                                                                                                                                                                                                                         | Source                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Saudi ZATCA e-invoice (Hijri country)     | Gregorian only. Rule BR-KSA-F-01 rejects dates "not in accordance with ISO 8601:2004, format YYYY-MM-DD (Gregorian calendar)", enforced from 22 June 2025                                                                                      | ZATCA developer forum announcement, 5 May 2025                                                           |
| Java `java.time`                          | "Long term persistence, such as a database, will almost always only accept dates in the ISO-8601 calendar system." Recommended design: ISO `LocalDate` everywhere, the calendar "in the user profile", conversion "confine[d] to the UI layer" | `ChronoLocalDate` API docs, Java 21                                                                      |
| RFC 9557 (and Temporal)                   | The date is always the ISO date. The calendar is a suffix, `[u-ca=hebrew]`, "the calendar in which the date/time is preferably presented". A reader may ignore it and still have the right day                                                  | RFC 9557 §4.2, §5                                                                                        |
| Temporal cookbook, Nepali calendar        | Its `NepaliPlainDate` holds an ISO `Temporal.PlainDate` and computes BS year, month and day from a month-length table on demand. "Support for the Nepali calendar is currently not built in to JS environments"                                 | TC39 Temporal docs                                                                                       |
| PostgreSQL                                | `date`: 4 bytes, "counted according to the Gregorian calendar". No other calendar exists in core; Jalali and Hijri support are extensions, which we can't use                                                                                   | PostgreSQL docs, Date/Time Types                                                                         |
| Django `django-jalali` (Persian)          | `jDateField` is a Django `DateField`; `get_prep_value` calls `togregorian()` before writing and `fromgregorian()` on read. Gregorian in the database, Jalali in Python                                                                          | Source, `django_jalali/db/models.py`                                                                     |
| Iran Moadian e-invoice                    | `indatim` (invoice time) is a Unix timestamp in milliseconds; a client library builds it from a Gregorian date with no Jalali step                                                                                                              | Third-party client `Jooyeshgar/moadian` (search summary; the official spec was not opened)               |
| SAP (Hijri)                               | The user profile picks "Islamic Date 1/2" as a date format; table `TISLCAL` maps each Islamic month start to a Gregorian date and an administrator can edit it. KBA 1690275: the Gregorian-to-Hijri conversion "is a day out"                  | SAP Help and KBA titles (search summary). That `DATS` fields hold Gregorian is our reading, not a quote  |
| Nepal IRD CBMS (the tax office's API)     | Takes `invoice_date` as a BS string, `"2074.07.06"`, and `fiscal_year` as `"2073.074"`. Approved software "should" show both "Nepali Miti (date) and English date"                                                                             | IRD sample code and a vendor's approval list, both on the Frappe forum (2018, 2022)                      |
| ERPNext `nepal-compliance` (Yarsa, GPL-3) | Keeps ERPNext's Gregorian `posting_date` and adds `nepali_date` as a text (`Data`) field beside it on a dozen or more doctypes. Client scripts copy one into the other on every change, and the repo ships a `bulk_update_nepali_date.js`              | Source, `nepal_compliance/custom_field.py`, `public/js/sales_invoice.js`                                 |
| Odoo Nepal modules                        | Date fields stay Odoo dates; `nepali_date` is "Nepali (BS) and AD date picker on all date fields" plus a converter class. The CBMS module converts the Gregorian invoice date to BS when it submits                                             | Odoo Apps listings (search summary; the listings don't state the column type)                            |
| ICU / CLDR / `Intl`                       | 16 calendars, including `buddhist`, `persian`, `islamic-umalqura`, `ethiopic`, `indian` (Saka). No Bikram Sambat. An ICU4X maintainer in 2023: "Nepal uses the Vikram Samvat calendar as an official calendar; this is a problem we will have to deal with eventually" | MDN `Intl.supportedValuesOf`; `tc39/proposal-intl-era-monthcode` issue 18 |

Two things stand out. Nobody stores a non-Gregorian date as the primary value, including the tax authority of a
country whose calendar is Hijri. And the one system that stores both (ERPNext Nepal) pays for it with sync scripts
and a bulk-update tool: the second column is a copy that has to be kept right.

### Options

| Option                                                                     | Sort, range, index                        | Can Postgres validate it                                                                                     | Drift                                             | Verdict                                                                               |
| -------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **A. Gregorian `date` + calendar tag, printed text in `raw_json`**         | Native. The existing index and `CHECK`    | Yes: `date`, and a `CHECK` on the tag                                                                        | None: one value                                   | **Chosen**                                                                            |
| B. Two columns (`receipt_date` + `receipt_date_bs`)                        | Native on the AD one                      | Not the BS one. It can't be a `date` (a BS month can have 32 days, which `date` rejects), so it is text or three integers, and the month table isn't in SQL | Yes: after an edit, a table fix, or a rollback    | Rejected. A copy that Postgres can't check                                            |
| C. Composite type `(calendar, year, month, day)`                           | No useful order across calendars          | Only field ranges                                                                                            | None                                              | Rejected. Portable, but Drizzle has no first-class composite types, and every range query needs conversion first |
| D. JSON                                                                    | None without expression indexes           | No                                                                                                           | None                                              | Rejected for the value. Right for the evidence (`raw_json.dates[]`)                   |

### Decision

```
receipts.receipt_date           date   -- exists. The day, Gregorian. The only stored date
receipts.receipt_date_calendar  text   -- new. Calendar the receipt printed: 'gregory' | 'bikram-sambat' | null
receipts.raw_json -> dates[]           -- new in extraction v3. {text, label, calendar, role}, exactly as printed
```

- **`receipt_date_calendar` is a fact about the paper, not a display setting.** `bikram-sambat` when a BS date was
  printed, alone or beside an AD date. `gregory` when only AD was. Null when no date was read, or on rows from before
  this change; readers treat null as `gregory`.
- **Values are Unicode calendar identifiers** (the `u-ca` values of RFC 9557, the same strings `Intl.DateTimeFormat`
  and Temporal take). `gregory` is the standard one. Bikram Sambat has none, so `bikram-sambat` is ours. If a receipt
  with a Hijri, Persian, Thai or Ethiopian date ever needs support, its value (`islamic-umalqura`, `persian`,
  `buddhist`, `ethiopic`) goes straight into `Intl`, and only BS needs our table. The model's `dates[].calendar` hint
  uses the same two values plus `unknown`: one vocabulary.
- **Text with a `CHECK`, not a Postgres enum type.** Adding a value is then a constraint swap, and the column can be
  dropped without leaving a type behind.
- **Why the tag earns a column** (and isn't only in `raw_json`): the list, the receipt page and the CSV all branch on
  it for every row, and the user can correct it in the editor. `raw_json` is the model's untouched output.
- **BS is never stored.** It is `adToBs(receipt_date)` from the vendored month table, wherever it is shown or
  exported. For BS a day is a civil day in both calendars, so the mapping is exact, one to one.
- **Resolver, restating the owner's rules against this model:**

| Receipt prints                    | `receipt_date`                                                         | `receipt_date_calendar` | Review reason     |
| --------------------------------- | ---------------------------------------------------------------------- | ----------------------- | ----------------- |
| AD only, one valid reading        | That day                                                               | `gregory`               | none              |
| AD only, day and month ambiguous  | Best reading                                                           | `gregory`               | `date_ambiguous`  |
| BS only                           | `bsToAd(printed)`                                                      | `bikram-sambat`         | none              |
| AD and Miti, same day             | That day                                                               | `bikram-sambat`         | none              |
| AD and Miti differ, currency NPR  | `bsToAd(Miti)`. If the Miti itself is invalid or out of bounds, the AD | `bikram-sambat`         | `date_conflict`   |
| AD and Miti differ, other currency | The AD date                                                           | `bikram-sambat`         | `date_conflict`   |
| Nothing fits the bounds           | null                                                                   | null                    | `date_implausible` |

- **Bounds come from the row, not from constants.** A reading is valid when its AD day is from 2000-01-01 to the
  upload day + 1, which is what `receipts_receipt_date_check` already enforces. So the AD year runs 2000 to the upload
  year and the BS year runs 2056 to the BS year of the upload day. No "2070 to 2090" in code or prompt.
- **A table correction re-resolves, without a provenance column.** The job takes rows with
  `receipt_date_calendar = 'bikram-sambat'` and `reviewed_at IS NULL` whose stored day equals the old table's
  conversion of the printed text, and rewrites those. A row a person changed no longer matches and is skipped.
- **Other calendars later.** Hijri needs more care than BS: the day depends on the variant (Umm al-Qura, tabular,
  sighting), which is why SAP lets an administrator edit the table and has a KBA for a one-day error. The model here
  already covers it (Gregorian day, tag, printed text, a flag when unsure). Nothing to build until a fixture needs it.

## 2. Display, sorting, filtering, export

| Surface                      | Rule                                                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receipt page, History, Home  | One function, `formatReceiptDate(date, calendar)`. `bikram-sambat`: `9 Shrawan 2080 · 25 Jul 2023`, BS first, AD muted. Otherwise `25 Jul 2023`. The AD part stays in lists too: a list sorted by day that mixes the two calendars reads as unsorted without it   |
| Script                       | Romanised month names and Latin digits. `Intl` can't format BS, so the BS half is our formatter; the AD half stays `Intl.DateTimeFormat`. Devanagari waits for a Nepali UI                                                                                       |
| Editor                       | The field opens in the receipt's calendar: a BS text field with a live AD preview for BS receipts, the AD date input otherwise, and a small switch between them. The switch also saves `receiptDateCalendar`, which is how a wrong guess is corrected           |
| API and "Copy JSON"          | `receiptDate` is always ISO `YYYY-MM-DD`, in and out. `receiptDateCalendar` beside it. Core adds a derived `receiptDateBs` (`"2080-04-09"`) only when the calendar is BS. PATCH takes the ISO date; the client converts                                          |
| Sorting                      | `ORDER BY receipt_date`. BS and AD run in the same order, so one sort is right in both. Never sort formatted text                                                                                                                                                |
| Filter by month or range     | Always an AD range on `(organization_id, receipt_date)`. "Kartik 2083" and "FY 2082/83" are presets that core turns into `from`/`to` with the table. URL parameters stay ISO, so a link means the same day for everyone                                          |
| Who sees BS presets          | For now, viewers whose time-zone cookie is `Asia/Kathmandu` (it exists; no storage, no query). The workspace setting replaces this                                                                                                                              |
| Dashboard month buckets      | Gregorian months, until the workspace setting exists. A chart has one calendar per view, not per receipt                                                                                                                                                        |
| CSV                          | `receipt_date`: ISO AD on every dated row, unchanged. `receipt_date_bs`: new, next to it, text `2080.04.09` (the form the IRD API takes), filled when the receipt printed BS, empty otherwise. The header is always present so importers see a stable shape      |

**Preference.** Not now: the per-receipt rule needs no setting and is right for both audiences. The gap it leaves is
real and narrow: a Nepali accountant's export has an empty `receipt_date_bs` on Nepali bills that printed only AD,
and their dashboard buckets by Gregorian month. That is the trigger. When it is built:

- **Per workspace, not per user.** Month boundaries, the fiscal year and the export are the books' convention. Two
  members looking at "this month" must see the same total. It is the same reasoning as the home currency.
- **It only adds BS:** on receipts that printed AD, in presets, in dashboard buckets and in every CSV row. The AD
  date is always still shown, so a foreign member of a Nepali workspace is never stuck.
- Same values as `receipt_date_calendar`; null means automatic. No column until the settings UI exists.

## 3. Field model

### 3.1 What others treat as core

| Concept          | Azure receipt (v4.0)           | Google Expense parser      | AWS AnalyzeExpense                          | Mindee Receipt                    | Veryfi               | EN 16931 / Peppol |
| ---------------- | ------------------------------ | -------------------------- | ------------------------------------------- | --------------------------------- | -------------------- | ----------------- |
| Seller name      | `MerchantName`                 | `supplier_name`            | `VENDOR_NAME`                               | `supplier_name`                   | `vendor.name`        | BT-28 (BT-27 legal name) |
| Date             | `TransactionDate`              | `receipt_date`             | `INVOICE_RECEIPT_DATE`                      | `date`                            | `date`               | BT-2              |
| Total            | `Total`                        | `total_amount`             | `TOTAL`                                     | `total_amount`                    | `total`              | BT-112            |
| Currency         | on each amount                 | `currency`                 | `ValueDetection.Currency.Code`              | `locale.currency`                 | `currency_code`      | BT-5              |
| Subtotal         | `Subtotal`                     | `net_amount`               | `SUBTOTAL`                                  | `total_net`                       | `subtotal`           | BT-106            |
| Tax              | `TotalTax`, `TaxDetails[]`     | `total_tax_amount`         | `TAX`                                       | `total_tax`, `taxes[]`            | `tax`, `tax_lines[]` | BT-110, BG-23     |
| Tip              | `Tip`                          | `tip_amount`               | `GRATUITY`                                  | `tips_gratuity`                   | `tip`                | none              |
| Document number  | none (invoice: `InvoiceId`)    | none (invoice: `invoice_id`) | `INVOICE_RECEIPT_ID`                      | `receipt_number`                  | `invoice_number`     | BT-1              |
| Seller tax id    | none (invoice: `VendorTaxId`)  | none (invoice: `supplier_tax_id`) | `TAX_PAYER_ID`, `VENDOR_VAT_NUMBER`, `VENDOR_PAN_NUMBER`, `VENDOR_GST_NUMBER` | `supplier_company_registration[]` | `vendor.vat_number` | BT-31 |
| Discount         | none (invoice: `TotalDiscount`) | none                      | `DISCOUNT`                                  | none                              | `discount`           | BT-107            |
| Service charge   | none                           | none                       | `SERVICE_CHARGE`                            | none                              | not found            | BT-108            |
| Time             | `TransactionTime`              | `purchase_time`            | none                                        | `time`                            | inside `date`        | none              |
| Payment method   | `Payments[].Method`            | `payment_type`             | none                                        | none                              | `payment.type`       | BT-81             |
| Type or category | `ReceiptType`                  | none                       | none                                        | `document_type`, `purchase_category` | `document_type`, `category` | BT-3       |
| Line             | `Description`, `Quantity`, `Price`, `TotalPrice` | `description`, `quantity`, `amount` | `ITEM`, `QUANTITY`, `UNIT_PRICE`, `PRICE` | `description`, `quantity`, `unit_price`, `total_price` | `description`, `quantity`, `price`, `total`, `order` | BT-153, BT-129, BT-146, BT-131, BT-126 |

- **Merchant, date, total and currency are in every column, and they are what expense tools run on.** Expensify's
  SmartScan fails without a readable date and total, and Ramp matches a receipt to a card transaction by merchant,
  amount and date. Those four are our required set. Subtotal, tax and tip are in every column too, but many receipts
  don't print them, so their absence can't be a flag.
- **Bill number and seller tax id are invoice fields for Azure and Google** (their receipt models don't have them) and
  receipt fields for AWS, Mindee and Veryfi. For Nepal they are what turns an expense list into a purchase register.
- **Service charge is rare** (only AWS names it). We need it anyway: without it the totals check fails on every
  Nepali restaurant bill.
- schema.org is little help here. `Invoice` has no number or issue date; `Order` has `orderNumber`, `orderDate`,
  `seller` and `discount`. Nothing in it argues for a different name.

### 3.2 Receipt fields

"Required" means the receipt can't be marked usable without review when the field is missing: a reason code is
added. No field is `NOT NULL` without a default, so an imperfect scan always saves.

| Field                    | Column                  | API / wire            | Type                              | Required | Where        | Aligns with                                                                                     | Why                                                                                                    |
| ------------------------ | ----------------------- | --------------------- | --------------------------------- | -------- | ------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Merchant                 | `merchant`              | `merchant`            | text                              | **Yes**  | Column, exists | BT-28 Seller trading name; Azure `MerchantName`                                               | Identity of the expense; search, dashboard grouping                                                    |
| Date                     | `receipt_date`          | `receiptDate`         | date (ISO 8601)                   | **Yes**  | Column, exists | BT-2 Invoice issue date; Google `receipt_date`                                                | Sorting, periods, FX                                                                                   |
| Printed calendar         | `receipt_date_calendar` | `receiptDateCalendar` | text, `gregory` \| `bikram-sambat` | No       | Column, **new** | RFC 9557 / CLDR `u-ca` identifier. No extractor has one                                      | Display, editor and CSV branch on it per row                                                           |
| Total                    | `total`                 | `total`               | numeric(12,2)                     | **Yes**  | Column, exists | BT-112 Invoice total amount with VAT (BT-115 when a rounded amount due is printed); `TOTAL`   | The expense amount                                                                                     |
| Currency                 | `currency`              | `currency`            | text, ISO 4217                    | **Yes**  | Column, exists | BT-5 Invoice currency code; Google `currency`                                                  | A total without a currency can't be summed                                                             |
| Subtotal                 | `subtotal`              | `subtotal`            | numeric(12,2)                     | No       | Column, exists | BT-106 Sum of invoice line net amounts; Azure `Subtotal`                                       | Totals check                                                                                           |
| Tax                      | `tax`                   | `tax`                 | numeric(12,2)                     | No       | Column, exists | BT-110 Invoice total VAT amount; AWS `TAX`                                                     | VAT reporting; totals check                                                                            |
| Tip                      | `tip`                   | `tip`                 | numeric(12,2)                     | No       | Column, exists | No EN 16931 term; Azure `Tip`, AWS `GRATUITY`                                                  | Totals check                                                                                           |
| Discount                 | `discount`              | `discount`            | numeric(12,2), ≥ 0                | No       | Column, **new** | BT-107 Sum of allowances on document level; AWS `DISCOUNT`, Veryfi `discount`, schema.org `discount` | Totals check balances; user-editable                                                              |
| Service charge           | `service_charge`        | `serviceCharge`       | numeric(12,2), ≥ 0                | No       | Column, **new** | BT-108 Sum of charges on document level (a BG-21 charge); AWS `SERVICE_CHARGE`                | Totals check on restaurant bills; user-editable                                                        |
| Bill or invoice number   | `invoice_number`        | `invoiceNumber`       | text, 1 to 64, as printed         | No       | Column, **new** | BT-1 Invoice number; Veryfi `invoice_number`, IRD `invoice_number`, AWS `INVOICE_RECEIPT_ID`  | Purchase register, search, duplicate flag. Not unique: flagged by a query, never rejected              |
| Seller PAN / VAT number  | `merchant_tax_id`       | `merchantTaxId`       | text, 1 to 32, as printed         | No       | Column, **new** | BT-31 Seller VAT identifier; Azure `VendorTaxId`, Google `supplier_tax_id`, IRD `seller_pan`  | Purchase register; the reliable merchant key; duplicate flag with the bill number                      |
| Category                 | `category`              | `category`            | text (app list)                   | No       | Column, exists | No standard. Azure `ReceiptType`, Mindee `purchase_category`                                   | Dashboard, filters                                                                                     |
| Review reasons           | `review_reasons`        | `reviewReasons`       | text[], default `{}`              | n/a      | Column, **new** | Ours                                                                                          | "Needs review" must be a SQL filter, and SQL can't recompute a date conflict (it needs the BS table)   |
| Overall confidence       | `confidence`            | `confidence`          | numeric(5,4)                      | No       | Column, exists | Ours (every extractor has its own score)                                                       | Kept as a hint, no longer the rule                                                                     |
| Printed dates            | none                    | `dates[]`             | `{text, label, calendar, role}`, max 4 | No  | `raw_json`   | Google's `mentionText` beside `normalizedValue`                                                 | Evidence. Re-resolve after a table fix. Never edited, so never a column                                |

Reason codes at the start: `no_merchant`, `no_date`, `no_total`, `no_currency`, `totals_mismatch`, `date_ambiguous`,
`date_conflict`, `date_implausible`, and `low_confidence` for the backfill of today's rule. A receipt is usable when
`status = 'completed' AND review_reasons = '{}'`, or a person has reviewed it (`reviewed_at`).

Totals check with the new amounts: `subtotal − discount + service_charge + tax + tip ≈ total`, also accepted without
`tax` when prices include it.

### 3.3 Line items

| Field      | Column        | API / wire   | Type                    | Where            | Aligns with                                                                                | Why                                                                 |
| ---------- | ------------- | ------------ | ----------------------- | ---------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Line order | `position`    | array order  | smallint, default 0     | Column, **new**  | BT-126 Invoice line identifier; Veryfi `order`                                             | Rows have random ids and the read has no `ORDER BY` today           |
| Name       | `name`        | `name`       | text                    | Column, exists   | BT-153 Item name. Extractors say `description`                                             | The printed line                                                    |
| Quantity   | `quantity`    | `quantity`   | integer, numeric later  | Column, exists   | BT-129 Invoiced quantity                                                                   | See [section 4](#4-what-else-is-missing), item 2                    |
| Unit price | `unit_price`  | `unitPrice`  | numeric(12,2)           | Column, exists   | BT-146 Item net price; Google, AWS, Mindee `unit_price`                                    | Line check                                                          |
| Line total | `total_price` | `totalPrice` | numeric(12,2)           | Column, exists   | BT-131 Invoice line net amount; Azure `TotalPrice`, Mindee `total_price`                   | Line check, item CSV                                                |
| Confidence | `confidence`  | `confidence` | numeric(5,4), nullable  | Column, exists   | Ours                                                                                       | Stays until the A/B lets the prompt drop it                         |

`position` isn't exposed: the API returns items as an ordered array. `order` is Veryfi's word and a reserved word in
SQL; `line_number` would be confused with a printed serial number.

### 3.4 Not columns

Each of these goes into the wire schema and `raw_json` first, and becomes a column with the feature that reads it.

| Concept                                   | Standard and extractor names                                                    | Receipts that need it                  | Verdict                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| Document type                             | BT-3 Invoice type code; Mindee and Veryfi `document_type`                       | Payment screenshots, refunds, tax invoice vs estimate | Later: `document_type`. First real use is a refund (a negative total) or VAT-credit rules |
| Payment method                            | BT-81 Payment means type code; Azure `Payments[].Method`, Google `payment_type` | Card and wallet reconciliation         | Later: `payment_method`, with statement matching                                            |
| Payment reference                         | Google invoice `supplier_payment_ref`                                           | eSewa, Khalti, bank-transfer screenshots | Later, with duplicate detection. Not the bill number                                      |
| Time of sale                              | Azure `TransactionTime`, Google `purchase_time`, Mindee `time`                  | Duplicate detection                    | Later: `receipt_time`                                                                       |
| Country                                   | Azure `CountryRegion`, Mindee `locale.country`                                  | Day/month order, tax-id shape          | `raw_json` only (the FX plan already puts it there)                                         |
| Tax by rate                               | BG-23 VAT breakdown; Azure `TaxDetails[]`, Mindee `taxes[]`, Veryfi `tax_lines[]` | EU multi-rate, India CGST + SGST     | Later, as a child table. `tax` stays the sum                                                |
| Unit of measure, product code             | Azure `QuantityUnit`, `ProductCode`                                             | Fuel (litres), groceries by weight     | `raw_json` only. Decimal quantity matters; the unit doesn't until someone exports it        |
| Due date, amount due, PO, terms, service period, account number | BT-9, BT-115; Azure invoice `DueDate`, `AmountDue`, `ServiceStartDate` | Utility bills, supplier invoices | Never as columns: accounts-payable fields. `dates[]` with `role: other` keeps the dates |
| Buyer name and tax id                     | BT-48 Buyer VAT identifier; IRD `buyer_pan`                                     | Nepal VAT credit                       | Never per receipt. The buyer is the workspace: one setting later. It is also the user's own tax id |
| Rounding                                  | BT-114; Veryfi `rounding`                                                       | Cash rounding                          | Never: a tolerance in the check                                                             |
| Merchant address, phone                   | Azure `MerchantAddress`, `MerchantPhoneNumber`                                  | none yet                               | Never as columns                                                                            |
| Fiscal year                               | IRD `fiscal_year`                                                               | Nepal filing                           | Never stored: a range of `receipt_date`                                                     |
| Home-currency amount, rate                | Google `currency_exchange_rate`, Veryfi `exch_rate`                             | Multi-currency workspaces              | The [FX plan](../plans/2026-11-06-currencies-fx.md) owns it. `currency` and `total` stay as printed |

### 3.5 Existing names

No single standard word exists for the party: EN 16931 says Seller, UBL says Supplier, Azure says Merchant on
receipts and Vendor on invoices, Google and Mindee say supplier, AWS and Veryfi say vendor. So the table's own
consistency decides.

**Now** (free, because nothing has shipped):

| Proposed in the earlier reviews            | Use instead                         | Why                                                                                                                                                                    |
| ------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seller_tax_id` / `sellerTaxId`            | `merchant_tax_id` / `merchantTaxId` | The column beside it is `merchant`. `{merchant, sellerTaxId}` reads as two parties, and on a marketplace invoice they can be. `tax_id` is the shared part (Azure `VendorTaxId`, Google `supplier_tax_id`). If the owner prefers EN 16931's word, the consistent alternative is renaming `merchant` too, which isn't worth it |
| `ad` / `bs` / `both` for the calendar      | `gregory` / `bikram-sambat`         | Unicode identifiers; "both" is not a calendar, and what else was printed is in `raw_json.dates[]`                                                                      |
| `receipt_date_check` (plan)                | `review_reasons`                    | One mechanism for every check, as the fields review proposed                                                                                                           |

**Later** (a type, not a name):

| Column                   | Change                                              | Why not now                                                                                        |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `receipt_items.quantity` | `integer` to `numeric(12,3)`, by expand and contract | An in-place type change breaks running code, which reads an integer. Own PR; see section 4, item 2 |
| `receipts.currency`      | Drop `DEFAULT 'USD'`                                | With the FX work; see section 4, item 3                                                            |

**Leave:**

| Name                                  | Closest standard names                                                                | Why it stays                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `merchant`                            | BT-28 Seller trading name; `MerchantName`, `supplier_name`, `vendor.name`             | The receipt-world word (Azure receipts, Expensify, Ramp, card statements) and the UI label. `merchant_name` adds nothing |
| `receipt_date`                        | BT-2; Google `receipt_date`                                                           | Exact match                                                                                                       |
| `currency`                            | BT-5; Google `currency`; Veryfi `currency_code`                                       | `_code` isn't worth a CSV header change                                                                           |
| `subtotal`, `total`, `tip`            | Azure `Subtotal`, `Total`, `Tip`; AWS; Veryfi                                         | Exact matches                                                                                                     |
| `tax`                                 | AWS `TAX`, Veryfi `tax`. Azure renamed its own `Tax` to `TotalTax` in 2022            | Half the field uses each. The description already says it is the sum; a later per-rate table is `receipt_taxes`   |
| `category`, `confidence`              | No standard                                                                           |                                                                                                                   |
| `receipt_items`                       | BG-25 Invoice line; Azure `Items`; `line_items`                                       | Clear                                                                                                             |
| `receipt_items.name`                  | BT-153 Item name. Extractors say `description`, and Azure renamed `Name` to `Description` | EN 16931 keeps "description" (BT-154) for a longer text. The printed line is the item name                    |
| `unit_price`, `total_price`           | BT-146, BT-131; Mindee `unit_price`, `total_price`; Azure `TotalPrice`                | Exact matches                                                                                                     |
| Wire names in `packages/ai/src/schema.ts` | Same as the columns, camelCase                                                    | One vocabulary from model to table to CSV                                                                         |

## 4. What else is missing

1. **The wire schema forces the model to invent values.** `merchant` is a required string, `total` a required number
   and `currency` exactly three characters (`packages/ai/src/schema.ts:44-54`), and `complete` stores
   `String(extraction.total)` (`packages/core/src/repository.ts:472`). An unreadable total comes back as a number
   anyway and passes every check. In v3 make all three nullable, and let `no_merchant`, `no_total` and `no_currency`
   say so. This is the rule "nothing required blocks an imperfect scan", applied one layer up.
2. **Weights and volumes are rounded to whole units** (`repository.ts:492`, `Math.max(1, Math.round(...))`). A fuel
   receipt for 33.9 L stores 34, and 0.5 kg stores 1. Fuel and groceries are in scope, so this comes before either is
   advertised. The true value is in `raw_json`, so the backfill is exact.
3. **`currency` defaults to USD** in the column and in `money()`. A receipt whose currency wasn't read is shown and
   summed as dollars. With `no_currency` as a reason this becomes visible; the default should go with the FX work.
4. **Three-decimal currencies.** `numeric(12,2)` rounds KWD, BHD, OMR, JOD and TND amounts. The FX plan already
   widens the amount columns; `discount` and `service_charge` must widen with them.
5. **Re-resolution after a month-table fix is not optional.** Library tables for BS 2083 were corrected in May and
   June 2026, after the year had begun (the plan, §2). A receipt converted before such a fix can be a day off. The job in section 1 and the plan's
   "official through" canary both ship with the table.
6. **Tax ids are personal data for sole traders.** A Nepali PAN can belong to a person. `merchant_tax_id` and
   `invoice_number` never go into telemetry, and the buyer's PAN is not extracted at all.
7. **`0002` is taken.** `0002_receipt_review.sql` (`reviewed_at`, `reviewed_by`) is pending on `feat/receipt-review`,
   and that branch's rule is still `confidence < 0.9 AND reviewed_at IS NULL`. Generate this migration after it
   merges, and switch the rule to `review_reasons` in the same PR that writes them.
8. **"Copy JSON" exports `raw_json`.** Once that holds `dates[]`, the export leaks evidence and misses edits. Build it
   from the row (fields review, finding 2).

## 5. Migration sketch

`packages/db/src/index.ts` is the source of truth and `bun run db:generate` writes the file. The hand edits are the
`SET LOCAL` lines, `NOT VALID` and the two backfills. Nothing is `NOT NULL` without a constant default, so adding the
columns is catalog-only and the running code is unaffected.

```sql
-- apps/web/drizzle/0003_receipt_fields.sql   (after the pending 0002_receipt_review.sql)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s'; -- the two backfills

ALTER TABLE "receipts"
  ADD COLUMN "receipt_date_calendar" text,
  ADD COLUMN "invoice_number" text,
  ADD COLUMN "merchant_tax_id" text,
  ADD COLUMN "discount" numeric(12, 2),
  ADD COLUMN "service_charge" numeric(12, 2),
  ADD COLUMN "review_reasons" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "receipt_items" ADD COLUMN "position" smallint DEFAULT 0 NOT NULL;

-- One column per check, so code that doesn't know a column can't violate one.
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_receipt_date_calendar_check"
  CHECK (receipt_date_calendar IN ('gregory', 'bikram-sambat')) NOT VALID;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_number_check"
  CHECK (char_length(invoice_number) BETWEEN 1 AND 64) NOT VALID;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_merchant_tax_id_check"
  CHECK (char_length(merchant_tax_id) BETWEEN 1 AND 32) NOT VALID;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_discount_check" CHECK (discount >= 0) NOT VALID;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_service_charge_check" CHECK (service_charge >= 0) NOT VALID;
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_position_check" CHECK (position >= 0) NOT VALID;

-- Existing rows keep today's rule. Idempotent.
UPDATE "receipts" SET "review_reasons" = '{low_confidence}'
  WHERE "status" = 'completed' AND "confidence" < 0.9 AND "review_reasons" = '{}';
-- Freeze the line order people see today.
UPDATE "receipt_items" i SET "position" = o.n
  FROM (SELECT id, row_number() OVER (PARTITION BY receipt_id ORDER BY ctid) - 1 AS n FROM "receipt_items") o
  WHERE o.id = i.id AND o.n <> 0;
```

```sql
-- apps/web/drizzle/0004_*.sql, the next migration, first statements
SET LOCAL lock_timeout = '3s';
ALTER TABLE "receipts" VALIDATE CONSTRAINT "receipts_receipt_date_calendar_check";
-- ... one VALIDATE per constraint added NOT VALID in 0003 ...
```

- No new index. `receipts_org_receipt_date_idx` already serves every date range, BS months included. "Needs review"
  becomes `status = 'completed' AND review_reasons <> '{}' AND reviewed_at IS NULL` on the same scan as today; take
  `EXPLAIN (ANALYZE, BUFFERS)` on the seeded workspace in the PR.
- Old rows: the five extracted columns and `receipt_date_calendar` stay null. The model was never asked, so
  `raw_json` doesn't hold them. Null calendar reads as Gregorian, which is what those rows are.
- Rollback: old code ignores every new column.
- Not in this file: the index on `(organization_id, invoice_number)` (ships with duplicate detection), decimal
  quantity, `payment_method`, `document_type`, `receipt_time`, and any preference column.

## Sources

All opened 2026-11-12. "Search summary" means the page was found and summarised by a search, not opened in full.

**Calendars and storage**

- [ZATCA developer forum: BR-KSA-F-01 date format change](https://zatca1.discourse.group/t/breaking-change-br-ksa-f-01-date-format-change/6858) (5 May 2025)
- [Java 21 `ChronoLocalDate`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/chrono/ChronoLocalDate.html), "When to use this interface"
- [RFC 9557](https://www.rfc-editor.org/rfc/rfc9557.html), §4.2 and §5
- [Temporal cookbook: Nepali calendar](https://tc39.es/proposal-temporal/docs/cookbook-nepali-calendar.html)
- [MDN `Intl.supportedValuesOf`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/supportedValuesOf)
- [tc39/proposal-intl-era-monthcode issue 18](https://github.com/tc39/proposal-intl-era-monthcode/issues/18) (31 Oct 2023)
- [PostgreSQL: Date/Time Types](https://www.postgresql.org/docs/current/datatype-datetime.html)
- [django-jalali](https://github.com/slashmili/django-jalali), `django_jalali/db/models.py` (read through the GitHub API)
- [yarsa/nepal-compliance](https://github.com/yarsa/nepal-compliance), `nepal_compliance/custom_field.py` and
  `public/js/sales_invoice.js` (read through the GitHub API; 179 stars, pushed 2026-11-01)
- [IRD CBMS API fields, Frappe forum](https://discuss.frappe.io/t/central-billing-monitoring-system-api-documentation-for-nepal/34814)
- [IRD e-billing approval requirements, Frappe forum](https://discuss.frappe.io/t/finally-got-approval-for-e-billing-from-ird-nepal-erpnext-v13-28-saas/93072) (9 Aug 2022)
- Search summaries: [SAP Help, Islamic calendar table](https://help.sap.com/doc/saphelp_nw751abap/7.51.0/en-US/0c/de136ff59344a48c668bd7145ba068/content.htm);
  [SAP KBA 1690275](https://userapps.support.sap.com/sap/support/knowledge/en/1690275);
  [Jooyeshgar/moadian](https://www.github.com/Jooyeshgar/moadian);
  [Odoo `nepali_date`](https://apps.odoo.com/apps/modules/18.0/nepali_date);
  [Odoo `l10n_np_cbms_ebilling`](https://apps.odoo.com/apps/modules/19.0/l10n_np_cbms_ebilling);
  [Frappe forum, other calendar systems](https://discuss.frappe.io/t/use-a-different-calendar-system-alternatives-to-gregorian/89227)

**Field models**

- [Azure receipt schema, 2024-11-30](https://github.com/Azure-Samples/document-intelligence-code-samples/blob/main/schema/2024-11-30-ga/receipt.md)
  and [invoice schema](https://github.com/Azure-Samples/document-intelligence-code-samples/blob/main/schema/2024-11-30-ga/invoice.md);
  [Azure receipt model page](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt?view=doc-intel-4.0.0) (the `Tax` and `Name` renames)
- [Google Document AI processor list](https://docs.cloud.google.com/document-ai/docs/processors-list) (Expense and Invoice parsers)
- [AWS Textract: Analyzing Invoices and Receipts](https://docs.aws.amazon.com/textract/latest/dg/invoices-receipts.html)
- [Mindee Receipt model](https://docs.mindee.com/use-cases/extraction-models/receipt.md)
- [Veryfi: Process a Document](https://docs.veryfi.com/api/receipts-invoices/process-a-document/) (read to character 300,000 of 339,000)
- [Peppol BIS Billing 3.0 syntax](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/tree/) and its element
  pages: BT-1, BT-2, BT-3, BT-9, BT-27, BT-28, BT-30, BT-31, BT-81, BT-106 to BT-110, BT-112, BT-114, BT-115, BT-126,
  BT-129, BT-131, BT-146, BT-153 were each read on the tree page or the page of their UBL element
- [schema.org Invoice](https://schema.org/Invoice) and [Order](https://schema.org/Order)
- Google's `mentionText` beside `normalizedValue` is carried from the plan's sources (opened 2026-11-07), not
  re-opened
- Search summaries: [Expensify: Troubleshoot SmartScan](https://help.expensify.com/articles/new-expensify/reports-and-expenses/Troubleshoot-SmartScan-Issues);
  [Ramp receipt automation](https://ramp.com/receipt-automation);
  [Ramp Bill Pay OCR](https://support.ramp.com/hc/en-us/articles/45686841394579-Ramp-Bill-Pay-OCR)

## Not verified

- **Thai and Ethiopian systems.** A search for Thailand's e-Tax invoice (ETDA standard 3-2560) found no statement of
  the year era in its XML. Ethiopian accounting software was not researched. Both calendars are in `Intl`
  (`buddhist`, `ethiopic`), which is all the design relies on.
- **ZATCA's own PDF** (XML Implementation Standard) was not opened; the rule text is from its developer forum.
- **SAP and Iran.** That SAP date fields hold Gregorian values, and Moadian's official field definition, are
  inferences from the cited pages.
- **Odoo.** The Nepali modules' column types are not stated in their listings.
- **How Excel and Google Sheets import `2080.04.09`.** The dotted form follows the IRD API. A dashed `2080-04-09`
  would likely be read as a Gregorian date in 2080. Locales that write dates with dots may still convert the dotted
  form. Test both in both tools before the CSV ships.
- **EN 16931 terms not read on a page today:** BT-48, BT-154, BG-21, BG-23 and BG-25 as named here, and which terms
  are mandatory in the standard.
- **Azure's currency code** on each amount (`valueCurrency.currencyCode`) and the three-decimal currency list are
  from memory.
- **Veryfi** may have a service-charge field in the part of its schema that wasn't read.
- Nothing here was run: no SQL, no `EXPLAIN`, no model call. The `position` backfill and `VALIDATE` ordering carry
  over from the fields review, which did not run them either.
