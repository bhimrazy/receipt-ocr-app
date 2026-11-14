# Receipt review flow: design review and line-item editing spec

Scope: the completed receipt page (`/app/receipts/[id]`), its correct → save → reviewed flow, the Receipts list's
Status and Date columns, and a spec for editing line items. `main` at `f8d76be`, plus a read of the in-flight
`fix/receipt-line-checks` worktree (arithmetic line checks, admin-only JSON, "Receipts" back link). Looked at locally
with test data only: a fictional Nepali supermarket bill (9 lines, a bill discount, 13% VAT, NPR, a BS date), the
same bill reviewed, a 56-line bill, and a list seeded to match the owner's screenshot (three rows of one store for
3,701.60, two identical 185.00 rows, a 2017 bill scanned today, one failed scan). Screenshots are in the PR at
1440 and 390 px, light and dark.

Builds on `2026-11-12-design-critique.md` (findings 1, 5 and 6), `2026-11-12-receipt-fields-review.md` (quantity,
line order) and the 2026-11-13 decisions (save marks reviewed, with undo; line warnings hide once reviewed).

## Owner decisions

Each has a recommendation; the rest of this file assumes it.

1. **Totals when lines change: keep the printed totals, flag the gap** (don't recompute). Recommended; reasoning in
   [Totals](#totals-keep-the-printed-numbers).
2. **Quantity becomes a decimal** (`numeric(12,3)`, `> 0`) so a weighed line (1.250 kg) can be stored and edited.
   Without it the new arithmetic check flags every weighed line on a supermarket bill (P0-2). Recommended as its own
   small PR before line editing. Pre-launch data, so altering the column type is cheap, but it is a migration: yes/no.
3. **One editor for the whole receipt** (details and lines, one Save, one "marked reviewed"), rather than a separate
   Edit on the Line items card. Recommended.
4. **One word for the reviewed state: "Reviewed"**, replacing the "Checked" badge, so the badge, the line under the
   header, the filter and Home all say the same thing. Recommended.
5. **The banner's ✕ goes**: today it silently marks the receipt reviewed. Keep "Looks right" as the only way to vouch
   without editing. Recommended.
6. **Receipts list Status never blank for a completed receipt**: "Needs review" / "Reviewed" / "Not reviewed"
   (muted, no colour), plus "Scanning" and "Couldn't scan". Recommended over a green "Looks fine", which claims
   more than the checks prove. Needs decision 7 to be honest.
7. **Recompute review reasons for receipts completed before the checks existed** (a one-off job kind, no model
   call), so old rows with no date or a totals gap stop showing blank. Recommended.
8. **Receipts list: show when each receipt was added**, as a secondary line under the merchant (not a new column),
   keep "newest added first" as the default and make it visible and choosable ("Sort: Added ▾ / Receipt date /
   Total / Merchant"). Recommended.
9. **Date-range filter on a receipt with no printed date**: count it by the day it was added, as Spending already
   does. Recommended, with the filter labelled "Receipt date".

## Top findings

| #    | Pri | Finding                                                                                              | Fix                                                                                                                  |
| ---- | --- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| P0-1 | P0  | Line items can't be edited, so a wrong line can't be fixed; the only way out is to vouch for it      | Line editing, first PR below                                                                                          |
| P0-2 | P0  | Quantity is stored as a whole number (`storableQuantity` rounds 1.25 to 1), so the in-flight arithmetic check will flag every weighed line: Tomato 1 × 120.00 ≠ 150.00 | Decimal quantity (decision 2); until it lands, skip the check when the extracted quantity in `raw_json` wasn't whole |
| P0-3 | P0  | Saving an edit marks the receipt reviewed, but nothing says so, and "Undo" then undoes only the review, not the edit | Save button and toast say it (see [Save and undo](#save-and-undo)); toast Undo restores the previous values        |
| P1-1 | P1  | The banner's ✕ is labelled "Mark as reviewed": a close icon that records "I checked this"           | Remove it (decision 5)                                                                                               |
| P1-2 | P1  | "Checked" badge, "Reviewed by …" line, "Needs review" filter: two words for one state               | "Reviewed" everywhere (decision 4)                                                                                   |
| P1-3 | P1  | Primary button is Export CSV (full width on phones); checking and correcting is a small "Edit" in a card corner | Header: **Edit** (primary while it needs review), **Export CSV** secondary; carried over from 11-12 finding 6       |
| P1-4 | P1  | After Save the form closes and focus drops to `<body>`; no confirmation is announced                | Focus the "Reviewed · Undo" line; toast with role status                                                             |
| P1-5 | P1  | A receipt can be marked reviewed by saving while its totals still don't add up, and the reasons are then hidden | After save, if a reason remains, keep one muted line: "Reviewed. The amounts still add up to Rs 3,915.00, not Rs 4,294.00." |
| P1-6 | P1  | Line items show only "× 2" and the amount: no unit price and no sum, so the person can't do the check the app asks for | Show unit price when quantity > 1 ("2 × 345.00"), and a footer "9 lines add up to Rs 3,915.00"                     |
| P1-7 | P1  | Receipts list: a blank Status means both "passed the checks" and "never checked" (old rows)          | Decisions 6 and 7                                                                                                    |
| P1-8 | P1  | Receipts list is ordered by upload time but shows only the receipt date, so the order looks random (a 2017 bill at the top) | Decision 8                                                                                                           |
| P2-1 | P2  | "These are the values that go in the CSV." Most phone users don't know what a CSV is                | Drop the line; the Export CSV button already says it                                                                 |
| P2-2 | P2  | "Upload another" (desktop back row) vs "Add receipts" (sidebar) vs "Scan" (phone tab)                | "Add receipts" on desktop, as the sidebar                                                                            |
| P2-3 | P2  | `low_confidence` copy: "Overall confidence is 82%. Compare the merchant, date and total with the photo." A percentage means little to a non-technical reader | "Some of this receipt was hard to read. Compare the merchant, date and total with the photo."                       |
| P2-4 | P2  | "Copy JSON" stays in the … menu for everyone once the raw JSON panel is admin-only                   | Same rule as the panel: admins only                                                                                 |
| P2-5 | P2  | Uploaded time shows only while a receipt isn't completed, and in UTC                                 | Quiet meta line on every receipt: "Added 14 Nov 2026, 17:45 · by Asha" in the viewer's time zone                    |
| P2-6 | P2  | Phone: the photo is cropped to its top 320 px and "Open full size" leaves the app                    | Open the existing full-size viewer (`capture/full-size-view.tsx`) instead of a new tab                              |
| P2-7 | P2  | "Line items can't be edited yet." promises a feature (product standards: coming features are labelled as coming) | Goes with line editing; until then "To fix a line, use Report a problem" or no line at all                          |
| P2-8 | P2  | Editor: empty amounts show the placeholder "0.00", which reads as a saved zero (Service charge, Tip); amounts are left-aligned, proportional and without the currency | No placeholder on amounts; right-aligned `font-mono tabular-nums` inputs with the currency symbol as a prefix       |
| P2-9 | P2  | The passkey nudge ("Five receipts in…") sits above the receipt title, so on a phone the receipt starts a screen down | Show account nudges on Home and Receipts only, never on a receipt page                                              |

## The receipt page, section by section

**How much a phone user reads.** At 390 px on the 9-line bill, before the first line item: the title, "20 Kartik
2083 · 6 Nov 2026", two chips, the groups row, a full-width Export CSV, the banner (heading, one reason, two buttons,
the ✕), the photo, and the Details card (heading, the CSV sentence, nine fields). That is about 80 words and four
screens of scrolling. The 2026-11-13 tester note ("too much info on phone for non-tech users") still holds. The
fixes above cut it to: title, date, one chip, the banner with one plain reason and two buttons, the photo, the
fields. Further: on phones, show the Details card's optional fields (Bill number, Merchant tax ID, Subtotal, Tax)
under a "More details" disclosure, keeping Merchant, Date, Category and Total open.

**Header.** The title (merchant) and BS + AD date read well, and the muted AD half is the right weight. Category and
Needs review are two chips of equal weight; the category chip carries no action, so it can be plain muted text
("Groceries") and leave the one chip that matters. "Add to group" is fine as a quiet row. Actions: P1-3. The desktop
back row's "Receipts" (in-flight) is right; its right half should say "Add receipts" (P2-2).

**"Check before you use this" banner.** The heading is good: plain and literal. Reasons are one sentence each and say
what to compare. Issues: the ✕ (P1-1); "Looks right" (outline) and "Correct details" (ghost) are both quiet, and on
phones neither is clearly the next step. When the reason is about numbers (`totals_mismatch`, `no_total`), make
"Correct details" the filled button; for `low_confidence` keep "Looks right" first. Keep the label "Correct
details"; once line editing ships it opens the whole editor, lines included.

**Reviewed line.** "Reviewed by Asha · 14 Nov 2026 · Undo" is the right weight. With decision 4 the header badge says
"Reviewed" too. Undo is a 44 px target on phones (`max-md:min-h-11`) but only the text width; give it horizontal
padding so the box is at least 44 × 44.

**Details card.** Good: a `dl` grid, mono amounts, the total in emerald, empty optional fields hidden. Issues: the
CSV sentence (P2-1); the absolutely positioned Edit button needs `pr-28` on the heading to avoid overlap, which goes
away once Edit moves to the header (P1-3).

**Photo card.** Desktop: sticky beside the fields, which is the right layout for checking. Phone: P2-6. The file name
("IMG_0421.jpg") in mono is noise for most people; keep it, it's quiet.

**Line items card.** P1-6 and P2-7. The in-flight change's copy, "Marked lines don't add up.", reads well; make it
specific per line instead of a footnote: under the line, "2 × 345.00 is 690.00, not 600.00". Every line's warning
hides once the receipt is reviewed, per the 2026-11-13 decision; with editing that is still right, because the person
either fixed the line or vouched for it.

**Install offer** under the line items: unchanged, it has its own dismiss.

## Save and undo

Today: Save sends only the changed fields; the server applies them, recomputes the affected reasons and sets
`reviewed_at` (`repository.ts` `update`). The page refreshes; the banner is replaced by "Reviewed by … · Undo". Undo
calls `{ reviewed: false }`, so the edit stays and the warnings come back. That is defensible, but nobody is told it
happened.

Recommended:

- The submit button says **"Save and mark reviewed"** while the receipt isn't reviewed, and **"Save"** once it is.
  This is the one place the person learns that saving vouches for the receipt.
- After the save: toast "Saved and marked reviewed" with an **Undo** action (10 s, paused while hovered or
  focused; `role="status"`). Undo PATCHes back the previous values of the fields that changed (lines included,
  once editable) and `reviewed: false` if it wasn't reviewed before. The client already holds the previous draft,
  so this needs no history table.
- The "Reviewed · Undo" line keeps meaning "undo the review" only, and stays as it is.
- Focus moves to the "Reviewed" line (today it drops to `<body>`: checked in the browser after Save) (it gets `tabindex="-1"` and a heading-like label), so keyboard and
  screen-reader users land on the result (P1-4).
- P1-5: when reasons remain after the save, the reviewed line carries the first one in muted text.

## Line-item editing spec

### Totals: keep the printed numbers

Recommendation: **never recompute subtotal or total from the lines.** Recompute only the check.

- The printed total is what was paid and what a bank or wallet statement shows; it is the number most often read
  right (large, labelled, often printed twice).
- People edit a line because it was misread. If the total followed the lines, fixing the wrong line, or deleting a
  line by mistake, would silently change a correct total, and the mismatch that tells them they fixed the right line
  would disappear.
- Bills round (NPR to the rupee), include VAT in prices or list deposits; a recomputed total is wrong in those cases.

So: the editor shows a live summary row under the lines, "9 lines add up to **Rs 3,915.00** · Subtotal Rs 3,915.00"
with a check icon when it matches (using `totalsMismatch`, so rounding and VAT-included bills pass), or "· Subtotal
says Rs 3,905.00, a difference of Rs 10.00" in warning colour when it doesn't. When the receipt has no subtotal, the
row compares with the total after discount and tax, as the check does. One explicit button, **"Use 3,915.00 as the
subtotal"**, appears only when no subtotal was read: a person can choose to fill it, never by default. On save,
`totals_mismatch` is recomputed because the lines changed.

### Which editor

The existing "Correct the details" form grows a **Line items** section under the amounts. One Save, one PATCH, one
"marked reviewed", one undo. "Correct details" in the banner, "Edit" in the header and "Edit details" in the phone
sheet all open it; when opened from a line's warning ("Fix this line"), it opens scrolled to that line with its first
wrong field focused. The read-only Line items card is hidden while the form is open, as the Details card is today.

### Fields per line

| Field      | Input                                                  | Rules                                                                                     |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Name       | text, required, 1–200 chars                             | Empty with an amount: "Add a name, or delete this line." A wholly empty new line is dropped on save |
| Quantity   | `inputmode="decimal"`, 1–3 decimals (after decision 2) | > 0, at most 1,000,000. Empty means 1                                                     |
| Unit price | `inputmode="decimal"`, the currency's decimals          | Optional; ≥ 0                                                                             |
| Amount     | `inputmode="decimal"`, the currency's decimals          | Required. May be negative, for a printed discount or return line           |

- Amounts are typed as text and parsed with the existing `parseAmount` (core, client-safe): currency symbols and
  spaces dropped, Western and Indian grouping (`1,23,456.50`), a decimal comma that can't be grouping. Same parser on
  client (live hint) and server (authoritative), so they never disagree.
- Minor units: the input placeholder and the shown value follow the currency (`Intl.NumberFormat`
  `maximumFractionDigits`): "0.00" for NPR, INR, USD; "0" for JPY, KRW. A 3-decimal currency (KWD, BHD, OMR) can't be
  stored in `numeric(12,2)`; the field says "Use at most 2 decimals" rather than rounding. Not worth a schema change
  until someone uploads one.
- Nothing auto-fills an amount on an existing line. When quantity × unit price doesn't match the amount, the line
  shows "2 × 345.00 is 690.00" with a **"Use 690.00"** button. On a new line, the amount fills from quantity × unit
  price until the person types in it.
- Edited and added lines get `confidence = null` (a person entered them). Untouched lines keep theirs.

### Layout

**Desktop (≥ md):** a table inside the form, visible headers Item · Qty · Unit price · Amount · (delete). Item takes
the rest; Qty `w-20`, the two prices `w-28`, all numeric inputs right-aligned `font-mono tabular-nums`. Delete is a
ghost icon button (`Trash2`), 32 px with a 44 px hit area. Under the table: **"+ Add line"** (ghost, left), the
summary row (right). The form's Save and Cancel move into a bar that sticks to the bottom of the viewport while the
form is open, so a 50-line receipt never needs a scroll to save. The photo stays sticky on the left.

**Phone (390):** each line is a block, not a table row: the name input full width with the delete icon button
(44 × 44) at its end; under it three inputs side by side, Qty (72 px) · Unit price · Amount (the rest split
evenly, about 135 px each at 390 with the 16 px gutters), each with a small visible label above ("Qty", "Unit
price", "Amount") on the first line only and an `aria-label` on every line. Inputs are 44 px tall and 16 px text
(no iOS zoom). Lines are separated by a divider, not cards. The Save bar sticks above the tab bar. A **"View photo"**
button in the form header opens the full-size viewer, because on a phone the photo is above the form and out of
sight. No horizontal scroll at 390: nothing in a line has a fixed width over 358 px.

### Keyboard and screen readers

- Tab order runs line by line: name, qty, unit price, amount, delete. Enter submits the form, as everywhere else
  (with the save toast's Undo as the safety net).
- Each input's accessible name includes the line: "Quantity, line 3, Tomato (kg)" (a visually hidden label built
  from the position and the current name; desktop uses the column headers via `aria-labelledby`).
- Add line: appends and focuses the new name input; a polite live region says "Line 10 added".
- Delete line: removes it from the draft (nothing is saved yet), moves focus to the next line's name (or "Add line"
  when it was the last), and shows an inline "Line deleted · Undo" in its place until the next edit or Save. The
  live region says "Tomato (kg) deleted".
- Errors: on Save, each bad field gets `aria-invalid` and `aria-describedby` to its message; focus goes to the first
  one and an alert at the top says "2 lines need a fix before saving".
- The arithmetic hint is tied to the amount input with `aria-describedby`, so it is read with the field.

### Empty and long receipts

- **No lines** (a transfer screenshot, a bill the model couldn't split): view says "No line items were found on this
  receipt." with no "can't be edited" line; the editor shows the same sentence and "+ Add line". The totals check
  falls back to the subtotal alone, as now.
- **50+ lines:** view shows all lines (printed order matches the photo; about 48 px a line). In the editor, when any
  line doesn't add up, a toggle over the list, "Show only lines to check (3)", narrows to those; off by default.
  Line order stays printed order; reordering (move up/down in each line's menu) is a follow-up. Cap at 200 lines
  (server refuses more, "A receipt can have at most 200 lines"); 200 × 4 controlled inputs is fine for React.

### Warnings and the reviewed state

- In the editor, the line arithmetic check (`lineNeedsCheck` from the in-flight track) runs live per line, and the
  summary row runs `totalsMismatch` live. Both are hints, never blocks: Save is always allowed.
- On save: `items` counts as a changed field for `totals_mismatch` (`DEPENDS_ON` gains it); the receipt is marked
  reviewed; line warnings hide (reviewed). P1-5's muted line carries a remaining `totals_mismatch`.
- Undo review (or the toast Undo): warnings show again for any line that still doesn't add up.

### API and schema

- `PATCH /api/receipts/[id]` gains `items`: the whole ordered list, `{ id?, name, quantity, unitPrice, totalPrice }[]`,
  replacing the receipt's lines in the same transaction as the field changes, positions rewritten 0..n−1. Lines
  with an `id` that belongs to the receipt keep their id and confidence when unchanged; others are inserted. Sent
  only when the lines changed. Full replacement matches how `complete` writes lines and keeps the server simple.
- The route still checks `{ reviewed }` by hand before calling `parseReceiptPatch`. The field validation itself is
  already a strict zod schema (`receipt-patch.ts`). Fold `reviewed` and `items` into that schema (`items:
  z.array(itemSchema).max(200)`, reusing `amount()` and `limited()`), so the route has one parse and one error shape.
  Check that a 200-line body fits `MAX_FORM_JSON_BYTES`, or give this route its own limit.
- The repository `update` takes `items?` and recomputes reasons with the new lines; members still edit only their own
  uploads (`writable`).
- Concurrency: two people editing one receipt, or an edit racing a retry, is rare before launch. Follow-up: the client
  sends the `updatedAt` it loaded, and the server answers 409 "This receipt changed since you opened it. Reload to see
  the latest" when it differs.
- Schema: no new table or column for editing itself. Decision 2 changes `receipt_items.quantity` from `integer` to
  `numeric(12,3)` with `CHECK (quantity > 0)`, backfilled from `raw_json` where the extracted quantity wasn't whole;
  `storableQuantity` keeps 3 decimals; the CSV and the view print it without trailing zeros ("1.25"). An "edited by a
  person" marker isn't needed: `confidence = null` already says it.

### PR split

1. **Decimal quantity** (S, schema; decision 2). Migration, `storableQuantity`, types, CSV, the view. Unblocks the
   arithmetic check for weighed lines. Database skill applies.
2. **Edit, add and delete lines** (M, the first line-editing PR). The editor's Line items section (desktop table,
   phone blocks), live arithmetic hints with "Use 690.00", the summary row, inline delete undo, "Save and mark
   reviewed" plus the save toast with Undo, focus after save; PATCH `items` with the schema fold; repository
   replacement and `DEPENDS_ON`. Tests: core unit (parse, reasons), repository integration (replace, scope, member
   can't edit another's), one e2e (fix a line → save → reviewed → toast Undo restores). Removes "Line items can't be
   edited yet".
3. **Follow-ups** (S each): "Show only lines to check" for long receipts; "View photo" in the phone editor and
   P2-6; move up/down; 409 on a stale edit.
4. **Page copy and header** (S, independent of 1–3): P1-1 to P1-4, P1-6, P2-1 to P2-5.

## Receipts list: the Status column

**What it does today** (`receipt-list.tsx` `ReviewBadge`, `history-results.tsx` `RowStatus`):

| Receipt                                    | Status shown                                   |
| ------------------------------------------ | ---------------------------------------------- |
| Completed, reviewed                        | "Checked" (green)                              |
| Completed, not reviewed, has reasons       | "Needs review" (amber)                         |
| Completed, not reviewed, no reasons        | blank (screen readers hear "Done")             |
| Scanning                                   | "Scanning" badge                               |
| Failed                                     | "Couldn't scan" badge and Try again            |

The "Needs review" filter matches the amber badge exactly, so the filter is consistent. The blanks are the problem:

- **Old receipts were never checked.** Migration 0003 gave receipts that existed before the checks only
  `{low_confidence}`, and only when confidence was under 0.9. A receipt from before then with no date, or whose
  amounts don't add up, has `review_reasons = '{}'` and shows blank. That is the owner's "no date, yet no flag" row
  (reproduced in the seeded list). Decision 7.
- **Blank is ambiguous.** It reads as "unknown" or "not done", not "passed every check".
- **Duplicates.** Three rows of one store for 3,701.60 and two identical 185.00 rows on one day: nothing flags them.
  Duplicate detection is planned in the fields review (`duplicate_of`, flagged, never blocked); it would add a
  "Possible duplicate" reason, so it lands in this same column and the Needs review filter. Not in scope here.
- On screens below `lg` the column moves under the merchant name; at 390 the badge sits at the end of the date line,
  which works.

**Recommended vocabulary** (decision 6):

| State                                  | Shown                                   | Style                              |
| -------------------------------------- | --------------------------------------- | ---------------------------------- |
| Has reasons, not reviewed              | **Needs review**                        | amber badge with icon (as now)     |
| Reviewed                               | **Reviewed**                            | muted text with a check icon, not a green badge: green on most rows is noise, and the work is done |
| No reasons, not reviewed               | **Not reviewed**                        | muted text, no icon                |
| Scanning                               | **Scanning**                            | as now                             |
| Couldn't scan                          | **Couldn't scan** · Try again           | as now                             |

Never blank: every completed row says one of the three. "Looks fine" was considered and rejected: the checks only
prove the numbers are present and add up, not that they were read right. Colour is reserved for rows that need the
person; icons carry the meaning too, so colour is never the only signal.

**Why it needs review, without opening it.** Desktop: the Needs review badge gets a tooltip with the first reason in
plain words ("The amounts add up to Rs 3,915.00, but the total says Rs 4,294.00"), and the same text as its
accessible description. Phones have no hover, so on phones the reason's short form shows as the row's second line in
place of the category ("Needs review · No date found"). Short forms: No merchant · No date found · No total ·
No currency · Amounts don't add up · Date unclear · Hard to read.

## Receipt date and the day it was added

**Today.** The list shows only the receipt date (BS · AD, stacked to two lines for BS), "—" when none was read. The
list's default order is **upload time, newest first** (`NEWEST_FIRST`, `{ by: "uploaded" }`), but no column shows
upload time and the sort headers offer only Merchant, Date and Total, so once you sort you can't get back to the
default except by clearing the URL. The date-range filter reads `receipt_date` only, so a receipt with no date never
matches a range; Spending uses `coalesce(receipt_date, created_at)`, so the two disagree on undated receipts. The
receipt page shows "Uploaded <date, time> UTC" only while the receipt isn't completed.

**Recommended** (decisions 8 and 9):

- **Default order stays "newest added first"**: a bill from 2017 scanned today belongs at the top, because the
  person is looking for what they just added. Sorting by receipt date is for bookkeeping and stays one tap away.
- Make the order visible: a "Sort" select over the list on every width, "Added (newest first)" · "Receipt date" ·
  "Total" · "Merchant", replacing the clickable headers on desktop (keep `aria-sort` on the active column header).
  Phones have no sort today; this gives them one.
- **No "Added" column.** The table already runs out of width at 1440 with Category and Uploaded by. Instead, a muted
  second line under the merchant: "Added today" / "Added 3 Nov" (and "by Asha" in a shared workspace, replacing the
  separate "Uploaded by" column at xl). On phones the row's second line is already date · category; add "Added 3 Nov"
  only when the list is sorted by added and the receipt date is more than 7 days earlier, so the usual case adds
  nothing.
- BS dates: the stacked BS over AD in the Date column makes every BS row two lines tall on desktop. Keep it; the
  merchant cell becomes two lines too with "Added …", so the row height is the same and rows line up. On phones the
  date line is already one line ("20 Kartik 2083 · 6 Nov 2026"); at 390 it fits.
- The From and To filter inputs are native AD date pickers showing "mm/dd/yyyy" (US order) on desktop. A BS user
  can't filter by BS months. Follow-up: the editor's AD · BS toggle on the filter, and month presets ("This month",
  "Last month" in the calendar the workspace uses).
- Phone rows: the Needs review badge is pushed to its own line (`ml-auto` wraps), so flagged rows are taller than the
  rest. With the short reason replacing the category on flagged rows, the badge fits on the date line.
- Missing date: "No date" in muted text, not "—", in both the table and phone rows (the phone row already says "No
  date"); the column's sort puts them last, as now.
- **Receipt page:** a quiet meta line under the photo card's file name, on every receipt: "Added 14 Nov 2026, 17:45
  · by Asha" (by only in shared workspaces), in the viewer's time zone (the dashboard's time-zone cookie), not UTC.
  Not in the Details card: the Details card is what was read from the bill, and the added date isn't.
- Filter label "Receipt date", with undated receipts counted by the day they were added (decision 9), matching
  Spending.
