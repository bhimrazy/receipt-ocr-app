# Design critique: signed-in app (2026-11-12)

Read-only review of `apps/web` on `main` at `297c628`, done by reading the code. Covers web (1280) and phone (390)
for three kinds of user: someone on their first receipt, someone on their everyday scan-and-check, and a power user
(hundreds of receipts, or a workspace admin).

Screenshots: none. The compose stack and a dev server ran with a seeded test account, but headless Chromium and
WebKit both need system libraries (`libatk-1.0` and others) that this machine doesn't have, and installing them
needs `sudo`. Everything was stopped and the test database dropped. Take the screenshots again on a machine with
Playwright's system dependencies before any of these changes ship.

## Summary

The app does its core job well: honest copy, a clear "To check" queue, careful tap targets and focus rings. It falls
short in three places. **Reviewing receipts never finishes:** the warning box can't be closed and nothing marks a
receipt as checked. **The receipt list is built for 20 receipts, not 500:** no sorting, no bulk actions apart from
"Add to group", and deleting only works from inside a receipt. **Home tries to do everything:** upload, a to-do
list, eight spending cards and recent receipts all on one page. Most fixes are S or M. The largest gain for the
effort is a "checked" state per receipt (finding 1), which also fixes the "Needs review" count on Home.

## Findings, ranked by user impact

### 1. The review warning can't be dismissed, and no receipt is ever "checked" (owner point 1)

**What's wrong.** `ReceiptWorkspace` (`components/receipt-actions.tsx`) shows "Check this receipt before you export
it" whenever `checksFor()` (`components/receipt-result.tsx`) returns anything. It has no close control, and nothing
is stored when someone has looked. Two problems follow:

- "Needs review" is just `confidence < threshold` (`packages/core/src/repository.ts`, `needsReview`). A person can
  check or correct a receipt and it still counts on Home and still matches the filter, permanently. The Home queue
  never empties.
- The total check flags many receipts that are correct. `totalsMismatch()` computes `(subtotal ?? sum of lines) +
  tax + tip` and compares that with the total. On tax-inclusive receipts (UK/EU VAT, and Japan, which already
  appear in the test data), the lines already include the tax, so the tax is counted twice and every such receipt
  is flagged. Discounts and coupons are flagged too. Line items can't be edited ("Line items can't be edited yet"),
  so the person has no way to make the warning go away. This is probably most of what the reviewers complained
  about.

**Who it hurts.** Everyday users most: they see the same warning on every European receipt. Power users can't
use "Needs review" as a work queue.

**Recommendation.**

1. *Store a "checked" state on the server, per receipt and for the whole workspace.* Add `receipts.checked_at` and
   `checked_by`. Don't use a cookie or `localStorage`: the warning would come back on another device and for
   teammates, and Home's count would never fall.
2. *Behaviour:*
   - Put an X (44px target, `aria-label="Dismiss: the details are right"`) in the top-right corner of the warning
     box. Next to the existing "Correct details" button, add a text button "Details are right". The X and this
     button do the same thing.
   - Either one sets `checked_at`. The box collapses, and a toast "Marked as checked" with **Undo** appears.
   - Saving the editor also sets `checked_at`, because a person has now looked at the receipt.
   - Once checked, the box never comes back for that receipt, for anyone. The only exception is when the receipt
     is scanned again (Try again or retry), which clears `checked_at`.
   - "Needs review" becomes `completed AND confidence < threshold AND checked_at IS NULL`, so Home's count and the
     History filter both go down.
   - In lists, a checked low-confidence receipt shows no confidence badge, or a small "Checked" badge. Owner
     decides.
   - In place of the box, a quiet line under the header keeps the action visible and reversible: "Checked by
     {name} · {date} · Undo".
3. *Fix the false positives before showing the box at all.* Don't flag when the total equals the sum of the lines,
   or equals the subtotal (tax already included), within 0.01. Treat a negative line as a discount.
