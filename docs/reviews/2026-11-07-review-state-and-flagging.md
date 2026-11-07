# Product idea review: review state and "flag an issue"

2026-11-07. Owner's idea: after OCR finishes, let a person mark a receipt as reviewed (or read/unread), and add a
"flag issue" option for wrong extractions that also shows the team where OCR fails. Read-only review of `main` at
`de9b72b`; no code changed.

## Summary

- **Build it, as a review state rather than read/unread.** Today "Needs review" is computed from model confidence
  (`confidence < 0.9`, `packages/core/src/repository.ts:149`). Nothing a person does clears it. Correcting every field
  leaves the receipt in the Home "Needs review" count and the History filter, and the "Check this receipt before you
  export it" banner stays up for good. That is a real bug in the trust loop, not a nice-to-have.
- **Three user-visible states:** _To review_ → _Reviewed_, plus a _Flagged_ marker that can sit on either. That is the
  pattern Dext ("To review" / "Ready") and Rossum (`to_review` → `confirmed`) use. Read/unread tracks the wrong thing:
  a receipt can be opened and still be wrong.
- **Corrections are already the strongest OCR signal.** `raw_json` keeps the model output and the row holds the
  user's values (`PATCH` never touches `raw_json`), so the edit rate per field and per model is one SQL query away.
  Dext treats a correction as a reported mistake. Flags add what an edit can't express: unreadable photo, missing
  items, wrong document.
- **Privacy limit:** the Terms allow us to process content "only as needed to provide the service to you"
  (`apps/web/app/terms/page.tsx:43`). Using flagged images or values in our benchmark needs **explicit opt-in per
  flag**. Without it, the admin view shows structured metadata only, as `/admin/jobs` does today.
- **MVP is small (about 2 to 3 days):** one migration with three columns, auto-review on save, a "Mark reviewed"
  button and bulk action, the filter and count switched to the stored state, and a flag dialog with reason codes.
  The admin "OCR issues" page and benchmark export come next.

## Recommendation

| #   | Do                                                                                                                     | Why                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Add `reviewed_at`, `reviewed_by` to `receipts`. _To review_ = completed and `reviewed_at is null`                      | Makes "Needs review" clearable. Two nullable columns, no enum change                  |
| 2   | Saving a correction marks the receipt reviewed. "Mark reviewed" button on the receipt; bulk in History                 | The person has just compared it with the photo. One click for the clean ones          |
| 3   | Auto-review only when confidence ≥ 0.9 **and** no checks fire (arithmetic, missing fields). Admin setting, default off | Rossum-style automation. Off until the benchmark shows the threshold predicts errors  |
| 4   | `receipt_flags` table: reason code, field list, optional note (≤ 500 chars), `share_for_improvement` boolean           | Gives the team failure reasons that edits can't express; consent is captured per flag |
| 5   | Admin "OCR issues": edit rate per field and model, flag counts by reason. No content unless shared                     | Turns the readiness review's "trust funnel" into a page without waiting for PostHog   |
| 6   | Don't build read/unread, a reviewer-assignment workflow or approvals yet                                               | No multi-reviewer customers yet; see "What not to build"                              |

## What exists today

