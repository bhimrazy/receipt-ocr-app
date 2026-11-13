# Receipt dates and Bikram Sambat

How a receipt's date is decided, stored and shown, and how the Bikram Sambat (BS) month table is kept current.
The code is in [`packages/calendar`](../../packages/calendar); the columns are in the
[data model](data-model.md). Background and the decisions behind it:
[dates and fields research](../reviews/2026-11-12-dates-and-fields-research.md) and the
[extraction review](../reviews/2026-11-12-extraction-review.md#decision-table-resolver-packagescore-pure).

## Contents

1. [Storage and display](#storage-and-display)
2. [The month table](#the-month-table)
3. [Yearly table update (runbook)](#yearly-table-update-runbook)
4. [Resolving a printed date](#resolving-a-printed-date)
5. [Migration 0003 rollout](#migration-0003-rollout)

## Storage and display

- `receipts.receipt_date` is the only stored date: a Gregorian (AD) `date`.
- `receipt_date_calendar` records the calendar the receipt printed. It is `gregory`, or `bikram-sambat` when a BS
  date was printed, alone or beside an AD one. Null means unknown and reads as `gregory`.
- BS is never stored. It is `adToBs(receipt_date)`, computed wherever it is shown or exported.
- A BS receipt shows `9 Shrawan 2080 · 25 Jul 2023`. Every other receipt shows the AD date only.
- The CSV writes `receipt_date_bs` (`2080.04.09`) only for BS receipts.

## The month table

BS has no formula. Each year's month lengths (29 to 32 days) come from the almanac that the Nepal Panchang
Nirnayak Bikas Samiti approves, one year ahead. [`bs-table.ts`](../../packages/calendar/src/bs-table.ts)
covers BS 2056 to 2090. Receipts can't be dated before 2000-01-01 (Poush 2056), so earlier years are left out.

**Provenance, checked 2026-11-12.** Month lengths are facts. These three tables were compared year by year:

- subeshb1/Nepali-Date, `src/date-config.ts` at `f14e039` (MIT, npm `nepali-date-converter`)
- medic/bikram-sambat, `test-data/daysInMonth.json` at `aeaa7b8` (Apache-2.0)
- amitgaru/nepali-datetime, `nepali_datetime/data/calendar_bs.csv` at `83bb3b2` (PyPI `nepali-datetime`)

All three agree on every row except 2062 and 2087. In both, amitgaru is the outlier, so those rows take the value
of the other two. All three put 1 Baisakh 2056 on 1999-04-14, the anchor. medic's 10,227 reference pairs from BS to
AD for 2056 to 2083 all match the table, and the unit tests carry a sample.

**Approved and projected years.** Rows after `BS_OFFICIAL_THROUGH` (2083) are projections. Libraries have
corrected projected rows after release before: 2081, 2082 and 2083 each changed. A date the resolver places in a
projected year gets `date_ambiguous`.

## Yearly table update (runbook)

Due before 2027-04-14, when BS 2084 begins. From that day the guard test in `packages/calendar/tests/bs.test.ts` fails, because today is
past the last day of `BS_OFFICIAL_THROUGH`.

1. Once the Samiti approves year N+1, take its month lengths from two published almanacs (Hamro Patro, Nepali
   Patro) and check that they agree.
2. Replace that year's row in `bs-table.ts` and bump `BS_OFFICIAL_THROUGH`.
3. Update the provenance above with the sources and the date.
4. If the row changed, receipts that printed a date in that year may now be a day off. Re-resolve them from
   `raw_json.dates`. That job is not built yet; it is on the roadmap in [STATUS](../STATUS.md).

## Resolving a printed date

`resolveReceiptDate` turns what the receipt printed into one AD day, its calendar and the date review reasons. It is
a pure function: the same input always gives the same answer. The model copies dates as printed, and this function
decides.

- **Order of operations.** Times are removed first. Then Devanagari digits and month names are normalised, and
  fiscal-year tokens (`2081/82`, `081/82`, `80/81`) are set aside: they are not dates, but they bound the date.
  Then the readings are listed, checked against the bounds, cross-checked between calendars, and a tie is broken.
- **The year settles the calendar.** Inside the bounds (2000-01-01 to the upload day + 1), an AD year (2000 to the
  upload year) and a BS year (2056 on) can't overlap.
- **Day and month order.** Year-first is read YMD. Year-last is read DMY or MDY in AD, and DMY only in BS: no BS
  receipt seen so far prints MDY. A month name settles both its calendar and the order.
- **BS dates** are converted with the table. The calendar is `bikram-sambat` whenever a BS date was printed, even
  an invalid one.
- **Both AD orders valid.** The model's reading is kept if it is one of them, else day first. The date gets
  `date_ambiguous`.
- **AD and BS printed but disagreeing:** `date_conflict`. On an NPR bill the BS date wins. Otherwise the AD date
  wins, and it also wins when the BS date isn't a valid day.
- **Also `date_conflict`:** a label that contradicts the year (`मिति 2024-…`), and a date outside a fiscal year
  printed on the receipt or in its bill number.
- **Nothing inside the bounds:** a null date and `date_implausible`.
- **Also `date_ambiguous`:** a date more than 3 years before the upload, and a BS date in a projected year or past
  the end of the table.
- **No `dates` from the model.** Extraction before v3 returns only the model's own AD reading. That reading goes
  through the same rules. Its calendar is null unless its year shows it is BS.

## Migration 0003 rollout

Order: run `0003_receipt_fields` on staging, then on production, both through the Database Migration workflow. Then
deploy production by hand straight away.

The migration is additive, and code from before it ignores the new columns. Receipts that old code completes in the
minutes between the migration and the deploy get:

- `review_reasons '{}'`, even when the old rule (confidence below 0.9) would have flagged them;
- every line item at `position` 0.

The read path tolerates the second: items are read `ORDER BY position, ctid`, so lines that all have position 0
come back in insertion order, which is printed order. For the first, the 0003 `low_confidence` backfill is
idempotent and can run again after the deploy. `0004_billing_checkouts` validates the 0003 CHECKs and repeats it.