4. *Copy:*
   - Heading stays: "Check this receipt before you export it".
   - Total check: "The lines add up to {expected}, but the receipt total is {total}. A discount, a coupon or tax
     already included in the prices often explains this. Compare the total with the {photo}."
   - Toast: "Marked as checked". Action: "Undo".

**Effort.** M: a migration, a PATCH field, the count query and the UI. Step 3 alone is S and can ship first.

### 2. Deleting exists but is hard to find, and nothing works on many receipts at once (owner point 3)

**What exists.** `DELETE /api/receipts/[id]` works and is wired up. Members can only delete their own receipts, and
a confirm dialog asks first. In the UI:

- Desktop, completed receipt: the "..." menu next to Export CSV, then "Delete receipt".
- Desktop, failed or still scanning: a visible "Delete" button.
- Phone: the "..." in the top app bar opens a sheet, and the last row is "Delete receipt".
- History and Home rows have no delete at all.

So the owner's "no way to delete" is about finding it, not a missing feature. On a completed receipt it sits two
levels deep, behind an unlabelled icon.

**What's missing.**

- Pagination exists: 25 a page, Previous/Next, "page N of M" (`history-results.tsx`). There is no page-size choice,
  even though the API allows up to 100, no jump to a page, and no "26–50 of 312".
- Multi-select exists but is hidden: a "Select" button on the groups row turns on a checkbox list
  (`group-select-list.tsx`). It only offers "Add to group", only covers the current page, and the selection is lost
  when the page changes.
- No bulk delete, no export of selected receipts, and no sorting. The list is always newest upload first: it can't
  be sorted by date, amount or merchant.
- No "Uploaded by" column, which a workspace admin needs.
- No row numbers.
- The desktop table only starts at `lg` (1024px). Between 768 and 1023 there is a sidebar plus a stacked list.

**Who it hurts.** Power users and admins most: removing 40 test or duplicate receipts takes 40 trips into a
receipt. First-time users who upload the wrong photo can't see how to undo it.

**Recommendation.**

*Desktop table:*

- Always show a checkbox column, with select-all in the header.
- Columns: Merchant · Date · Category · Total · Status. Merge Status and Confidence into one column that shows only
  what needs attention ("Needs review", "Couldn't scan", "Scanning"); today both columns are mostly dashes. Add
  "Uploaded by" when the workspace has more than one member.
- Sort by clicking the Date, Total and Merchant headers, kept in the URL as `?sort=`.
- Footer: "26–50 of 312" · rows per page (25/50/100) · Previous/Next.
- Once something is selected, a sticky bar shows "{n} selected · Add to group · Export CSV · Delete". When every row
  on the page is selected, offer "Select all 312 that match" (the filters are already in the URL).
- Rows keep a trailing "..." menu: Open, Add to group, Delete.
- Start the table at `md` with fewer columns, rather than at `lg`.

*Phone list:*

- Keep the rows. Put a "Select" text button in the app bar on History (the `AppBarActions` slot exists). A long
  press on a row also starts selection.
- In selection mode, the bottom bar replaces the tab bar: "Add to group", "Export", "Delete". No swipe-to-delete:
  it's easy to trigger by accident and can't be undone.

*Delete:*

- New endpoint `DELETE /api/receipts` with `{ ids }`. Apply the same rules as for one receipt, and return "deleted n,
  skipped m (uploaded by someone else)" so the toast can say so.
- Run the storage clean-up as a job kind, not inline.
- Owner decision: a 30-day "Recently deleted" (soft delete) versus an immediate hard delete with a stronger confirm
  ("Delete 40 receipts? Their photos and data are removed for everyone in this workspace. This can't be undone.").

*Row numbers:* show the range ("26–50 of 312") instead of a `#` column. Numbers change with every sort and filter,
so they can't be quoted. If accountants ask for a stable reference, add a short receipt ID instead.

*Detail page:* move "Delete" out of the overflow on desktop and make it a visible ghost button. The phone sheet is
fine.

**Effort.** L overall. It splits into: selection that works across pages, with delete and export (M); sorting and
page size (S); the table at `md` and the Uploaded-by column (S).