| Piece               | Where                                                                | Notes for this feature                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receipt status enum | `packages/db/src/index.ts:53`                                        | `uploaded`, `processing`, `completed`, `failed`. Pipeline state; keep review out of it                                                                    |
| Confidence          | `receipts.confidence`, `receipt_items.confidence`                    | Model self-reported (`packages/ai/src/schema.ts:4`). Overall and per line; **no per-field confidence** for merchant, date or total                        |
| "Needs review"      | `repository.ts:204` filter, `:592` count, Home `app/app/page.tsx:93` | Derived from `confidence < 0.9`. Not clearable                                                                                                            |
| Review checklist    | `checksFor` in `components/receipt-result.tsx`                       | Low confidence, hard-to-read lines, items + tax + tip ≠ total, missing merchant, date or total. Never dismissable                                         |
| Correction          | `components/receipt-editor.tsx`, `PATCH /api/receipts/[id]`          | Header fields only; line items are read-only. Members edit only their own uploads. The wide event logs which fields changed (`event.flags`), never values |
| Original extraction | `receipts.raw_json`                                                  | Written on completion, untouched by edits. Corrections = row vs `raw_json`                                                                                |
| History             | `components/history/*`                                               | Status chips (incl. Needs review), category, date range; selection mode exists for groups (`components/groups/group-select-list.tsx`, #48)                                                                |
| Admin               | `/admin/operations`, `/admin/jobs`                                   | Volume, latency, cost, failures. Deliberately no receipt contents or images (`admin/jobs/[id]/page.tsx:46`)                                               |
| CSV                 | `apps/web/lib/csv.ts`                                                | Has a `confidence` column; no review column                                                                                                               |
| Privacy and Terms   | `app/privacy/page.tsx:70`, `app/terms/page.tsx:43`                   | Admins access an account "only to handle a support request"; content used "only as needed to provide the service to you"                                  |

So "reviewed" attaches to `receipts` (workspace-scoped, like every other receipt field). A flag attaches to a receipt
and to the model and round that produced it (`receipts.model`, `receipts.attempts`).

## How others do it

| Product      | What it does                                                                                                                                                                                                              | Source                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dext Prepare | Every inbox item is _To review_ or _Ready_; hovering the badge lists the outstanding issues, shown again in a "Please resolve these issues" panel. Ready = passed checks, can be published                                | [Dext help](https://help.dext.com/en/s/article/what-does-to-review-and-ready-mean), [Dext help](https://help.dext.com/en/s/article/How-to-use-To-Review-and-Ready-to-organise-your-workspace)                                                          |
| Dext Prepare | "If we've made a mistake extracting data … just correct the field and we record that action as a reported mistake." A separate "Report mistake" exists for statements                                                     | [Dext help](https://help.dext.com/en/s/article/report-extraction-mistake)                                                                                                                                                                              |
| Rossum       | Annotation lifecycle `to_review` → `reviewing` → `confirmed` (opt-in per queue) → `exported`, plus `postponed` and `rejected`. Red fields must be fixed before export. Automation can skip review for confident documents | [Rossum API](https://rossum.app/api/docs/openapi/guides/annotation-lifecycle/), [Rossum KB](https://knowledge-base.rossum.ai/docs/guide-to-the-document-lifecycle)                                                                                     |
| Mindee       | Confidence levels per field; Low = "Manual review required". Recommends routing medium and below to human validation; corrections fed back through RAG                                                                    | [Mindee docs](https://docs.mindee.com/extraction-models/optional-features/automation-confidence-score), [Mindee blog](https://mindee.com/blog/what-is-human-in-the-loop-automation)                                                                    |
| Ramp         | Receipts that don't match amount and date or merchant are "Not auto-verified"; transactions sit under _Needs review_ or _Flagged_. Users asked for a way to report a wrong verification                                   | [Ramp support](https://support.ramp.com/receipt-verification), [Ramp community](https://community.ramp.com/t/receipts-with-incorrect-amounts-should-not-be-auto-verified-not-irs-compliant/265)                                                        |
| Hubdoc       | Status tabs plus symbols: yellow triangle for documents in review, another for failed extraction or publish. Users asked for a way to force a document into Review                                                        | [Hubdoc support](https://support.hubdoc.com/hc/en-us/articles/16695034961933-About-a-document-s-status-in-Hubdoc), [Xero ideas](https://productideas.xero.com/forums/967130-contacts-documents/suggestions/48590519-hubdoc-force-document-into-review) |
| Expensify    | A scan fails when date or total can't be read reliably: red dot, "Receipt scanning failed. Enter details manually"                                                                                                        | [Expensify help](https://help.expensify.com/articles/new-expensify/reports-and-expenses/Troubleshoot-SmartScan-Issues)                                                                                                                                 |
| Zoho Expense | Wrong autoscan details: edit the expense; contact support if frequent. Filter "Scan Failed Receipts" and bulk "Retry Autoscan" on iOS                                                                                     | [Zoho KB](https://www.zoho.com/za/expense/kb/expenses/incorrect-information-autoscan/), [Zoho KB](https://www.zoho.com/expense/kb/ios/filter-scanned-receipts/)                                                                                        |
| Veryfi       | Fix values through the API or portal; reports are used "as a reference for future improvements"                                                                                                                           | [Veryfi FAQ](https://faq.veryfi.com/en/articles/5412173-how-to-improve-the-accuracy)                                                                                                                                                                   |

Caveat: the Dext and Hubdoc pages returned 404/403 to a direct fetch on 2026-11-07; the quotes come from their help
centres' search results that day. Not checked: whether Dext or Rossum expose a reason list when reporting.

Takeaways: the leaders use a **two-state review** (to review / done) driven by checks, not read/unread. **Corrections
count as mistake reports.** A separate flag exists for what an edit can't fix. None of the receipt tools above
publicly offer a reason taxonomy, so ours is a small advantage for us, not a parity item.

## Details

### States model

Keep pipeline status and review state separate. A receipt's review state is a function of the row:

| State               | Rule                                           | Shown as                                   |
| ------------------- | ---------------------------------------------- | ------------------------------------------ |
| To review           | `status = completed` and `reviewed_at is null` | Badge "To review"; checks listed on hover  |
| Reviewed            | `reviewed_at is not null`                      | Quiet check mark and "Reviewed by X, date" |
| Flagged (marker)    | an open `receipt_flags` row exists             | Flag icon; independent of the two above    |
| Failed / processing | unchanged                                      | Existing status badge                      |

Why not read/unread: "read" is set by opening the page, which says nothing about whether the values are right, and it
is per person, so a workspace needs one row per member per receipt. Why not a `needs_review` boolean set by the
model: confidence still drives the _hint_ (badge colour, checks) but the _state_ is what a person did.

Change of meaning: today's "Needs review" (low confidence) becomes "To review" (everything not yet reviewed). The Home
card should show _To review_ with a sub-count "N with warnings", so the confidence signal isn't lost.

Existing receipts: backfill `reviewed_at = updated_at` for completed receipts with confidence ≥ 0.9, or leave all as
To review? Recommend the backfill (or "Mark all reviewed before <date>" in History) so users don't open a wall of
work on day one. Owner decision.

### Auto-marking rules

1. **Saving a correction marks reviewed.** The person has compared the receipt with the photo. Show "Marked as
   reviewed" with Undo.
2. **"Mark reviewed" button** in the checklist banner and the details card. Keyboard: on the receipt page, a
   "Reviewed, next" action that opens the next To review receipt (Rossum's "move to next document" setting).
3. **Auto-review confident receipts: off by default.** Rule: confidence ≥ threshold, no checks fire. Turn on per
   workspace only after the benchmark measures how well the 0.9 threshold predicts a wrong field (readiness review
   item 3); today the threshold is a guess.
4. **Reset on retry:** a retry of a failed receipt that completes starts as To review. An edit after review keeps
   it reviewed (it's a further correction).
5. **Highlighting:** no per-field confidence exists for header fields, so highlight from the checks we already have:
   arithmetic mismatch → total, subtotal, tax; missing values → that field; low-confidence lines → already marked.
   Adding per-field confidence to the schema is a prompt change and must go through the benchmark.

### Bulk actions, filters, counts

- History: chips _To review_, _Reviewed_, _Flagged_ (replace _Needs review_). Bulk "Mark reviewed" on the selection
  mode that groups added (#48; per page today). Bulk action skips receipts the member can't edit and says how many it skipped.
- Home: "To review N" (with "M with warnings"), "Flagged N" for the workspace.
- CSV: add `reviewed` (yes/no) and `reviewed_at` columns. Export dialog option "Only reviewed" later.
- Permission: same as editing (`canEditReceipt`): members on their own uploads, admins and owners on all.
  Open question below.

### Flag taxonomy

One dialog, "Report a problem with this reading", from the receipt page (and the failed-receipt alert):

| Code             | Label                            | Field(s)                  |
| ---------------- | -------------------------------- | ------------------------- |
| `wrong_total`    | Total or amounts are wrong       | total, subtotal, tax, tip |
| `wrong_date`     | Date is wrong                    | receipt_date              |
| `wrong_merchant` | Merchant is wrong                | merchant                  |
| `wrong_currency` | Currency is wrong                | currency                  |
| `wrong_items`    | Line items wrong or missing      | items                     |
| `unreadable`     | Photo or PDF can't be read       | none                      |
| `not_a_receipt`  | Not a receipt, or several in one | none                      |
| `other`          | Something else                   | none, note required       |

Multi-select reasons, optional note (plain text, ≤ 500 chars, treated as receipt content: never logged). Then a
separate, unticked checkbox: "Let the receiptOCR team look at this receipt to improve reading. We may use it in our
private test set. You can withdraw this from the receipt at any time." Flagging does not mark reviewed; fixing the
values still goes through Edit, with a link "Correct it now".

Most wrong values will be fixed by editing without a flag; the flag is for what editing can't express and for
consent. Line items can't be edited yet, so `wrong_items` is the only way to report them today.

### Admin "OCR issues" and the benchmark

Admin page, platform admins only, aggregated and content-free by default:

- **Edit rate** per field and per `model` over 7 and 30 days: completed receipts where the row differs from
  `raw_json` for that field. Headline: "row usable without edits" (readiness review metric).
- **Flags** by reason, model, file type (photo/PDF), confidence band, and whether the checks had fired (are our
  warnings catching real errors?).
- **Calibration:** of receipts with confidence ≥ 0.9, the share edited or flagged. This sets the auto-review
  threshold.
- **Shared items only:** receipts flagged with consent show image, `raw_json`, corrected values and note, with each
  view logged in `admin_audit_log` ("Show photo", owner decision 4). Action "Copy to benchmark" writes a fixture to
  `bench/fixtures-local/` (gitignored) after a PII check (card digits, names, loyalty IDs, addresses), the rule the
  parsers-landscape plan already set for `own-*` fixtures.

Privacy and terms changes, needed before anything content-bearing ships:

- Privacy page: a line under "Who sees it" for receipts a user chooses to share when reporting a problem, how long
  we keep them (suggest until withdrawn or 12 months), and that withdrawing or deleting the receipt removes our copy.
- Terms "Your content": an exception for content you choose to share to improve the service.
- Deleting the receipt cascades the flag; a fixture copied to the benchmark must be deleted too, so keep a pointer.
  GDPR: consent must be specific and withdrawable (Art. 7); receipts can carry names and card digits.
- The aggregate edit-rate and flag-count views use no content and need no consent beyond the current terms
  (service operation and quality). Confirm with counsel; this review is not legal advice.

### Schema and telemetry touch points

| Area            | Change                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/db`   | `receipts.reviewed_at timestamptz null`, `receipts.reviewed_by text null → user.id on delete set null`; index `(organization_id, reviewed_at)` or a partial index for "to review"                                                                |
| `packages/db`   | `receipt_flags`: id, receipt_id (cascade), organization_id, user_id, reasons `text[]` with a check constraint, note, `share_for_improvement` bool, `model`, `round`, created_at, resolved_at, resolved_by                                        |
| Migration       | Next free number, or on top of the baseline if #57 (squash + RLS) lands first; RLS policy for the new table either way                                                                                                                           |
| `packages/core` | `ReceiptRepo.markReviewed(ids, scope)`, `unmarkReviewed`, `update` sets `reviewed_at`; `ReceiptFlags` service; counts and filters switch to the stored state                                                                                     |
| Web             | `POST /api/receipts/review` (bulk ids, Zod), `POST /api/receipts/[id]/flags`; thin adapters                                                                                                                                                      |
| Telemetry       | New `receipt.review` and `receipt.flag` events. Fields: `review.count`, `review.source` (`manual`, `edit`, `bulk`, `auto`), `flag.reasons` (token list), `flag.shared` (bool). No note text. Add to `telemetry/schema.ts` and the PR field audit |
| Docs            | `docs/architecture/data-model.md` and `core.md`; privacy page                                                                                                                                                                                    |

### Adjacent ideas, ranked by value for effort

| Rank | Idea                                                                      | Value                                                              | Effort             |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------ |
| 1    | "Reviewed, next" flow through the To review queue                         | Turns review into a 2-second loop per receipt                      | S                  |
| 2    | Edit line items                                                           | Biggest gap in correction today ("Line items can't be edited yet") | M                  |
| 3    | Duplicate warning at review (same merchant, date, total in the workspace) | Prevents double-claimed expenses; already on the roadmap           | S–M                |
| 4    | Arithmetic check that names the field (highlight total/tax in the form)   | Faster fixes with no model change                                  | S                  |
| 5    | "Only reviewed" CSV export and a reviewed column                          | Accountants trust what they export                                 | S                  |
| 6    | Workspace setting: auto-review confident receipts (after calibration)     | Less work for high-volume users                                    | S, after benchmark |
| 7    | Remember corrections per merchant (category, currency) as defaults        | Fewer repeat edits; Mindee-style memory without training           | M                  |
| 8    | Weekly email "N receipts to review"                                       | Re-engagement; needs email prefs                                   | S–M                |

### What not to build yet

- Per-user read/unread: costs a row per member per receipt and doesn't say whether the data is right.
- Assignment, approver chains, reject-to-submitter: expense-approval territory (Ramp, Expensify). No customer asks yet.
- Model retraining or fine-tuning from corrections: we don't train models; use corrections for the benchmark and
  prompt changes.
- Customer-visible "accuracy score" built from flags: too few data points, and it invites disputes.
- Free-text chat or support thread on a flag: the contact form exists.

## Phased plan

1. **MVP (about 2 to 3 days, one PR):** review columns and migration; mark on save, single and bulk "Mark
   reviewed", Undo; History chips and Home counts on the stored state; CSV columns; backfill decision applied; events.
2. **Flags (about 2 days):** `receipt_flags`, dialog with reasons and note, consent checkbox (stored, but no admin
   content view yet), Flagged chip and count, privacy and terms text.
3. **Admin "OCR issues" (about 2 days):** edit rate per field and model from `raw_json`, flag breakdown,
   calibration table; content view for shared flags with audited "Show photo".
4. **Benchmark loop:** "Copy to benchmark" for shared flags into `bench/fixtures-local/` with the PII checklist;
   measure the threshold; then offer auto-review as a workspace setting.
5. Then the adjacent ideas: "Reviewed, next", line-item editing, duplicate warning.

## Open questions for the owner

1. Is review state per workspace (one person's "reviewed" counts for all) or per uploader? Recommended: per
   workspace, with "Reviewed by" shown.
2. Can members mark others' receipts reviewed, or only their own (as with editing)? Recommended: same as editing.
3. Existing receipts on launch: backfill confident ones as reviewed, all as To review, or one "Mark all reviewed"?
4. Rename "Needs review" to "To review" everywhere, including the landing page line about the Needs review filter
   (`components/landing-page.tsx:91`)?
5. Consent wording and retention for shared receipts (12 months?); whether the benchmark may keep a PII-stripped copy
   after the user deletes the receipt (recommended: no).
6. Should a flag notify anyone (email to platform admins, daily digest), or only show in the admin page?
