# Design review: signed-in app and admin (2026-11-04)

Reviewer: principal product design. Scope: `/app/*` and `/admin/*`, dark theme, 1440 / 768 / 390px.
Method: design-critique, accessibility-review (WCAG 2.1 AA), ux-copy, dataviz (meter, numbers) and
web-interface-guidelines passes over screenshots plus code. Read-only; nothing committed.

Screenshots live in the session scratchpad `shots/app/` (paths are given by name below). Extra states
captured for this review: `state-edit@1440`, `state-delete-confirm@1440`, `state-switcher-open@1440/@390`,
`state-history-grocery@1440`, `tablet-*@768`. Receipt ids: `a521…` NPR 97%, `35bd…` Trader Joe's 72%,
`4e4a…` failed, `704e…` processing.

Severity: **owner-blocking** means it's wrong, broken or misleading and should be fixed before real users
see it. **polish** means it works but reads as unfinished. **idea** is optional.

## Overall impression

The visual system is consistent: emerald on near-black, mono numerals, and quiet card chrome, and the
admin area reuses it well. The weak spot is how the app shows data. The numbers and states users act on
(confidence, status, totals, usage) are styled the same whether they're good, bad or missing, so the
UI looks confident even when the data isn't. On mobile the main table hides the money column.

## 1. Owner-blocking

