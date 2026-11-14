# Receipt data and review: what paying users need next (2026-11-14)

Product view, read-only, on `main` at `f8d76be`. It answers the owner's four questions about line editing, merchant
fields, confidence and the review-to-export loop. The data model and API are the CTO review's; the receipt page and
line-editing UX are the designer's. This review builds on the
[receipt fields review](2026-11-12-receipt-fields-review.md), the
[dates and fields research](2026-11-12-dates-and-fields-research.md) and the
[2026-11-06 CEO](2026-11-06-ceo.md) and [market](2026-11-06-market.md) reviews. No server or build was run. Outside
sources were opened 2026-11-14 and are listed at the end.

## Verdict

- **Totals-level correctness is what people pay for; lines matter for one job.** The four target jobs (VAT purchase
  register, accountant handoff, expense claims, budgeting) all run on header fields. Line items matter where a line
  is the reason the totals don't add up, and in the per-receipt items CSV. Build a minimal line editor (name, line
  amount, delete, add), but after the purchase-register export and the claims fix, not before.
- **Don't add address, phone, branch, legal name or buyer PAN as fields now.** No job we serve reads them. The one
  exception is a workspace setting for **our own PAN**, which arrives with the VAT export and adds a "bill doesn't
  show your PAN" reason. That matches the 2026-11-12 decision (buyer is the workspace).
- **Drop the visible confidence number. Say "Needs review" with plain reasons.** The app already does this; the
  marketing still promises a per-line score. Three claims need changing (below).
- **The biggest trust gaps in the loop:** the VAT export doesn't exist yet, duplicates aren't caught, reviewed state
  doesn't reach the CSV, and reviewing 30 receipts means opening 30 pages.

## Who pays, and what each job reads

| Job                                | Who                                 | Fields the job reads                                                                    | Lines needed?                                           |
| ---------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| VAT purchase register (खरिद खाता)  | Nepali VAT-registered SMB, its accountant | BS date, bill no., supplier name, supplier PAN, total, exempt amount, taxable amount, VAT | No. The register is one row per bill                    |
| Accountant handoff (Tally, Excel)  | Freelancer or SMB to bookkeeper     | Date, supplier, PAN, bill no., category, net/VAT/total, photo link                      | Rarely. Tally purchase vouchers take ledger totals      |
| Expense claim                      | Employee, small team                | Merchant, date, total, currency, category, the photo                                    | Only to split personal items off a bill (rare)          |
| Personal budgeting                 | Individual                          | Merchant, date, total, category                                                          | Sometimes: a grocery bill spans categories              |

The purchase-register columns follow Tally's Nepal IRD purchase register (supplier name, supplier PAN/VAT, total
purchase, tax-exempt purchase, taxable purchase), plus date and bill number. The official Schedule 8 sample was not
found again today; the column list is as reliable as on 2026-11-12. Dext, the reference bookkeeping tool, sells line
item extraction as a per-supplier add-on: its default product is header-level, which is evidence that bookkeepers
pay for totals first.

## 1. Line editing vs. totals editing

Today the header is fully editable (merchant, date, category, currency, bill no., seller tax ID, subtotal, discount,
service charge, tax, tip, total) and lines are read-only, with "Line items can't be edited yet"
(`apps/web/components/receipt-result.tsx:403`). Three things make the gap visible to a user:

1. **A line misread can't be fixed at its source.** When `totals_mismatch` fires because one line was misread, the
   only fix today is to change the subtotal or total so the arithmetic passes, which makes the stored numbers wrong
   in a different place. That is the case that costs trust.
2. **"Check this line against the receipt" offers no action.** The mark comes from the model's line confidence below
   0.75 (`apps/web/lib/format.ts:138-144`) and only a review hides it.
3. **The items CSV exports what was read, not what is true.** Anyone using the per-receipt items export for
   inventory or budgeting splits gets uncorrectable rows. Quantities are also still rounded to whole units
   (`packages/core/src/receipt-fields.ts:59-63`), so `0.5 kg` exports as 1.

**Which edits matter, in order:**

