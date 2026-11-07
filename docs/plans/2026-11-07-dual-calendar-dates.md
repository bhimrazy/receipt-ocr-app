# Dual-calendar receipt dates (AD and Bikram Sambat): plan (2026-11-07)

Status: proposal. Nothing implemented. Code facts were read from `main` at `7e10057`. Library, calendar and Nepal
facts were fetched on 2026-11-07 (registry JSON, GitHub, the tarballs' own tables and the pages in
[Sources](#12-sources)); what could not be confirmed is listed in [Not verified](#13-not-verified). Benchmark numbers
are from the 2026-11-07 run on 31 real receipts (`bench/results/2026-11-07-*.md`, local).

## TL;DR

- **One canonical date, in AD, as a real `date`.** `receipts.receipt_date` becomes `date` (it is free text today,
  compared as strings). Sorting, filters, the dashboard, FX and export all use it. This is the FX plan's PR 1c, done
  once for both plans.
- **BS is a view of that date, not a second stored value.** Every AD date in the table range has exactly one BS date,
  so a `receipt_date_bs` column would only be a copy that can drift: after an edit, or after a table correction.
  What the receipt _printed_ is evidence and is kept: the model's `dates[]` transcription already lands in
  `raw_json`, which edits never touch. One new column, `receipt_date_check`, records how the date was settled
  (`agree`, `single`, `ambiguous`, `conflict`, `implausible`, `user`).
- **The model transcribes and code decides.** The model returns every printed date as text with its label
  ("Date", "Miti", "मिति"), a calendar guess and a role. A pure resolver in code parses the text (Devanagari digits,
  English and Nepali month names), lists the readings (DD/MM, MM/DD, AD or BS), drops impossible and implausible
  ones, and **cross-checks the AD and BS dates against each other**. On the owner's receipts that check settles
  MM/DD vs DD/MM every time a Miti is printed: Drishya Lounge's `04/09/2022` with Miti `26/12/2078` can only be 9
  April 2022.
- **Vendor the BS month table (about 1.5 KB of data) in `packages/core`, don't add a dependency.** All nine library
  tables we diffed agree on BS 2070-2083. They disagree on 2062, on 2084-2099 (projections; some libraries copy
  earlier years) and on 2087. Three years (2081, 2082, 2083) were corrected in libraries after release in the last
  two years. Receipts are dated in the past, so only official years matter. The table should be ours: tested, with an
  "official through" marker and a yearly update step, and no supply-chain surface.
- **Display AD, BS or both per user.** The default is "both" when the browser's time zone is `Asia/Kathmandu` or the
  workspace's home currency is NPR, and AD otherwise. CSV gets `date_bs`. The editor takes either calendar.
  History and export get BS-month and **Nepal fiscal year** (Shrawan to Asar) presets, which are just AD ranges.
- **The cost argument holds, but measure it.** Haiku 5.5 got 1 of 6 Nepal dates right at $0.0041 for the slice. Opus
  got 4-5 of 6 at $0.168, about 41 times more. The Haiku misses we looked at are the kind code can fix: BS returned as null, or a
  US-order date read day-first. Haiku plus the resolver is the candidate to beat. The benchmark decides.
- **About 8-9 engineer-days in five PRs.** Not yet: a Nepali-language UI, a BS date picker, Devanagari digits in the
  UI, or receipt time.

### What changes in the draft design

| Draft                                                                        | Change                                                                                                                                                                                          | Why                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical AD `receiptDate` (ISO)                                             | Keep, and make the column `date`, not text                                                                                                                                                      | Real date semantics, validation in Postgres and range indexes. The FX plan needs it anyway                                                                           |
| Add `receiptDateBs`                                                          | **Don't store it.** Derive BS from AD wherever it is shown or exported                                                                                                                          | It is a function of AD. A copy goes stale on edits and on table fixes. The BS the receipt _printed_ stays in `raw_json.dates`                                        |
| Keep `datesAsPrinted`                                                        | Yes, as the model's `dates[]` inside `raw_json` (no new column)                                                                                                                                 | `raw_json` is already the untouched model output. A table fix can re-resolve from it                                                                                 |
| Model returns dates as printed plus calendar; code converts and cross-checks | Yes. Add a `role` (the transaction date vs other dates), keep the model's own `receiptDate` reading as a tie-breaker, and make the resolver a pure function shared by the app and the benchmark | Due and expiry dates are printed too. The model's reading still helps when nothing else decides                                                                      |
| Flag for review when they disagree                                           | Also flag `ambiguous` (no Miti, both orders valid) and `implausible` (future, too old) dates, through `receipt_date_check` and the review checklist                                             | The Saathimart misses had no conflict to detect: `10/07/2023` alone is just ambiguous                                                                                |
| User setting AD / BS / both (Nepal default both)                             | Keep it per user. Default it from the `Asia/Kathmandu` time zone cookie (already set) or NPR as the home currency                                                                               | The app stores no country or region today, and the FX plan says not to store it                                                                                      |
| CSV `date_bs`                                                                | Keep it, always present (empty without a date), in the `2080.04.09` form; add fiscal-year export presets                                                                                        | A stable header for importers. Spreadsheets may turn a dashed `2080-04-09` into a Gregorian 2080 date (to check, §7.3). Accountants file by BS month and fiscal year |
| Edit forms accept either calendar                                            | Yes: an AD/BS toggle and a BS text field with a live "= 25 Jul 2023" preview. No BS picker yet                                                                                                  | A picker is a component to build and maintain; text plus preview covers correction                                                                                   |

## Contents

1. [Current state](#1-current-state)
2. [Bikram Sambat facts](#2-bikram-sambat-facts)
3. [Table: vendor or depend](#3-table-vendor-or-depend)
4. [Nepal context](#4-nepal-context)
5. [Data model](#5-data-model)
6. [Extraction and resolution](#6-extraction-and-resolution)
7. [Perspectives](#7-perspectives)
8. [Benchmark and scorer](#8-benchmark-and-scorer)
9. [Phased plan](#9-phased-plan)
10. [What not to do yet](#10-what-not-to-do-yet)
11. [Open questions for the owner](#11-open-questions-for-the-owner)
12. [Sources](#12-sources)
13. [Not verified](#13-not-verified)

## 1. Current state

| Piece                | Today                                                                                                                                            | Where                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Prompt               | "receiptDate must be ISO (YYYY-MM-DD) when present". Nothing on calendars or day/month order                                                     | `packages/ai/src/extract.ts` (`PROMPT`)                                                     |
| AI schema            | `receiptDate: z.string().max(32).nullable()`. Any string passes                                                                                  | `packages/ai/src/schema.ts`                                                                 |
| Column               | `receipt_date text`, no index                                                                                                                    | `packages/db/src/index.ts`                                                                  |
| Completion           | Stores the model's string as is                                                                                                                  | `packages/core/src/repository.ts` (`complete`)                                              |
| History filters      | `gte`/`lte` on text. `14/09/26` or a BS year stored as AD silently falls out or sorts last                                                       | `repository.ts` (`filterWhere`)                                                             |
| Dashboard            | A `CASE` guard casts only real `YYYY-MM-DD` values. Otherwise it uses the upload day in the viewer's time zone and counts it as `usesUploadDate` | `packages/core/src/analytics/spend.ts` (`parsedDate`)                                       |
| Dashboard scan bound | `created_at >= windowFrom - 2 days`, which assumes "nothing is dated after it was uploaded". A BS year stored as AD breaks that assumption       | `spend.ts`                                                                                  |
| PATCH                | Checks `^\d{4}-\d{2}-\d{2}$` only (accepts `2026-02-30`)                                                                                         | `apps/web/app/api/receipts/[id]/route.ts`                                                   |
| Editor               | `<input type="date">`, AD only                                                                                                                   | `apps/web/components/receipt-editor.tsx`                                                    |
| Display              | `formatDate` → "27 Oct 2026", fixed locale                                                                                                       | `apps/web/lib/format.ts`                                                                    |
| CSV                  | `receipt_date` as stored text                                                                                                                    | `apps/web/lib/csv.ts`                                                                       |
| Review checklist     | "No date was found." only                                                                                                                        | `components/receipt-result.tsx` (`checksFor`)                                               |
| Time zone            | A cookie holds the browser's IANA zone (`lib/time-zone-cookie.ts`), and the dashboard uses it. No country, region or locale is stored            | `apps/web/lib/spend.ts`                                                                     |
| Benchmark            | `receiptDate` exact match. Truth is AD and the printed date is kept in `_meta.dateShown`                                                         | `bench/score.ts`, [benchmark plan](2026-11-07-receipt-benchmark-set.md#bikram-sambat-dates) |
| BS anywhere          | None                                                                                                                                             |                                                                                             |

**Evidence (2026-11-07, 31 real receipts).** Dates: Haiku 5.5 and Sonnet 5.5 74%, Opus 5.5 87-90%. The `nepal`
slice (6 receipts):

| Receipt        | Printed                                                  | Truth (AD)             | Haiku / Sonnet         | Failure                                         |
| -------------- | -------------------------------------------------------- | ---------------------- | ---------------------- | ----------------------------------------------- |
| Bhat-Bhateni   | BS only: `2080-04-09`, `2080-08-09`                      | 2023-07-25, 2023-11-25 | `null`                 | Saw a BS date and returned nothing              |
| Saathimart     | `10/07/2023` and `07/05/2024` (US order), plus a BS Miti | 2023-10-07, 2024-07-05 | 2023-07-10, 2024-05-07 | Read day-first. The Miti would have settled it  |
| Drishya Lounge | `Date 04/09/2022` and `Miti 26/12/2078`                  | 2022-04-09             | not broken out         | The Miti proves MM/DD (BS 2078-12-26 = 9 April) |

Cost for the slice: Haiku $0.0041, Sonnet $0.081, Opus $0.168 (app prep). All three got currency and total right on
all six. The date is the big gap; subtotal and merchant differ by one receipt at most.

## 2. Bikram Sambat facts

- **No formula.** A BS month runs 29 to 32 days, and the lengths change from year to year. They come from the
  solar-sidereal reckoning in the approved panchang (almanac), so every converter carries a table. Libraries say so
  ([remotemerge README](https://github.com/remotemerge/nepali-date-converter): "BS month lengths vary from year to year
  (29 to 32 days), so the library stores each month's length"). So does
  [this guide](https://dexterhere.github.io/calendar-package-AD-BS/guide/what-is-bs) ("There is no formula to derive
  this"). We found no government page that says it in those words.
- **Who decides.** The Nepal Panchang Nirnayak Bikas Samiti (the name varies by source), constituted by a
  [2077 order](https://lawcommission.gov.np/np/wp-content/uploads/2021/10/नेपाल-पञ्चाङ्ग-निर्णायक-विकास-समिति-गठन-आदेश-२०७७.pdf).
  An [Onlinekhabar notice of 26 Bhadra 2083](https://www.onlinekhabar.com/?p=2015441) (about 11 Sep 2026) asks
  almanac makers to submit their 2084 calculations by 20 Asoj, under the solar method. New makers must submit drafts
  for 2084-2086.
- **How far ahead.** One year, approved within the year before it. As of today (Kartik 2083), **2083 is the last
  official year and 2084 onward are projections in every library**. One library maintainer says approval "usually
  happens around January-February of the year before" ([subeshb1 PR #75](https://github.com/subeshb1/Nepali-Date/pull/75)).
  That claim is unverified.
- **Projections have been wrong recently:**
  - 2081 Jestha was published as 31 days, not 32 ([amitgaru #55](https://github.com/amitgaru/nepali-datetime/pull/55)).
  - 2082 Asar and Shrawan were wrong in several libraries (subeshb1 #64 and #66, py-nepali #81, sharingapples #25 and #27).
  - 2083 had four months fixed in May-June 2026
    ([amitgaru c668263](https://github.com/amitgaru/nepali-datetime/commit/c668263100fa854531021b73d71b3a7180184971),
    [medic #31](https://github.com/medic/bikram-sambat/issues/31)).
  - 2084-2086 were revised on 2026-10-26 ([subeshb1 PR #75](https://github.com/subeshb1/Nepali-Date/pull/75)).
- **Year lengths are 365 or 366 days.** In the reference CSV (amitgaru, BS 1975-2100) 92 years have 365 days, 33 have
  366, and **2096 has 364**, a projection artefact that a structural test would catch.
- **No platform support.** `Intl.supportedValuesOf("calendar")` lists 16 calendars and none is Nepali or Bikram
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/supportedValuesOf)).
  CLDR's calendar list has none either. `indian` is the Saka national calendar, not BS. Temporal follows the same
  list, so neither `Intl` nor Temporal will do this for us.
- **New Year check:** 1 Baisakh 2079 = 2022-04-14 and 1 Baisakh 2081 = 2024-04-13. Both match the scratch converter
  built on the amitgaru table.

### Libraries and their tables

Fetched 2026-11-07 from the npm and PyPI registries and GitHub. Ranges were parsed from each package's published
tarball. "dl/wk" is npm's last-week count.

| Package                                  | Version (date)       | Licence                           | dl/wk  | BS range    | Deps        | Past the table                           | Notes                                                                   |
| ---------------------------------------- | -------------------- | --------------------------------- | ------ | ----------- | ----------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| npm `nepali-date-converter` (subeshb1)   | 3.4.2 (2026-10-29)   | MIT                               | 17,236 | 2000-2090   | none        | Throws                                   | Most used. Revised 2084-2086 on 2026-10-26. Issue #58: updating is hard |
| npm `bikram-sambat` (medic)              | 1.8.1 (2026-06-09)   | Apache-2.0                        | 4,632  | 1970-2090   | `eurodigit` | Throws "No data for year"                | The only documented update process (README)                             |
| npm `@remotemerge/nepali-date-converter` | 1.2.7 (2026-10-31)   | MIT                               | 2,004  | 1975-2099   | none        | Throws, or `toAdOrNull` returns null     | **2081 and 2084-2099 alias earlier years** (`n[2084]=n[1976]`)          |
| npm `bikram-sambat-js`                   | 1.0.3 (2025-08-21)   | MIT                               | 1,734  | not checked | none        | not checked                              |                                                                         |
| npm `@sbmdkl/nepali-date-converter`      | 2.0.5 (2026-05-02)   | MIT                               | 1,527  | 1978-2099   | none        | not checked                              |                                                                         |
| npm `nepali-datetime` (opensource-nepal) | 2.0.0 (2026-04-11)   | **GPL-3.0**                       | 1,106  | 2000-2099   | none        | Throws `DateOutOfRangeError`             | GPL rules it out for us                                                 |
| npm `nepali-date` (sharingapples)        | 0.1.4 (2026-10-26)   | MIT (npm), none on GitHub         | 692    | 2000-2088   | none        | Open issue #26 "only converts till 2088" | README claims 2100                                                      |
| npm `nepali-date-library`                | 1.1.16 (2026-08-11)  | MIT                               | 589    | 1976-2100   | none        | not checked                              | Differs from the reference from 2085 on                                 |
| PyPI `nepali-datetime` (amitgaru)        | 1.0.8.5 (2026-05-07) | MIT on PyPI, Apache-2.0 on GitHub | n/a    | 1975-2100   | none        | not checked                              | Our scratch converter's source. 2062 differs from 8 other tables        |
| PyPI `nepali` (opensource-nepal)         | 1.2.0 (2026-02-02)   | MIT                               | n/a    | 2000-2099   | none        | `ValueError`                             | Pattern values past 2083                                                |
| `ad-bs-converter`, `nepali-calendar-js`  | 2017, 2018           | ISC, MIT                          | small  |             |             |                                          | Stale, ruled out                                                        |

**Where the tables disagree** (all nine parsed tables against amitgaru's CSV):

| BS years  | Finding                                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2070-2083 | **All nine identical**                                                                                                                                                             |
| 2062      | amitgaru `31,31,31,32,…`. The other eight `30,32,31,32,…`. Eight against one, but not checked against a primary source                                                             |
| 2084-2086 | amitgaru, subeshb1, sbmdkl, medic and sharingapples agree. py-nepali, node-nepali-datetime and remotemerge use repeated earlier years. 2084 Baisakh-Jestha `31,31` against `31,32` |
| 2087      | Three groups ([medic #31](https://github.com/medic/bikram-sambat/issues/31)): Nepali Patro matches one, Hamro Patro's sums to 367 days                                             |
| 2088-2100 | Projections everywhere. Ignore                                                                                                                                                     |

## 3. Table: vendor or depend

| Option                                                    | For                                                                                                                                                              | Against                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nepali-date-converter` 3.4.2 (MIT, no deps)              | Most used, maintained, past the 7-day cooldown since 2026-11-05                                                                                                  | A table correction reaches us only as a release we must take, review and wait 7 days for. Its projected years changed two weeks ago. It throws past 2090. We still need our own parser, Nepali month names, range policy and "official through" marker |
| `bikram-sambat` (Apache-2.0)                              | Documented update process                                                                                                                                        | Adds a dependency (`eurodigit`). Same release lag                                                                                                                                                                                                      |
| **Vendored table + ~80 lines of converter (recommended)** | No supply chain. Exact control of the range and of "official vs projected". A fix is a one-row PR, with no cooldown. Shared by web (client-safe), core and bench | We own the yearly update. Mitigated by a CI canary and a runbook step (below)                                                                                                                                                                          |

**Recommendation: vendor.** Under this repo's rules (minimal deps, exact pins, a 7-day cooldown, packages as code we
review), a 1.5 KB fact table we can test exhaustively beats a dependency. Speed matters most for exactly this kind
of fix: a correction to the current year's row.

How:

- `packages/core/src/calendar/bs-table.ts`: `BS_FIRST_YEAR = 2000`, `BS_OFFICIAL_THROUGH = 2083`, one row per year
  to 2090 (rows after `OFFICIAL_THROUGH` are marked projected), and the anchor `1 Baisakh 2000 = 1943-04-14`, derived
  and checked in a test. Values for 2070-2083 are the nine-way consensus. For 2000-2069, take the majority and record
  2062 as checked against a second source when the PR is written.
- `packages/core/src/calendar/bs.ts`: `bsToAd`, `adToBs`, `bsMonthRange(year, month)` (an AD range),
  `fiscalYearRange(fy)`, `isOfficial(year)`, plus month names (romanised and Devanagari). Day arithmetic only, from
  prefix sums. Exported as a client-safe subpath, `@receipt-ocr/core/calendar` (the `@receipt-ocr/core/telemetry`
  precedent), so the editor, the benchmark and core share one implementation.
- **Data provenance in the file header:** which sources, the commit, the date checked and the facts-only rationale.
  Month lengths are facts. Attribute the tables we compared against anyway, and check licences again at the time:
  amitgaru's licence differs between PyPI and GitHub.
- **Yearly update** (runbook entry): when the Samiti approves year N+1 (expected around Magh-Chaitra of year N),
  diff our row against two of Hamro Patro, Nepali Patro and rat32, update it, bump `BS_OFFICIAL_THROUGH`, and run the
  re-resolution job (§5.4) for receipts whose evidence used that year. **CI canary:** a test fails when today + 120
  days falls after the last day of `BS_OFFICIAL_THROUGH`, so the update can't be forgotten. It also fails when a row
  past `OFFICIAL_THROUGH` exists but is not marked projected.
- Dates in projected years: convert them, but set `receipt_date_check` to at least `ambiguous`. For a receipt this
  only happens when the date is in the future, which the plausibility rule rejects anyway.

## 4. Nepal context

- **Fiscal year: 1 Shrawan to the end of Asar.** The Income Tax Act 2000 defines the income year this way (via
  [LookupTax](https://lookuptax.com/docs/country/nepal-vat-guidelines-indirect-tax), which also gives the FY 2083/84
  start). Our table gives **FY 2082/83 = 2025-07-17 to 2026-07-16** and **FY 2083/84 = 2026-07-17 to 2027-07-16**.
  The LookupTax start date (17 July 2026) matches our table, which independently checks 2082. The 2083/84 end uses
  2084 Asar, still a projection.
- **VAT returns are monthly by BS month**, due within 25 days of the month's end, with a four-monthly option for
  small taxpayers (LookupTax; an [IRD SOP](https://ird.gov.np/public/pdf/1112838743.pdf) confirms that the period
  follows registration). So an accountant's natural export is "Kartik 2083" or "FY 2082/83", not "October".
- **Invoices.** A "date of transaction" is mandatory on a VAT invoice
  ([Kathmandu Post](https://kathmandupost.com/money/2019/06/17/new-tax-rule-to-fine-customers-who-do-not-receive-vat-bill-while-buying-goods)).
  The IRD Central Billing Monitoring System (CBMS) API takes `invoice_date` as a dotted BS date (`"2074.07.06"`) and
  `fiscal_year` as `"2073.074"`
  ([field list from IRD sample code](https://discuss.frappe.io/t/central-billing-monitoring-system-api-documentation-for-nepal/34814)).
  An [Odoo CBMS module](https://apps.odoo.com/apps/modules/19.0/l10n_np_cbms_ebilling) converts AD to BS for it.
  **We could not read the VAT Rules text** (Rule 17 and Schedules 5, 5A and 6, amended in 2024) that would say
  whether a printed invoice must show BS, AD or either. The owner's receipts show all three patterns: BS only, AD plus
  Miti, and both labelled.
- **Accounting tools offer both calendars.** TallyPrime in Nepal sells "Nepali Miti support"
  ([Tally](https://tallysolutions.com/global/tally-prime-in-nepal/)). Karobar advertises a BS/AD switch, and Odoo has
  a "Nepali Date System" module. Their defaults aren't stated. The pattern we copy: store one date, let the user pick
  the calendar.
- **How POS receipts print dates.** We found no published evidence. Our only data is the owner's receipts: AD
  numeric dates in US order (Saathimart, Drishya) and BS-only dates with Latin digits (Bhat-Bhateni). So **no
  "Nepal means DD/MM" or "Nepal means MM/DD" rule**. Treat a Nepal AD numeric date as ambiguous unless something
  settles it.

Implications: the export needs BS-month and fiscal-year presets. The dashboard needs BS months for users who chose
BS. `date_bs` in the CSV should follow the CBMS-style dotted form.

## 5. Data model

### 5.1 Principles

- **A receipt date is a floating (plain) date**, a calendar day with no time zone. The W3C note
  [Working with Time and Timezones](https://www.w3.org/TR/timezone/) (§3.4.3, §4.2.4) uses "floating time" for values
  that "need to stay constant, regardless of the viewing user's time zone". Temporal's `PlainDate` "represents a
  calendar date … independent of any time zone"
  ([Temporal docs](https://tc39.es/proposal-temporal/docs/plaindate.html)). Postgres `date` is that type: 4 bytes,
  1-day resolution, Gregorian
  ([docs](https://www.postgresql.org/docs/current/datatype-datetime.html)). E-invoicing standards do the same: Peppol
  BIS `cbc:IssueDate` (BT-2) is `YYYY-MM-DD`
  ([Peppol](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/cbc-IssueDate/)).
- **The calendar is presentation.** Temporal stores an ISO date and projects it with `withCalendar()`. We store the
  ISO date and project it to BS with our table.
- **Keep the evidence beside the normalised value**, the pattern document-AI vendors use. Google Document AI returns
  `normalizedValue` next to `mentionText`, which "is never changed by normalization"
  ([docs](https://docs.cloud.google.com/document-ai/docs/normalization)). Azure's receipt model returns
  `TransactionDate` as a typed `yyyy-mm-dd`
  ([docs](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt)). For us the
  evidence is `raw_json.dates[]`, already untouched by edits.
- **"Today" is the viewer's day.** The plausibility rule ("not after the upload day") uses the upload day in the
  uploader's time zone (the existing cookie, UTC by default) plus one day of slack. Nepal is UTC+05:45, so an upload
  at 01:00 local is still the previous day in UTC.

### 5.2 Columns

```sql
-- receipts
receipt_date        date null,      -- AD, canonical. Null = no usable date (the dashboard uses the upload day, as today)
receipt_date_check  text null       -- how it was settled; null for receipts that never completed
  check (receipt_date_check in ('agree','single','ambiguous','conflict','implausible','none','user')),
-- index for History date filters, BS-month and fiscal-year ranges, and sorting by date
create index receipts_org_receipt_date_idx on receipts (organization_id, receipt_date);
```

| `receipt_date_check` | Meaning                                                               | Review                    |
| -------------------- | --------------------------------------------------------------------- | ------------------------- |
| `agree`              | AD and BS were both printed and convert to the same day               | No warning                |
| `single`             | One printed date with one valid reading                               | No warning                |
| `ambiguous`          | Several valid readings, none settled (e.g. `04/09/2022` with no Miti) | Warning: "Check the date" |
| `conflict`           | AD and BS printed but no reading of one matches the other             | Warning, names both       |
| `implausible`        | Every reading is in the future or before 2000. Date set to null       | Warning                   |
| `none`               | No date printed                                                       | Existing "No date found"  |
| `user`               | A person set or confirmed it                                          | Clears date warnings      |

Not stored: `receipt_date_bs` (derived), the calendar a user typed (the BS display preference already covers it),
or `datesAsPrinted` as a column (`raw_json`). Raw text stays out of logs, as receipt content always does.

**Receipt time** (`time` without time zone) is useful for duplicate detection, but it is a separate decision. The
model can return it inside `dates[]` text today at no cost. Add a column when duplicate detection needs it.

### 5.3 Migration from text

The databases were just reset to the squashed baseline and real data is minimal. Still, write it as if there were
data, because from the first real user onward we never squash:

1. Add `receipt_date_d date` and `receipt_date_check`.
2. SQL backfill: copy only text that is a real calendar day in `YYYY-MM-DD` form (the `spend.ts` `CASE` guard) and is
   not after `created_at + 1 day`. Set `check = 'single'` for those. Leave the rest null.
3. A one-off job (TypeScript, on the jobs queue, so it is recorded) for the leftovers and for rows whose year is
   ≥ 2060 or whose currency is NPR. It re-runs the resolver over `raw_json`: it understands BS stored as AD
   (`2080-04-09` → 2023-07-25) and `14/09/26`, and sets the check accordingly.
4. Swap the columns in the next release, after the new code has written both, as the FX plan describes. Drop the
   `CASE` guard in `spend.ts` once the column is `date`.
5. Down path: `date::text` gives back the same ISO strings, so the rollback loses nothing.

### 5.4 Re-resolution after a table fix

Because `raw_json.dates` keeps what was printed, a corrected row for year N can re-derive the AD date of every
receipt that printed a BS date in year N and was not set by a user (`check <> 'user'`). It is a job kind
(`receipt.redate`) with a dry-run count first. Receipts that printed only AD never change.

## 6. Extraction and resolution

### 6.1 Schema change (`packages/ai/src/schema.ts`)

```ts
dates: z.array(z.object({
  text: z.string().max(40),                      // exactly as printed, digits as printed (Devanagari allowed)
  label: z.string().max(40).nullable(),          // "Date", "Miti", "मिति", "Bill Date"; null if unlabelled
  calendar: z.enum(["gregorian", "bikram_sambat", "unknown"]),
  role: z.enum(["transaction", "other"]),        // other: due, expiry, printed-at, delivery
})).max(6),
receiptDate: z.string().max(32).nullable(),      // kept: the model's own AD reading, used only as a tie-breaker
```

- `maxItems` is stripped for Gemini Flash-Lite (`receiptRequestSchema`) and still enforced on the reply, as for
  `items`.
- Prompt lines, replacing today's date sentence: "List every date printed on the receipt in `dates`, copied exactly
  as printed, with its label. Nepali receipts often print a Bikram Sambat date (BS, labelled Miti or मिति, years 2000
  to 2100) next to or instead of a Gregorian one. Mark the calendar if the label or year shows it. Do not convert
  between calendars. Mark the transaction date's role `transaction`. In `receiptDate`, give your best Gregorian
  reading as YYYY-MM-DD, or null." A prompt change goes through the benchmark before it ships (§8).
- No structured day/month/year from the model. Asking it to split a date is what makes it pick an order. Code
  parses `text` deterministically, and the model's `receiptDate` remains as a hint.

### 6.2 Resolver (`packages/core/src/calendar/resolve.ts`, pure)

`resolveReceiptDate(dates, { modelReading, uploadDay, currency, country, orderHint }) → { date, check, reason }`

1. **Normalise.** NFC. Devanagari digits U+0966-U+096F → 0-9. Separators `/ - . ,` and spaces. Month names:
   English (`Jul`, `July`), romanised BS (Baisakh/Baishakh/Vaisakh, Jestha/Jeth, Asar/Ashadh/Asadh,
   Shrawan/Saun/Saaun, Bhadra/Bhadau, Asoj/Ashwin/Aswin, Kartik/Kattik, Mangsir/Mansir/Marga, Poush/Paush/Push, Magh,
   Falgun/Fagun, Chaitra/Chait) and Devanagari (बैशाख, जेठ, असार, साउन, भदौ, असोज, कात्तिक, मंसिर, पुष, माघ,
   फागुन, चैत, plus the formal spellings).
2. **Readings.** For each `transaction` date: YMD, DMY and MDY, each in AD and in BS, filtered by the year:
   - A 4-digit year ≥ 2060 is BS. AD 2060 is 34 years away, and BS years run AD + 56/57, so the two never overlap
     for receipts.
   - A 2-digit `yy` ≥ 60 is BS (20yy). `yy` ≤ the current AD `yy` is AD.
   - A label (Miti/मिति/B.S./वि.सं.) or the model's calendar narrows further. The label wins over the model.
3. **Validity.** The month is 1-12 and the day is within that month's length in that calendar (BS from the table).
   Years outside the table's range are invalid.
4. **Plausibility.** The AD equivalent is ≤ upload day + 1 and ≥ 2000-01-01. A date more than 3 years before the
   upload passes with `ambiguous`. That bound is an owner choice (Q4).
5. **Cross-check.** When a BS and an AD date are both printed, keep the reading pairs where `bsToAd(bs) == ad`.
   Exactly one pair → `agree`. If the pair is off by ±1 day, treat it as `conflict` but take the AD date. We have no
   evidence for which side POS software gets wrong, so this needs data (Q6).
6. **Single date.** One surviving reading → `single`. Unambiguous numbers (`25/07/2023`: 25 > 12) land here.
7. **Several readings left.** Pick by, in order:
   - the workspace's learned order (a later phase: the order of the last N `agree` or user-confirmed receipts from
     the same merchant);
   - the model's `receiptDate` if it is one of the readings;
   - the locale prior: MDY for US and PH, DMY for most other countries, none for NP.

   Then mark it `ambiguous`. Ambiguity is shown, never hidden.

8. **No `transaction` date:** fall back to the model's `receiptDate` if it validates → `single`. Otherwise `none`.

Hints come from data we already have or that the FX plan adds: the currency (NPR, USD), the FX plan's `country` in
`raw_json` (PR 5 there) and the uploader's time zone. None needs a new stored field.

### 6.3 Review state

The resolver's `check` feeds the [review-state plan](../reviews/2026-11-07-review-state-and-flagging.md):

- `ambiguous`, `conflict` and `implausible` add a checklist line in `checksFor` with the readings: "This receipt
  prints 04/09/2022. Is it 4 Sep or 9 Apr?" There are one-tap buttons for the two readings, and both buttons set
  `check = 'user'`.
- They count as "with warnings" in To review, and they block the planned auto-review.
- The flag reason `wrong_date` already exists. Saving a date marks the receipt reviewed, as the plan says.
- The model's self-reported `confidence` stays separate. The date check is deterministic and per field, which is the
  per-field signal the review plan said was missing.

## 7. Perspectives

### 7.1 Product and UX

- **Nepali users:** "Both" by default: `25 Jul 2023 · 9 Shrawan 2080`, romanised month names and Latin digits, which
  is how the owner's receipts print. History and Home use the same format. Filters offer "This BS month", "Last BS
  month" and "FY 2082/83".
- **Everyone else:** nothing changes. AD only, and BS never appears unless a receipt printed it. Then the receipt page
  shows "Printed: Miti 26/12/2078" under Evidence, which is honest about where the date came from.
- **Setting:** Settings → Preferences → "Dates: AD / BS / Both", per user, stored on the user (a small
  `user.date_display` column, null = automatic).
- **Editing:** a calendar toggle next to the date. In BS mode, a text field `2080-04-09` with a live preview and
  validation against the table ("Shrawan 2080 has 32 days").

### 7.2 Accountant and export

- CSV adds `date_bs` (`2080.04.09`, empty when there is no date) next to `receipt_date` (ISO AD, unchanged) and a
  `date_check` column. Both item and receipt CSVs get them, in the same position.
- Export presets: BS month, Nepal fiscal year, plus the existing AD range. Each is converted to an AD range in core.
- **Spreadsheet behaviour is to be checked (§13).** Excel may parse `2080-04-09` as a Gregorian date in 2080 and then
  show a day 32 (`2081-03-32`) as text, giving a mixed column. Test Excel and Google Sheets with a dotted and a dashed
  value before choosing.
- A "Fiscal year" column (`2082/83`) only if an accountant asks: it is derivable from `date_bs`.

### 7.3 Engineering simplicity and tests

- One table, one converter, one resolver, all pure functions in a client-safe module. No new dependency.
  **`fast-check` 3.23.2 is already in the lockfile** through `effect` (re-exported as `FastCheck`), so property tests
  add nothing.
- Tests:
  - **Structure:** every month is 29-32 days and every year 365 or 366. This would have caught 2096 = 364.
  - **Anchor:** re-derived from a second reference, as the scratch script does from 1 Baisakh 1975 = 1918-04-13.
  - **Round trip:** every day across the range, `adToBs(bsToAd(x)) == x` and the other way. Exhaustive, about 33,000
    days, well under a second.
  - **Monotonic:** consecutive AD days map to consecutive BS days.
  - **Golden pairs:** 1 Baisakh for 2070-2083 against a published list; the owner's receipts (Saathimart Miti
    2080-06-20 = 2023-10-07, 2080-10-15 = 2024-01-29; Bhat-Bhateni 2080-04-09 = 2023-07-25, 2080-08-09 =
    2023-11-25; Drishya 2078-12-26 = 2022-04-09); FY 2083/84 starts 2026-07-17 (LookupTax).
  - **Resolver tables:** each row of §1's evidence; `07/05/2024` alone → ambiguous; `13/05/2024` → single; BS stored
    as AD → BS; a Devanagari `२०८०/०४/०९`; a future date → implausible; a ±1-day Miti → conflict.
  - **Parser fuzz** (fast-check strings ≤ 40 chars): never throws and is linear (simple regexes, no backtracking).
  - **Canary:** the official-years test from §3.

### 7.4 Performance

- A BS month and a fiscal year are each one contiguous AD range, so filters are an index range scan on
  `(organization_id, receipt_date)`. Nothing per row, and no BS column needed.
- Dashboard BS months: core computes the 12 BS month starts as AD dates and passes them as one array.
  `width_bucket(eff, $1::date[])` assigns buckets
  ([Postgres](https://www.postgresql.org/docs/current/functions-math.html): thresholds of "any type having standard
  comparison operators"). That is one extra argument instead of `date_trunc('month', …)`, at the same cost.
- The converter is a binary search over prefix sums (about 1,100 months). Microseconds; no cache.
- The dashboard's `created_at` scan bound stays valid, because implausible future dates are rejected at completion.

### 7.5 i18n

- Accept Devanagari digits and month names everywhere input arrives: OCR text, the editor and URL params, which go
  through the same parser. Display Latin digits and romanised months by default.
- Devanagari display (`९ साउन २०८०`) belongs with a Nepali-language UI, not before it. It is a formatting change in
  one function when it comes.
- `Intl` can't format BS (§2), so the formatter is ours. The AD part keeps using `Intl.DateTimeFormat`.
- Romanisation: pick one display spelling (Baisakh, Jestha, Asar, Shrawan, Bhadra, Asoj, Kartik, Mangsir, Poush,
  Magh, Falgun, Chaitra) and accept every common variant on input.

### 7.6 Security and abuse

Little new surface: validation and bounds.

- Zod on the PATCH body `{ receiptDate, calendar: "ad" | "bs" }`. The BS date must be inside the table. AD must be in
  2000..today + 1.
- Length caps on `dates[]` text and label, and an array cap (6).
- A crafted image can at most produce an `ambiguous` date. It cannot write a future date or an out-of-range year.
- Telemetry: `receipt.date_check` (enum) and `receipt.date_calendars` (`gregorian+bikram_sambat`), no date values.
  Both go into `telemetry/schema.ts` and the PR's field audit (source: the resolver; PII: no).

### 7.7 Migration and backfill

See §5.3 and §5.4. Order matters: the column type change ships first, so new completions write a validated date
before the resolver exists. The resolver then improves which date gets written.

### 7.8 Cost

| Option                           | Nepal dates (6) | Cost per slice                       | Per 1,000 receipts (pro rata) |
| -------------------------------- | --------------- | ------------------------------------ | ----------------------------- |
| Haiku 5.5, today's prompt        | 1               | $0.0041                              | ≈ $0.68                       |
| Opus 5.5, today's prompt         | 4-5             | $0.168                               | ≈ $28                         |
| Haiku 5.5 + `dates[]` + resolver | to measure      | ≈ $0.0045 (a few more output tokens) | ≈ $0.75                       |

The Haiku misses inspected so far are BS-as-null or the order. The resolver fixes the first by conversion and the second where a
Miti is printed (Saathimart). It turns the rest into honest `ambiguous` flags rather than silent errors. The claim to
test: Haiku plus the resolver matches or beats Opus on dates at about 1/40 of the cost. The slice is 6 receipts, so
confirm on the owner's 40 before changing the production chain.

## 8. Benchmark and scorer

- **Truth.** `receiptDate` stays the AD truth. Add optional `receiptDateBs` truth (as printed, when printed) and
  `dateOrder` (`dmy`/`mdy`/`ymd`) to the answer key.
- **Scoring:**
  - `receiptDate` is scored on the **resolved** date, the one the app stores. The benchmark runs the same resolver
    (`@receipt-ocr/core/calendar`).
  - New `receiptDateBs`: the BS date the app would show equals the printed one. Score it only when it was printed.
  - New `dateTranscription`: some `dates[].text` normalises to the printed truth.
  - `dateCheck` calibration: share of `ambiguous`/`conflict` flags on receipts whose resolved date was wrong (good)
    and on receipts that were right (noise).
- **Diagnostics,** already planned: "BS returned as AD" (year ≥ 2070 on NPR). Add "order swapped" (the prediction is
  the truth with day and month swapped) and "null when a date was printed".
- **Report** per slice (`nepal`, `cord`, `commons`, `web`), before and after, for Haiku, Sonnet, Opus, Gemini 3.8
  Flash and 3.5 Flash-Lite, attached to the extraction PR.

## 9. Phased plan

| PR  | Scope                                                                                                                                                                                          | Estimate | Depends on |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- |
| 1   | `@receipt-ocr/core/calendar`: vendored table, converter, month names, parser, fiscal-year and month ranges; the full test suite and canary; runbook entry; `docs/architecture/core.md`         | 1.5 d    | none       |
| 2   | `receipt_date` → `date` + `receipt_date_check` + index (FX plan PR 1c folded in); completion validates (plausibility); PATCH with Zod; backfill job; `spend.ts` guard removed; `data-model.md` | 1.5 d    | 1          |
| 3   | Extraction: `dates[]` schema and prompt, resolver at completion, `checksFor` lines and one-tap readings, telemetry fields; benchmark answer keys and scorer; **before/after run attached**     | 2-2.5 d  | 1, 2       |
| 4   | Display and editing: `user.date_display`, automatic default, `formatReceiptDate` with AD/BS/both, editor calendar toggle, CSV `date_bs` and `date_check`                                       | 1.5-2 d  | 1, 2       |
| 5   | Nepal periods: BS-month and fiscal-year presets in History and export; dashboard months in BS when chosen (`width_bucket`)                                                                     | 1.5 d    | 4          |
| -   | Later: learned order per merchant (with the review plan's "remember corrections"), `receipt_time`, Devanagari display                                                                          | -        | -          |

About 8-9 days in total. PRs 3 and 4 can run in parallel. PR 3 ships only if the benchmark shows no date regression on
the non-Nepal slices.

## 10. What not to do yet

- **Nepali-language UI** (strings, Devanagari digits, ne-NP number formats). It is a separate i18n project and no
  user has asked for it.
- **A BS date picker.** Typed BS with a preview covers correction. A picker means a calendar grid fed by our table
  plus accessibility work. Revisit if users enter many dates by hand.
- **A stored BS column**, or a BS calendar table in Postgres. Derive BS in code; a SQL lookup table would be a second
  copy of the data to keep in sync.
- **Trusting the model to convert BS** (today's implicit behaviour) or asking it for structured day/month/year.
- **A country-wide order rule for Nepal.** The evidence is three receipts from two shops.
- **Other calendars** (Hijri on Gulf receipts, Thai Buddhist, Japanese era). Same design, different table. Wait for a
  fixture that needs one; Thai and Japanese are in `Intl` already.
- **Receipt time columns**, until duplicate detection needs them.

## 11. Open questions for the owner

1. **No stored BS column**, BS derived from AD, printed BS kept in `raw_json`. Agree? Or do you want `receipt_date_bs`
   for SQL users or external tools anyway?
2. **Display default:** "Both" for an `Asia/Kathmandu` time zone or NPR home currency, AD otherwise? Per user, or per
   workspace as with the home currency?
3. **Conflict policy:** when a printed AD and Miti disagree, keep AD and flag it (recommended), or keep BS?
4. **Plausibility window:** reject after upload + 1 day and before 2000; flag older than 3 years. Right bounds?
5. **CSV `date_bs` format:** dotted `2080.04.09` (CBMS style, recommended pending the spreadsheet check) or dashed
   `2080-04-09`?
6. Can you photograph a few more receipts that print **both** dates? Ten would show whether POS software prints the
   Miti off by a day and whether US order is general, and they become golden cases.
7. **Fiscal-year presets** for everyone, or only when BS display is on?

## 12. Sources

Fetched 2026-11-07.

- Libraries (registry JSON, GitHub API, tarball tables): npm `nepali-date-converter`
  ([subeshb1/Nepali-Date](https://github.com/subeshb1/Nepali-Date), [PR #75](https://github.com/subeshb1/Nepali-Date/pull/75)),
  [`bikram-sambat`](https://github.com/medic/bikram-sambat) ([#31](https://github.com/medic/bikram-sambat/issues/31)),
  [`@remotemerge/nepali-date-converter`](https://github.com/remotemerge/nepali-date-converter),
  [`@sbmdkl/nepali-date-converter`](https://github.com/sbmdkl/nepali-date-converter),
  [`nepali-datetime` (npm, GPL-3.0)](https://github.com/opensource-nepal/node-nepali-datetime),
  [`nepali-date`](https://github.com/sharingapples/nepali-date),
  [`nepali-date-library`](https://github.com/SandipGhimire/Nepali-Date-Library-NodeJS),
  [`nepali-datetime` (PyPI)](https://github.com/amitgaru/nepali-datetime) (2083 fix
  [c668263](https://github.com/amitgaru/nepali-datetime/commit/c668263100fa854531021b73d71b3a7180184971), 2081
  [#55](https://github.com/amitgaru/nepali-datetime/pull/55)), [`nepali` (PyPI)](https://github.com/opensource-nepal/py-nepali).
- Calendar authority: [Onlinekhabar, 2084 patro calculations](https://www.onlinekhabar.com/?p=2015441);
  [2077 committee order (Law Commission PDF)](https://lawcommission.gov.np/np/wp-content/uploads/2021/10/नेपाल-पञ्चाङ्ग-निर्णायक-विकास-समिति-गठन-आदेश-२०७७.pdf) (not opened);
  [BS guide](https://dexterhere.github.io/calendar-package-AD-BS/guide/what-is-bs);
  [Vikram Samvat (en.wikipedia)](https://en.wikipedia.org/wiki/Vikram_Samvat) and
  [विक्रम सम्वत् (ne.wikipedia)](https://ne.wikipedia.org/wiki/विक्रम_सम्वत्) (month names);
  [Devanagari numerals](https://en.wikipedia.org/wiki/Devanagari_numerals) (code points checked with Python's `unicodedata`).
- Platform: [MDN `Intl.supportedValuesOf`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/supportedValuesOf),
  [CLDR calendar.xml](https://raw.githubusercontent.com/unicode-org/cldr/main/common/bcp47/calendar.xml),
  [Temporal PlainDate](https://tc39.es/proposal-temporal/docs/plaindate.html),
  [Temporal calendars](https://tc39.es/proposal-temporal/docs/calendars.html).
- Nepal tax: [LookupTax Nepal VAT](https://lookuptax.com/docs/country/nepal-vat-guidelines-indirect-tax),
  [IRD SOP PDF](https://ird.gov.np/public/pdf/1112838743.pdf),
  [Kathmandu Post 2019](https://kathmandupost.com/money/2019/06/17/new-tax-rule-to-fine-customers-who-do-not-receive-vat-bill-while-buying-goods),
  [CBMS API fields (Frappe forum)](https://discuss.frappe.io/t/central-billing-monitoring-system-api-documentation-for-nepal/34814),
  [Odoo CBMS module](https://apps.odoo.com/apps/modules/19.0/l10n_np_cbms_ebilling),
  [Tally in Nepal](https://tallysolutions.com/global/tally-prime-in-nepal/),
  [Notary Nepal VAT rules](https://notarynepal.com/blog/vat-rules-in-nepal).
- Modelling: [W3C Working with Time and Timezones](https://www.w3.org/TR/timezone/),
  [Postgres date/time types](https://www.postgresql.org/docs/current/datatype-datetime.html),
  [Postgres `width_bucket`](https://www.postgresql.org/docs/current/functions-math.html),
  [Peppol `cbc:IssueDate`](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/cbc-IssueDate/),
  [Document AI normalisation](https://docs.cloud.google.com/document-ai/docs/normalization),
  [Azure receipt model](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt).

## 13. Not verified

- The VAT Rules 2053 text (Rule 17 and 18, Schedules 5, 5A and 6, and the 2024 amendment): whether a printed (or
  abbreviated) tax invoice must show BS, AD or either, and the abbreviated-invoice threshold (sources say Rs 500 and
  Rs 10,000). The Law Commission page returned 404 and bizsewa returned 403.
- An official MoF, IRD or NRB page for the fiscal-year rule and the 25-day VAT deadline. Both rest on LookupTax and
  secondary guides.
- That the CBMS `invoice_date` is formally specified as BS. The forum sample implies it.
- How Nepali POS software prints dates in general: order, Miti, Devanagari digits. Only the owner's receipts.
- The amitgaru 2062 row (8 of 9 tables disagree with it) and amitgaru's licence (MIT on PyPI, Apache-2.0 on GitHub).
- When the Samiti approves the next year ("Jan-Feb of the prior year" is one maintainer's claim).
- Past-the-table behaviour of `@sbmdkl`, `nepali-date-library` and `bikram-sambat-js`, and PyPI download counts.
- Devanagari formal month spellings (वैशाख, ज्येष्ठ, आषाढ, श्रावण, भाद्र, आश्विन, कार्तिक, मार्गशीर्ष, पौष,
  फाल्गुन, चैत्र) were written from memory. The colloquial list in §6.2 is from ne.wikipedia.
- How Excel and Google Sheets import `2080-04-09` and `2080.04.09` from CSV.
- That `effect` 3.22.4 exports `FastCheck` (the lockfile shows `fast-check` as its dependency; not checked in
  `node_modules`, which is not installed in this worktree).
- The Haiku-plus-resolver accuracy in §7.8 is a hypothesis until the PR 3 run.