| # | Finding | Evidence | Fix |
|---|---|---|---|
| B1 | **Category filters return nothing for most rows.** Chips come from the AI enum (`Grocery, Restaurant, Gas…`), while `category` is free `text` and stored rows hold `Groceries, Meals, Fuel, Office`. Clicking "Grocery" shows the empty state even though 2 grocery receipts exist. | `state-history-grocery@1440`; `history-table.tsx:18,50`; `packages/ai/src/categories.ts:10`; `packages/db/src/index.ts:52` | Normalise on write in core (map synonyms to the enum, otherwise `Other`) and backfill existing rows. Until then, build chips from the distinct categories present, or match case-insensitively by stem. |
| B2 | **Search and filters only cover the current page.** `filtered` runs over `receipts` (one page), and the empty-state copy admits it ("these narrow the current page"). With more than one page, searching for a merchant on page 2 returns "No receipts found". | `history-table.tsx:47-55,121` | Put `q` and `category` in the URL and filter server-side in the core query. Then remove the caveat from the empty-state copy. |
| B3 | **Failed and processing rows look like real $0.00 receipts.** "Untitled / No date / Other / $0.00 / 0%" reads as data. In the list, the Total and Confidence columns sum and compare fake zeros. | `app-history@1440` rows 7-8; `history-table.tsx:151-157` | For any status other than `completed`, render an em dash in Date/Category/Total/Confidence and show the file name (`rawJson.fileName`) as the merchant, muted. Processing: show "Extracting…" with a spinner. Failed: show "Failed · Retry". Never format a null total as money. |
| B4 | **Confidence is always emerald, so 72% looks as good as 99%.** On the detail page, the per-item `confidence` (0.72) exists in `rawJson` but nothing is highlighted, so the user can't tell which field to check. | `app-history@1440` (72% green); `receipt-result.tsx:46,80-86`; `history-table.tsx:157` | Use status tokens with an icon and a label, never colour alone. ≥90: emerald "High". 75-89: amber "Check". <75: red/amber "Review" with a `TriangleAlert`. On the detail page, tint low-confidence rows and fields (amber left border, `aria-describedby` "Low confidence, please verify"). Add a "Needs review" filter chip to History. |
| B5 | **The usage meter is fake and contradicts the plan.** The sidebar hard-codes `23` and `w-[46%]` "/50 this month", but the plan is **50 receipts per day** (Settings and `plans.ts:17`). Users will hit a quota the meter doesn't show. | every `/app` shot; `app/app/layout.tsx:51-60`; `lib/plans.ts:17`; `lib/quota.ts` | Read the real count from the quota service and label it "{used} / {limit} today". Make it a `role="meter"` with `aria-valuenow/min/max` and `aria-label="Receipts used today"`. The track `#27272a` on `#141416` is 1.24:1, so use a lighter track or a fill ≥3:1. At ≥80% switch the fill to amber and add "Resets at 00:00 UTC". Hide the meter for an unknown plan rather than show a fake number. |
| B6 | **Mobile has no primary nav.** At <768px the header holds only brand, switcher and avatar. History and Settings are reachable only through the avatar menu (Settings) or the "Back to history" link. Admin on mobile shows just the word "Admin", so Organizations can't be reached at all. | `app-upload@390`, `admin-users@390`; `app/app/layout.tsx:64-70`; `app/admin/layout.tsx:68-69` | Add a fixed bottom tab bar (Upload / History / Settings, 56px tall, `aria-current="page"`), or a hamburger sheet that reuses the `nav` array. Do the same for admin with Users / Orgs / Back to app. |
| B7 | **The History table loses Total, Confidence and Open on mobile and tablet.** The table scrolls sideways inside the card with no visible cue. At 390 and 768 the money column is off-screen and dates wrap to two lines. | `app-history@390`, `tablet-history@768`; `history-table.tsx:95-96`; `packages/ui/src/components/table.tsx:6` | Below `md`, render each receipt as a stacked card row: merchant and total on line 1, date, category and confidence chip on line 2, with the whole row as one link. At `md-lg`, drop Status into a dot before the merchant and use `whitespace-nowrap` on Date. |
| B8 | **Destructive and privileged actions have no confirmation.** Removing a workspace member fires on a single tap of a ghost trash icon. Admin row actions (Demote, Promote, Revoke sessions, Impersonate) run immediately, and the only admin can demote themself from the row menu. | `members-manager.tsx:85-95,204-213`; `app/admin/users/row-actions.tsx:73-127` | Add a shared `ConfirmDialog` primitive in `packages/ui`. Its copy names the target and the consequence, e.g. "Remove maya@x.com? They lose access to this workspace's receipts." with buttons "Remove member" / "Keep". Hide Demote for the current session user, and require a typed confirmation for Impersonate. |
| B9 | **Hydration error on /app/settings.** `<Badge>` renders a `<div>` inside `CardDescription` (`<p>`). The console logs "<div> cannot be a descendant of <p>", which causes a client re-render. | console from `states.mjs`; `app/app/settings/page.tsx:38`; `packages/ui/src/components/badge.tsx:26` | Make Badge render a `<span>` (it's inline-flex already). That fixes every Badge placed in body copy. |
| B10 | **Currency formatting is inconsistent and misleading.** `money()` hard-codes the `en-US` locale, so NPR shows as "NPR 3,138.00" (code prefix), INR as "₹10,624.82" and USD as "$44.74". A column mixing symbols and codes doesn't align on the decimal and implies the totals are comparable. | `app-history@1440` Total column; `lib/format.ts:1-7` | Use `currencyDisplay: "narrowSymbol"` everywhere, or a fixed scheme: the amount right-aligned with `tabular-nums`, plus a separate small mono currency code column (`NPR`, `USD`, `INR`). Use the workspace locale, not the hard-coded `en-US`. Never add up across currencies. |

## 2. Receipt detail

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| D1 | polish | Toolbar shows Edit / Copy JSON / Export CSV for **failed and processing** receipts, so it offers to export $0.00. Failed has no retry. | `app-receipts-4e4a…@1440`; `receipt-result.tsx:40` | When status ≠ completed, hide Export/Copy. On failed, show a primary "Re-upload" and secondary "Delete". On processing, show only Delete. |
| D2 | polish | The failed banner says the same thing twice: "…Try again with a sharper photo. Try re-uploading the receipt." | `4e4a…@1440`; `receipt-result.tsx:35-36` | Use the provider message only, otherwise fall back to "We couldn't read this receipt. Re-upload a flat, well-lit photo." Put an action button inside the banner. |
| D3 | polish | The raw JSON `<pre>` sits on the main surface. On mobile it takes the bottom third of the page, and it duplicates Copy JSON. | `35bd…@390`; `receipt-result.tsx:103-105` | Collapse it into a `<details>` "Raw extraction (JSON)", closed by default. Or remove it, since Copy JSON already covers it. |
| D4 | polish | On mobile, the 4 actions wrap into a ragged right-aligned 2+2 block under the title. | `35bd…@390`; `receipt-actions.tsx:75-76`; `receipt-actions.tsx:150` | Below `md`, use one row: primary "Export CSV" full-width, plus a `…` overflow (Edit, Copy JSON, Delete). On desktop, keep Edit and Export visible and move Copy JSON and Delete into the overflow. |
| D5 | polish | Edit mode turns "Editing" emerald next to emerald "Export CSV", so there are two primaries. The form pushes the image and the line items below the fold, and you can't see the receipt while correcting it. | `state-edit@1440`; `receipt-actions.tsx:77-79`; `receipt-editor.tsx:80` | Edit in place: swap the right-hand "Extracted Data" card into the form, so the image stays beside it. Keep the Edit button outline with `aria-pressed`. Put low-confidence fields first, with an amber hint. |
| D6 | **owner-blocking** | The editor's category `<select>` can't represent stored values. "Groceries" displays as "Grocery" (first option), while the draft still holds "Groceries". What you see is not what saves. | `state-edit@1440` (Grocery shown, badge says Groceries); `receipt-editor.tsx:27,121-132` | Fixed by B1 normalisation. Defensively, if the value isn't in the enum, add it as a selected option labelled "Groceries (unrecognised)". |
| D7 | polish | Line items can't be edited ("Line items keep their original values"), and Tax and Total can be edited into a state where they disagree with the items. Subtotal and Tip are never shown on the read view. | `receipt-editor.tsx:87`; `receipt-result.tsx:89-98` | Read view: show Subtotal / Tax / Tip / Total, plus a mismatch warning when items + tax ≠ total. Editor (later): an editable items table. |
| D8 | polish | Dates appear as ISO `2026-10-27` in History and detail, `27/10/2026` in the native date input, "Nov 4, 2026" in the admin list and `11/4/2026, 12:14:19 AM` in admin detail. `toLocaleString()` without a fixed locale also risks hydration mismatches. | `admin-users-O3c2…@1440`; `users-table.tsx:33`; `admin/users/[id]/page.tsx:118,133` | Add one `formatDate()` / `formatDateTime()` in `lib/format.ts`: "27 Oct 2026" for display, mono ISO only inside data tables, fixed locale and time zone on the server. |
| D9 | polish | Delete confirm uses `role="alertdialog"`, but focus stays on the trash icon, and Escape and focus-return aren't handled. The confirm "Delete" button is low-emphasis translucent red. | `state-delete-confirm@1440`; `receipt-actions.tsx:89-122` | Move focus to "Cancel" on open, close on Escape, and return focus to the trigger. Label the button "Delete receipt" with a solid red fill. Use the B8 `ConfirmDialog`. |
| D10 | polish | The placeholder caption at `text-muted-foreground/60` is 3.1:1, which fails 1.4.3. | `receipt-result.tsx:60` | Use the full `text-muted-foreground` (6.6:1). |

## 3. History and status

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| H1 | polish | Status shows raw lowercase enum text with a 6px dot: "completed / failed / processing". | `history-table.tsx:138-149` | Use a `StatusBadge` with sentence-case labels ("Done", "Failed", "Extracting…"), an icon (check / alert / spinner) and colour tokens. Use it in History, detail and admin. |
| H2 | polish | The whole row isn't clickable. An "Open" pill (32px tall) is the only target, and it repeats 8 times. | `history-table.tsx:158-162` | Make the merchant cell a link with a stretched pseudo-element covering the row, plus a hover/focus row style. Drop the Open column. |
| H3 | polish | Numeric alignment: Total and Confidence are right-aligned but aren't tabular, and the mixed NPR/₹/$ prefixes shift the digits (see B10). The Confidence header sits right-aligned over a column that has an empty 7th cell after it. | `app-history@1440` | Add `tabular-nums`, align the currency code in its own column, and remove the trailing column (H2). |
| H4 | polish | 11 category chips wrap to 3 rows on mobile (all 32px tall) and push the table down. | `app-history@390` | Below `md`, use a single `<select>`/combobox "Category: All", or one horizontally scrollable chip row. Use `aria-pressed` on the chips. |
| H5 | idea | Add a summary strip above the table: receipts this month, total per currency, and a "Needs review" count (from B4). | — | Use stat tiles, not a chart. One currency per tile. |

## 4. Upload

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| U1 | polish | Three marketing cards (Extracted / Structured / Private) take more space than the action. "your keys never touch the browser" is developer copy. | `app-upload@1440`; `upload-panel.tsx` | Remove the cards and keep the tips. Below the dropzone, show "Recent uploads" (last 5, with StatusBadge), which also gives processing items a home. |
| U2 | polish | On mobile the dropzone copy says "Drop receipt images here", which doesn't apply to touch. | `app-upload@390` | Below `md`: "Take a photo or choose images", with two buttons (camera via `capture="environment"`, library). |
| U3 | polish | Show the quota before upload: "12 of 50 left today" near the Process buttons, so the queue doesn't stop mid-batch (`upload-panel.tsx:154`). | — | Reuse the B5 data. |

## 5. Settings, members and workspace switcher

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| S1 | polish | Invite copy is stale: "Until email delivery is wired up, share the generated link below". Email delivery shipped in `16ec20b`. | `app-settings-members@1440`; `members-manager.tsx:230` | "We'll email them an invite link. It expires in 48 hours." Keep a "Copy link" action as a fallback. |
| S2 | polish | Disabled primary buttons ("Save", "Change password", "Invite") render as 50%-opacity emerald (3.3:1) with no reason given. They read as broken, not unavailable. | `app-settings@1440`, `app-settings-members@390` | Keep them enabled and validate on submit with inline errors. Or use a neutral disabled style plus a hint ("Change your name to save"). |
| S3 | polish | Role is a native `<select>`, 32px tall, in lowercase ("member", "owner"), next to a 32px ghost trash icon. | `members-manager.tsx:188-213,244-246` | Use a shadcn-style Select primitive in `packages/ui`, 40px tall, with sentence-case labels and one-line role descriptions. Put the remove action behind B8. |
| S4 | polish | The workspace menu on mobile overflows the viewport on the right (`left-0 w-64` anchored to a 144px trigger at the right edge), so the name and "Upgrade…" are clipped. | `state-switcher-open@390`; `workspace-switcher.tsx:118` | Use `right-0` below `md` (or collision-aware positioning) and `max-w-[calc(100vw-2rem)]`. |
| S5 | polish | "Upgrade to add workspaces" is a dead, disabled row with a lock, and Plans & Billing is "SOON". | `state-switcher-open@1440` | Link it to Settings → Plan, or reword it as "Free plan includes 1 workspace". |
| S6 | polish | Settings: the Plan tiles show limits but not usage ("50 receipts per day" without "23 used"). The "Delete account" card is good: it uses typed confirmation. | `app-settings@1440` | Show "23 / 50 today" in the tile, using the same component as the sidebar meter. |
| S7 | polish | The Workspace & members card is a whole card for a single link. | `app-settings@1440` | Fold it into a member-count row: "1 member · Manage →". |

## 6. Admin

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| A1 | polish | The row-actions menu has `role="menu"` but no Escape, arrow keys or focus move. Errors render as an absolutely positioned bubble that can cover the next row. | `row-actions.tsx:35-45,70-73,130-134` | Use the same Menu primitive as the switcher and user menu (a Radix DropdownMenu is the simplest option). Show errors as a toast or inline row message. |
| A2 | polish | The ban dialog has `role="dialog"` but no `aria-modal`, no `aria-labelledby`, no Escape, no focus trap and no initial focus. | `ban-dialog.tsx:33-40` | Use the B8 dialog primitive. |
| A3 | polish | Mobile admin table clips the Joined and Actions columns, so there's no way to act on a user on a phone. | `admin-users@390` | Use the stacked-row pattern from B7. |
| A4 | polish | Sessions show raw IPv6 `0000:0000:…:0000` and full user-agent strings. | `admin-users-O3c2…@1440`; `[id]/sessions-list.tsx` | Show the compressed IP (`::`), a parsed UA ("Chrome 156 · macOS"), "This session" on the current one, and relative times. |
| A5 | polish | The App sidebar has no active-nav state, while the Admin nav does. The App sidebar also has no Admin entry; it's only reachable from the avatar menu. | `app/app/layout.tsx:38-49` vs `admin/admin-nav.tsx:20` | Share one `SidebarNav` with `aria-current="page"` and an active style. Add a 4th "Admin" item for admins. |

## 7. Accessibility summary (WCAG 2.1 AA)

| Check | Result |
|---|---|
| Text contrast | Pass: `--muted-foreground #9a9aa3` on bg 7.1:1, on card 6.6:1; primary on card 9.6:1. Fail: `muted/60` 3.1:1 (D10). |
| 1.4.11 non-text | Fail: input/card borders `#27272a` are 1.24-1.33:1 against their surface, so inputs are identified by a border that doesn't meet 3:1. Raise `--border` for inputs to around `#3f3f46`, or add a fill. The meter track also fails (B5). |
| Colour only | Fail: confidence is colour-agnostic, and status relies on the dot plus raw text (B4, H1). |
| 2.5.5 target size | Fail at 390px: chips 32px, Open 32px, switcher 36px, avatar 36px, Prev/Next 32px, row icons 32px. Use `h-11` touch sizes below `md` (Button `size="sm"` → `max-md:h-11`). |
| Focus | Buttons have `ring-2`. Inputs and native selects change only the border colour (1px), which is weak; add `focus-visible:ring-2 ring-ring/50`. Menus and dialogs lack focus management (A1, A2, D9). |
| Names and roles | The meter has no role (B5). Category chips have no `aria-pressed`. Sidebar nav has no `aria-current`. |
| Robustness | `<div>` in `<p>` causes a hydration error (B9). |

## What works

- One coherent token set: emerald is used sparingly in body UI, and the mono numerals give the data the intended "instrument" feel.
- The processing banner auto-polls with clear copy, and the typed-email delete-account confirmation is good.
- The admin user detail layout (profile / orgs / sessions) is well grouped, and the Plans & Billing "SOON" placement is honest.

## Priority order

1. B1 + D6 Category normalisation: it fixes the filters and the editor.
2. B3 + D1 + D2 States that aren't completed: no fake $0.00, plus correct actions per state.
3. B4 Confidence tiers, field highlighting and a "Needs review" filter.
4. B5 Real "today" usage meter with role=meter.
5. B6 + B7 + A3 Mobile nav and stacked rows.
6. B8 + D9 + A1 + A2 Shared ConfirmDialog / Menu primitives.
7. B2 Server-side search and filter.
8. B10 + D8 + H3 One money and date formatter, tabular numerals.
9. B9 Badge as a span.
10. Touch targets ≥44px and input focus/border contrast (section 7).