| Edit                       | Why                                                                                                      | Priority |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| Line amount (total price)  | It is what the totals check sums. Fixing it is what clears a real `totals_mismatch`                      | 1        |
| Delete a line              | Model adds header rows, "Total", payment or change lines as items; the sum then overshoots               | 2        |
| Line name                  | Search and the items CSV; Devanagari or abbreviated names misread                                        | 3        |
| Add a line                 | A missed line on a long receipt                                                                          | 4        |
| Quantity and unit price    | Only matter with decimal quantities and a `quantity × unit price ≈ line total` check; edit after both exist | 5        |
| Reorder, split, per-line category | No job asks for it yet. Per-line category is the budgeting split; wait for a request             | Later    |

Recommendation: ship edits 1 to 4 as one small feature after the VAT export, with the line check
(`quantity × unit_price ≈ total_price`) replacing the confidence mark in the same release. Saving a line edit
recomputes `totals_mismatch`, like a header edit does today.

## 2. Merchant details

| Field                        | Job that would read it                                       | Recommendation                                                                                                   |
| ---------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Merchant name, tax ID, bill no. | Every job above                                           | Stored. Keep                                                                                                     |
| Taxable and exempt amounts   | VAT purchase register                                        | **Add with the VAT export** (the one real gap). For a single-rate 13% bill, taxable = VAT ÷ 0.13 and exempt = total − taxable − VAT; editable when the bill prints them. CTO decides column or derived |
| Document type (tax invoice vs. abbreviated/estimate) | VAT credit: only a full tax invoice supports it | **Add with the VAT export**, as a review reason first ("Not a tax invoice"), a column only if filtered          |
| Our own PAN (buyer PAN)      | VAT credit check                                             | **Workspace setting with the VAT export**, never per receipt. Reason: "Bill doesn't show your PAN"              |
| Branch / outlet              | Branch-level spending                                        | Not now. A chain with branches shares one PAN; people tell branches apart by the name they type. Revisit if a multi-branch customer asks |
| Address, phone               | Nothing reads them; the photo has them                       | Never as fields. Leave in `raw_json` if the model returns them                                                   |
| Legal name vs. trading name  | Purchase register prefers the registered name                | Not a field. Merchant grouping by tax ID (later, a merchants list) gives the accountant one name per PAN         |
| Payment method               | Card or wallet reconciliation, expense policy (cash limits)  | Later, with statement matching                                                                                   |

## 3. Confidence scores

- **The app no longer shows a confidence number** on the receipt page or the list; badges come from
  `review_reasons`. The only visible use left is the per-line "hard to read" mark, from the model's own line score,
  which the 2026-11-12 extraction review found right on 9 of 96 lines it marked.
- **A number doesn't help these users.** A bookkeeper can't act on "87%"; they act on "amounts add up to Rs 4,520,
  total says Rs 4,250". Model self-scores are uncalibrated across the chain (0.9 flagged 68% of Haiku receipts and
  4% of Flash-Lite ones), so the same number means different things per model. Keep `confidence` in the CSV for
  power users; don't market it.
- **Wording to use:** "Checks before you trust it: amounts that don't add up, a missing date, total or merchant, and
  dates that read two ways are flagged with the reason, so you only check what needs it."

## 4. What else blocks trust and payment

Ranked by how directly it stops a user from relying on the export:

1. **No VAT purchase-register export.** The Nepal SMB's monthly job is a register for a BS month. Today they get a
   generic CSV with no taxable/exempt split, no BS-month filter preset and no fiscal-year range.
2. **Duplicates aren't caught.** The same bill photographed twice is claimed twice (VAT credit, reimbursement).
   `invoice_number` and `merchant_tax_id` are already stored, so a "Possible duplicate" reason is cheap now.
3. **Reviewed state doesn't reach the export.** The CSV has `review_reasons` but not reviewed / reviewed by
   (`apps/web/lib/csv.ts:41-63`), so an accountant can't tell checked rows from unchecked ones.
4. **Review is one receipt at a time.** Bulk actions are delete and group only
   (`apps/web/components/history/selection-actions.tsx:35`). Needed: "Mark as reviewed" on a selection, and on the
   receipt page "Save and next" through the Needs review filter. Keyboard shortcuts on desktop (next, previous, mark
   reviewed) after that.
5. **Excel may garble Devanagari.** The CSV has no UTF-8 byte-order mark (no match for `﻿` in `apps/web/lib`);
   Excel on Windows opens such files in the legacy code page. Not tested here; test with a Devanagari merchant
   name before the VAT export ships. An `.xlsx` export is not needed if this works.