### 3. Home is overloaded (owner point 4)

**What's wrong.** `/app` stacks four things: the upload panel, "To check" (or "How it works"), the spending
dashboard and "Recent receipts". The dashboard alone has This month, five KPI tiles, Spend over time, Last 12
months, By category, Top merchants, Largest receipts and By day of the week. At 390px, "Recent receipts", the list
people come back for, ends up below roughly eight cards. The description under the title is two sentences long,
and the upload panel is the same one as on the Scan page.

**Who it hurts.** Everyday users scroll past charts to find their receipts. For first-time users the page is fine,
because the dashboard is hidden until something has been scanned.

**Recommendation.**

- Home answers two questions: "what needs me?" and "what happened lately?". Order: To check, then Recent receipts
  (6 rows), then a compact upload (a dropzone on desktop; on phones the Scan tab does this, so leave it out), then
  the This-month card with a "See spending" link.
- Move the rest of the dashboard to its own **Spending** page (finding 4).
- Cut the description to one line, or remove it once the workspace has receipts.
- Keep "Scan your first receipt" and "How it works" for an empty workspace. They work well.

**Effort.** M. The parts already exist; the work is moving them.

### 4. Navigation labels and structure (owner point 2)

**What's wrong.**

- "History" names a log of activity, but the page is the receipt library: search, filters, export, groups. People
  will look for "Receipts".
- Spending insights have no section of their own; they are hidden on Home.
- "Groups" is fine as a word. As a top-level tab, though, it is a management page (create, rename, delete).
  Browsing by group already happens through the chips on History.
- The verbs disagree: tab "Scan", page title "Upload receipts", Home step "Add receipts", desktop link "Upload
  another", status "Scanning".
- On desktop the sidebar has no Upload or Scan entry (`APP_NAV` has none). From History or Groups there is no way to
  add a receipt without going back to Home.

**Who it hurts.** Everyone, a little, on every visit. First-time users most.

**Recommendation.**

- Rename **History → Receipts** in the nav, page title, Back labels and metadata. Effort S, and worth doing on its
  own.
- Target structure. Desktop sidebar: a primary "Add receipts" button at the top, then Home, Receipts, Spending,
  Groups, Settings, and Admin below, under "Platform" as today. Phone tabs: Home · Receipts · (Scan) · Spending ·
  Settings. Groups moves into Receipts: the chips stay there, and "Manage groups" stays reachable from Receipts and
  from Settings.
- One verb: the button and tab say **Scan** on phones and **Add receipts** on desktop. The page title becomes "Add
  receipts", and the status stays "Scanning".
- Keep "Home". "Dashboard" would set up an expectation of charts, which move to Spending.

**Effort.** Rename S. New structure M: it depends on finding 3, and the `MOBILE_TABS` switch already makes the tab
change cheap.

### 5. Checking 20 receipts is slow: no "next receipt" (detail page)

**What's wrong.** To work through "Needs review", a person opens a receipt, goes back, opens the next one, and so
on. The receipt page has no Previous/Next and no "Next to check".

**Who it hurts.** Everyday and power users after a batch upload. This is the main repeated task in the app.