6. **Accountant access.** Inviting the accountant as a member works today and fits Pro's 10 seats. A read-only
   role or a share link is a later convenience, not a blocker.

## Ranked: what to build next

| #   | Build                                                                                                                  | User job                       | Why now                                                                 | Size |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------- | ---- |
| 1   | Fix the three claims; replace the per-line confidence mark with the line arithmetic check                             | All                            | The site promises what the product no longer does                       | S    |
| 2   | VAT purchase-register export: BS-month and fiscal-year presets, taxable and exempt amounts, workspace PAN, "not a tax invoice" and "your PAN missing" reasons, CSV with BOM | Nepal SMB, accountant | The paying job in the strongest market; fields are mostly stored already | M   |
| 3   | Possible-duplicate reason from bill no. + tax ID (else merchant, total, date)                                          | VAT register, expense claims   | Double claims are the costliest error; data exists                      | S    |
| 4   | Review throughput: bulk "Mark as reviewed", "Save and next", reviewed columns in the CSV                               | Accountant, SMB month-end      | Month-end is 30 to 200 receipts                                          | S-M  |
| 5   | Line editing: amount, delete, name, add; decimal quantity                                                              | Bookkeeping, budgeting, items CSV | Clears line-caused mismatches at the source                          | M    |

Later: per-line category (budgeting splits), payment method, merchants list keyed by tax ID, read-only accountant
role, keyboard shortcuts.

## Claims

**Must change now** (they promise a per-line confidence score):