**Recommendation.** When the receipt page is opened from a filtered list, keep the filter in the URL (`?from=` or
the list's query) and show "{n} of {m} · Previous · Next" under the header. After "Details are right" or Save,
offer "Next to check →". `j`/`k` keyboard shortcuts on desktop are optional.

**Effort.** M.

### 6. The receipt page's main action is the wrong one

**What's wrong.** On a completed receipt, the primary button (full width on phones) is **Export CSV** for that one
receipt. People export in batches from the receipts list, so this is a rare action. What the page is for, checking
and correcting, is a small "Edit" pinned into the Details card's corner, plus "Correct details" inside the warning.
"Raw extraction (JSON)" and an install offer sit under the line items for everyone, even though JSON is already in
the "..." menu.

**Who it hurts.** Everyday users. The page leads them to export instead of check.

**Recommendation.** The header shows Edit (primary when the receipt has checks, secondary otherwise) and a "..."
menu with Export CSV, Copy JSON and Delete. Remove the raw JSON panel from the page, since "Copy JSON" covers that
need, or show it only to platform admins. Leave the install offer where it is: it has its own dismiss.

**Effort.** S.

### 7. The receipts list on phones shows a lot before the first receipt

**What's wrong.** At 390px, in order: the title with its count, a full-width Export CSV button, search, four status
chips, the "Category and dates" button, group chips (or a sentence about groups), and "Select" plus "Manage groups".
That is about six rows before the first receipt. The "Group receipts by trip…" sentence shows on every visit for
anyone without groups.

**Who it hurts.** Everyday users on phones.

**Recommendation.**

- Phone order: search, then one row of status chips plus a "Filters" button. The button opens a sheet with
  category, dates and groups, and shows a count badge when any are set.
- Export moves into the app-bar "..." on phones.
- Show the groups hint only in the empty state of the Groups page.

**Effort.** S–M.

### 8. Groups page: hard to tap into a group, and no totals

**What's wrong.** In each row, the only link to the group's receipts is the small "12 receipts" text
(`groups-manager.tsx`). The name, the large target, does nothing. Rows don't show the group's total spend, which is
why people make a "Trip" or "Client X" group in the first place.

**Who it hurts.** Everyday users who do expenses by trip or client.

**Recommendation.** Make the whole row a link to the receipts filtered by that group, and keep Edit and Delete as
separate buttons. Show "12 receipts · £482.10" (per currency when there are several). Add "Export CSV" to each
group's "..." menu, because "export my trip" is the job.

**Effort.** S for the row link. M for totals, which need a query.

### 9. Settings mixes settings with information, and workspace admins lack basics

**What's wrong.**

- The desktop page is one long column: Plan and usage (meter, three stat cards, a billing card), Workspace,
  Appearance, Receipt scanning, Security, Profile/Email/Password/Delete account, About and Install.
- "Receipt scanning" can't be changed; it only says which model is used.
- There's no way to rename the current workspace in the UI. The only "Workspace name" field is in the create flow
  (`workspace-switcher.tsx`).
- There are no workspace defaults, such as a default currency.

**Who it hurts.** Workspace admins. Everyone else, a little, through length.

**Recommendation.**

- Split into Account (profile, email, password, security, delete), Workspace (name, members, billing, defaults) and
  App (appearance, install, about). On desktop, add a left sub-nav or tabs; phones already use a row list.
- Move "Receipt scanning" into About.
- Add "Rename workspace" for owners and admins.

**Effort.** M.

### 10. Admin console: smaller notes

**What's wrong.** It works, but carries some extra weight: seven sections, plus `/admin/organizations`, a redirect
kept from the rename. "Jobs" is both its own nav item and reached from Operations (Back goes to Operations).

**Who it hurts.** The platform admin only. Low impact.

**Recommendation.** Make Jobs a tab inside Operations and take it out of the top-level nav (six items, and the
phone "More" sheet shrinks). Users table: add sorting by "Used today" and "Joined".

**Effort.** S.

## What works and should stay

- The copy is plain and specific ("Couldn't scan", "Open it to see why", numbers of tries left), and the empty
  states are good.
- The "To check" card on Home is the right idea: a queue with counts and deep links. Finding 1 makes it trustworthy.
- Phone details: the large-title app bar, Back that returns to the filtered list, page actions in the app bar,
  44px targets below `md`, and consistent focus rings.
- Groups' bulk "Add to group" flow, with its result toast ("3 already in it, 1 skipped"), is the pattern that bulk
  delete and export should copy.

## Owner decisions

1. Checked receipts in lists: hide the confidence badge, or show a "Checked" badge (finding 1).
2. Deleted receipts: a 30-day "Recently deleted", or hard delete with a stronger confirm (finding 2).
3. A row-number column, or a "26–50 of 312" range (finding 2; the range is recommended).
4. The navigation target: rename only, or rename plus a Spending section with Groups moved into Receipts
   (finding 4).