| Where                                                  | Today                                                                       | Replace with                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/web/components/landing-page.tsx:47`              | "with a confidence score for the receipt and for each line"                 | "with checks that flag what doesn't add up"                                  |
| `landing-page.tsx:52`, `:78`, `:90`, `:109`            | "Low-confidence lines are marked"; "Confidence: Per receipt and per line"; "a confidence score to show what needs a second look"; "Tax, totals and confidence for every receipt" | Reason-based wording above; the `:78` stat becomes "Review checks: totals, dates, missing fields" |
| `apps/web/lib/home-faqs.ts:11`                         | "an overall confidence score and each line item gets its own"               | List the checks and say each flag gives its reason                           |
| `apps/web/lib/plan-copy.ts:50`                         | "Confidence scores and review flags"                                        | "Review checks with reasons"                                                 |
| `apps/web/components/content/content-example.tsx:63, 158` | Confidence badges and per-line percentages in marketing examples         | The app's Needs review badge and reasons                                     |

**Can make today:** header fields correctable and the corrections are what's exported; Bikram Sambat dates read and
shown as printed; bill number and seller PAN read; amounts checked, including discount, service charge and rupee
rounding; CSV of any filtered set.

**Can't make yet:** "edit line items"; "VAT purchase book / IRD-ready export"; "catches duplicates"; "Tally import";
any accuracy percentage on the site.

## Owner decisions

| #   | Decision                                                                    | Recommendation                                                                                   |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Order: VAT export before line editing?                                      | Yes: claims fix, VAT export, duplicates, review throughput, then line editing                    |
| 2   | Line edits in v1                                                            | Amount, delete, name, add. Quantity and unit price once decimal quantity ships                  |
| 3   | Stop showing per-line confidence; line mark from arithmetic                 | Yes, in the same PR as the claims fix. Keep `confidence` columns in the CSV for now              |
| 4   | Merchant fields                                                             | None per receipt now. Workspace PAN setting and taxable/exempt amounts with the VAT export       |
| 5   | Branch                                                                      | Not until a multi-branch customer asks                                                           |
| 6   | Reviewed state in the CSV                                                   | Add `reviewed_at` and `reviewed_by` columns now, appended (CSV is append-only after launch)      |
| 7   | Excel encoding                                                              | Add a UTF-8 BOM if a Devanagari test in Excel shows garbling; no `.xlsx` export                  |

## Receipts list: the Status column

Today: "Checked" once someone reviewed it, "Needs review" while `review_reasons` is not empty, otherwise blank
(`ReviewBadge`, `apps/web/components/receipt-list.tsx:27-36`). In the owner's list of 9, most are blank. The same
3,701.60 bill appears three times (one Needs review, two blank, one of those with no date), and the same 185.00 bill
twice.

**What the column must answer, per job.** VAT register and accountant handoff: "Can I put this in the books?" and
"Has someone vouched for it?". Expense claims: "Is this claimed already?". Budgeting: barely anything, as long as
nothing is counted twice. So three questions: is it safe to export, did a person check it, is it a duplicate.
Blank answers none of them: it reads as "nothing to see", and a duplicate that passed every check shows as blank too.

**The undated blank receipt is a data gap, not a design choice.** Migration `0003` backfilled only
`low_confidence` (`apps/web/drizzle/0003_receipt_fields.sql:20-21`), so receipts completed before it have an empty
`review_reasons` even with no date, and an edit recomputes only the checks whose fields changed. A one-off job that
recomputes reasons for every unreviewed completed receipt (no model call) fixes it. CTO to confirm that this is
the cause.

**Recommended model: three states plus one flag.**

| State        | Means                                         | Label                                                  |
| ------------ | --------------------------------------------- | ------------------------------------------------------ |
| Needs review | A check fired, nobody reviewed it             | "Needs review" with the first reason on hover or below |
| Not checked  | Checks passed, nobody reviewed it             | "Not checked", muted. Never blank                      |
| Checked      | A person marked it right or saved an edit     | "Checked" (by whom on hover)                           |
| Duplicate    | Same bill as another receipt in the workspace | A separate "Possible duplicate" mark beside any state  |

- **Name the clean-but-unreviewed state.** The difference between "the machine found nothing" and "a person looked"
  is exactly what an accountant needs; blank hides it.
- **Duplicate is a flag, not a state.** It goes in `review_reasons` (so it puts a receipt into Needs review), but it
  keeps showing after review until someone picks "Not a duplicate" or deletes one copy. Marking a duplicate
  "Checked" doesn't hide it. This moves duplicate flags (ranked #3) next to the status work: the owner's list already
  has two duplicates in nine receipts.
- **Export:** the general CSV keeps every receipt, with `status`, `review_reasons`, `reviewed_at` and `reviewed_by`,
  so the accountant filters. The VAT purchase-register export defaults to Checked receipts only, with a visible count
  ("7 checked, 2 not checked left out") and an option to include them. Possible duplicates are left out of the
  register until resolved, never added silently.
- **The filter matches the column:** Needs review, Not checked, Checked, Possible duplicate.

| #   | Decision                                  | Recommendation                                                                                      |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 8   | Blank for clean-but-unreviewed receipts   | Replace with "Not checked"                                                                          |
| 9   | Status model                              | Needs review / Not checked / Checked, plus a separate Possible duplicate flag                       |
| 10  | Recompute reasons for old receipts        | Yes, one job before launch; it fixes the undated blank receipt                                      |
| 11  | Duplicate flags                           | Pull forward to ship with the status column, ahead of the VAT export                                |
| 12  | VAT register contents                     | Checked only by default, with a count and an "include not checked" option; duplicates out until resolved |
| 13  | General CSV contents                      | Everything, with the review columns                                                                 |

## Sources

All opened 2026-11-14.

- [Tally help: IRD registers in Tally e-Billing (Nepal)](https://help.tallysolutions.com/ird-register-in-tally-ebilling/), purchase register columns
- [Nepal VAT guide, worldtradepress](https://issuu.com/worldtradepresss/docs/nepal-vat): IROs provide a sample Purchase Book (Schedule 8); exempt columns for mixed suppliers; tax invoice carries seller PAN and invoice number
- [lookuptax: Nepal VAT guidelines](https://lookuptax.com/docs/country/nepal-vat-guidelines-indirect-tax): 13% rate, PAN is the VAT number
- [Dext: line item extraction](https://dext.com/en/business/products/line-item-extraction) and [How to use Line Item Extraction](https://help.dext.com/en/s/article/How-to-use-Line-Item-Extraction): per-supplier add-on, editable lines
- [Expensify: Split an expense](https://58919922.helpdot.pages.dev/articles/expensify-classic/expenses/Split-an-expense) (mirror of Expensify Classic help): splits are whole expenses, not line edits
- In-repo: confidence figures from the [extraction review](2026-11-12-extraction-review.md), not re-measured

## Not verified

- Schedule 8 of the VAT Rules (exact purchase-book headings) and whether the 2024 amendment changed it.
- Excel's handling of this CSV with Devanagari text; Tally's CSV/Excel import format.
- How often real users hit line-caused mismatches: no usage data was read.
