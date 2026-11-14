# Design critique and spec: usage card and plan presentation (2026-11-14)

Critique of the sidebar usage card and the plan lists, and a spec for both under the limits the owner set today. Each
plan is counted per workspace, and an admin can change every limit:

|                 | Free | Pro  |
| --------------- | ---- | ---- |
| Scans a month   | 50   | 500  |
| Scans a day     | 20   | 200  |
| Members         | 2    | 5    |
| Storage         | 100 MB | 5 GB |

Read from the code on `main` at `66b9446`: `components/usage-meter.tsx`, `app/app/layout.tsx`,
`lib/upgrade-level.ts`, `lib/upgrade-copy.ts`, `lib/plan-copy.ts`, `components/billing/*`, `app/pricing/page.tsx`,
`components/landing-page.tsx` and `packages/db/src/index.ts`. No screenshots were taken: no server was running, and
four builds were queued on the build lock with 1.9 GB of memory free, so starting one more would have slowed or
endangered the tracks building. The current card's look is covered by the 1440 and 390 captures in
[the 2026-11-13 billing review](2026-11-13-billing-design.md), and its later fixes (badge, one-line note, amber on
the bar and icon only) are in the code. The engineer who builds this spec takes the screenshots for every state
below.

## Owner decisions

| #   | Decision                                     | Recommendation                                                                                                                                              | Alternative                                                                     |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Per-day number on the card                   | **Only near the day cap**: from 80% of today's limit (Free 16, Pro 160), or once today's limit is used up. Otherwise the card talks about the month only    | Always show it whenever it is the tighter number (today's rule, see finding 1) |
| 2   | Storage on the card                          | **Only from 80% of storage used**, both plans, as a second row. Always shown on Billing                                                                    | Always shown on Pro: about 26,000 receipts of room, so it would read 0% for years |
| 3   | What full storage does                       | **Refuse new uploads** and say why: "Storage full. Delete receipts to make room." plus the upgrade for a Free owner. Deleting frees storage, but not scans | Warn only and keep uploading: then the cap is a claim we don't enforce        |
| 4   | Upgrade offer for the day cap                | **A text link once today's limit is used up**, nothing at 80% of the day (it resets within hours). The button stays for the month at 100%                 | Treat the day like the month (today's code: a button for any block)            |
| 5   | Pro owner at the month limit                 | **"Need more? Contact us"** link, at 100% only. Pro members get nothing                                                                                      | No link: Pro owners find Custom on the pricing page                              |
| 6   | Storage on pricing                           | **List it only in the same release that counts bytes and enforces the cap.** No byte total exists today                                                     | List it now as a "fair use" note                                                |
| 7   | Custom card                                  | **No own keys or own storage on the card** until each ships. Wording below                                                                                  | List them as "Ask about…": reads as available, and none of it is built         |
| 8   | STATUS decision 8 (`user_credentials`, `storage_source`) | **Drop `user_credentials`** (per-user, unused, a secrets table with no code); **keep `receipts.storage_source`** (always `managed`, the BYOK plan needs it) | Keep both until BYOK is built                                                   |
| 9   | Free storage at 100 MB                       | **Keep it**, and make the full state offer Delete and Export. At 195 KB a photo (PR #262) it holds about 500 receipts: 10 months of full Free use         | 250 MB: two years of full use, so Free storage rarely becomes the upgrade lever |

## Critique of the current card

What works: one component everywhere (sidebar, phone account sheet, Billing with `detail`), a `role="meter"` with a
full `aria-valuetext`, amber on the bar and icon only with the words saying it too, mono tabular numbers, and one line
of note.

| #   | Finding                                                                                                                                                                                                                                                                         | Severity | Fix                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| 1   | **The count and the note describe different windows.** "9 / 30 scans" is the month; "18 left today" is the day. `meterNote` shows the day whenever it is tighter, which under 20/50 is every day until 30 are used. A new Free user reads "0 / 50 scans · 20 left today" and can't reconcile 50 with 20 | High     | The month is the headline; the day appears only near its cap (decision 1)                  |
| 2   | **A day near its cap never warns.** `usageWarns` and `upgradeLevel` read the month ratio only, so a Pro workspace at 195 / 200 today and 300 / 500 this month shows a green bar and no icon                                                                             | High     | Amber icon on the note from 80% of either window; the bar stays the month                  |
| 3   | **The scope copy turns false with today's change.** "Free scans are counted per person, across every Free workspace you use" (Billing usage section), `scansLine` "for each member", `scansCell` "per person", the pricing FAQ bullet and the welcome email all state the per-person rule | High     | One line for both plans: "Shared by everyone in this workspace." List in the copy table   |
| 4   | **The upload panel says "today" for the month.** `overLimit` copy is "You have 3 receipts left today", but `usageRemaining` is the tighter of the day and the month                                                                                                        | Med      | "You have 3 scans left this month" when the month is the tighter one                       |
| 5   | **No storage anywhere.** No byte count exists (`receipts` has no size column), so the card can't show it yet. The parallel build has to add one before any surface can                                                                                                     | Med      | Rows spec'd below; ship with the count                                                      |
| 6   | **"Opens tomorrow" is wrong east of UTC.** At 03:00 in UTC+5:45 the day reopens at 05:45 the same day                                                                                                                                                                     | Low      | "opens 00:00 UTC", the form Billing already uses                                            |
| 7   | **Billing's limits line omits the month and storage.** `20 a day · up to 3 members`                                                                                                                                                                                     | Low      | `50 a month · 20 a day · 2 members · 100 MB`                                                |

## Spec: the usage card

### Anatomy

```
+-------------------------------------+
| [Free]                9 / 50 scans  |   badge; count is always the month
| ======------------------------------|   bar: the month, 6 px
| 41 left this month                  |   note: one fact, by the priority below
| Storage              86 / 100 MB    |   storage row: only from 80% (decision 2)
| ===========================---------|   bar: storage, 4 px
| Upgrade >                           |   action: only from 80%, owner on Free (or Pro at 100%)
+-------------------------------------+
```

- **Count:** `<used> / <limit> scans`, used in `text-sm font-semibold text-foreground`, the rest
  `text-xs text-muted-foreground`, `font-mono tabular-nums`.
- **Bars:** the month bar is today's (`h-1.5`); the storage bar is `h-1` so the scan bar stays primary. Track
  `bg-foreground/15`; fill `bg-primary`, `bg-warning` from 80%. Each is its own `role="meter"`: "Scans used this
  month" and "Storage used", with `aria-valuetext` "41 of 50 scans used this month" and "86 of 100 MB used".
- **Note priority**, first match wins: service paused → Free capacity busy → month used up → day used up → storage
  full → day at 80% or more → month at 80% or more → normal.
- **Amber:** the bar of the window that is at 80% or more, and the note icon when the note's fact is a warning. Text
  stays in text tokens. Never colour alone: every amber state has words.
- **Storage numbers:** decimal units. Under 1 GB, whole MB (`86 / 100 MB`); from 1 GB, one decimal GB
  (`4.2 / 5 GB`); under 1 MB used, `<1 MB`.
- **Height:** the skeleton reserves the action row only when the layout already knows an action will render
  (today's `withAction`); add the storage row to that reservation when storage is at 80% or more, so the card
  doesn't jump.

### States

Free owner, checkout open. "Checkout closed" replaces every Upgrade action with
`Pro, with 500 scans a month, opens soon. Compare plans`.

| State                     | Count        | Month bar | Note (icon)                               | Storage row       | Owner action           | Member action            |
| ------------------------- | ------------ | --------- | ----------------------------------------- | ----------------- | ---------------------- | ------------------------ |
| 0%                        | `0 / 50`     | empty     | `50 left this month`                      | hidden            | none                   | none                     |
| Typical                   | `9 / 50`     | green     | `41 left this month`                      | hidden            | none                   | none                     |
| Day at 80% (17 today)     | `25 / 50`    | green     | (!) `3 left today`                        | hidden            | none                   | none                     |
| Month at 80%              | `40 / 50`    | amber     | (!) `10 left · resets 1 Dec`              | hidden            | `Upgrade >` link       | `Ask the owner for Pro.` |
| Day used up               | `30 / 50`    | green     | (!) `Today's limit reached · opens 00:00 UTC` | hidden        | `Upgrade >` link       | `Ask the owner for Pro.` |
| Month used up             | `50 / 50`    | amber     | (!) `Limit reached · opens 1 Dec`         | hidden            | `Upgrade to Pro` button | `Ask the owner for Pro.` |
| Storage at 80%            | `9 / 50`     | green     | `41 left this month`                      | amber `86 / 100 MB` | `Upgrade >` link     | `Ask the owner for Pro.` |
| Storage full              | `9 / 50`     | green     | (!) `Storage full · delete receipts to make room` | amber `100 / 100 MB` | `Upgrade to Pro` button | `Ask the owner for Pro.` |
| Free capacity busy        | any          | as is     | (!) `Free scanning busy · opens 00:00 UTC` | as is            | `Upgrade >` link       | none                     |
| Service paused            | any          | as is     | (!) `Paused for everyone · opens 00:00 UTC` | as is           | none                   | none                     |

Pro workspace, owner and member alike (members see plan and usage only):

| State           | Count       | Note                                          | Storage row        | Owner action            | Member action |
| --------------- | ----------- | --------------------------------------------- | ------------------ | ----------------------- | ------------- |
| 0% / typical    | `120 / 500` | `380 left this month`                         | hidden             | none                    | none          |
| Day at 80%      | `300 / 500` | (!) `25 left today`                           | hidden             | none                    | none          |
| Month at 80%    | `410 / 500` | (!) `90 left · resets 1 Dec`                  | hidden             | none                    | none          |
| Day used up     | `320 / 500` | (!) `Today's limit reached · opens 00:00 UTC` | hidden             | none                    | none          |
| Month used up   | `500 / 500` | (!) `Limit reached · opens 1 Dec`             | hidden             | `Need more? Contact us` | none          |
| Storage at 80%  | any         | as above                                      | amber `4.1 / 5 GB` | none                    | none          |
| Storage full    | any         | (!) `Storage full · delete receipts to make room` | amber `5 / 5 GB` | `Need more? Contact us` | none          |

`Contact us` opens the support form on the "Plans & limits" topic, like the Custom card. Never in the account menu.

### Phone (390)

- **Account sheet:** the same card, full width, unchanged from 1440.
- **Settings row "Plan and billing":** `Free · 9 / 50 scans`, with ` · 86 / 100 MB` added from 80% storage. Row stays
  44 px tall; the value truncates before it wraps.
- **Home and Add receipts, from 80% only:** one strip above the drop zone with the card's note and action:
  `(!) 10 scans left this month · resets 1 Dec   Upgrade`. The strip is the 44 px tap target for the action; the
  note wraps to two lines at 390 rather than truncating. At 100%, the existing limit card replaces it. Nothing under
  80%.

### Billing page

Always both rows, for every plan and role: the scan meter with the full sentence (`usageNote`), then a storage meter
with `86 MB of 100 MB used. Delete receipts to make room.` (the second sentence from 80%). Under them,
`50 a month · 20 a day · 2 members · 100 MB storage`. Section description for both plans:
`Shared by everyone in this workspace.`

## Spec: plan lists (pricing page, landing, Billing, upgrade modal)

One fixed row order on every card, so Free and Pro line up and Pro never looks like less: scans, members, storage,
workspaces, then what's in the product. Every number comes from the saved plan table, as today.

| Row        | Free                                              | Pro                                                  |
| ---------- | ------------------------------------------------- | ---------------------------------------------------- |
| Scans      | `50 scans a month per workspace, up to 20 a day` | `500 scans a month per workspace, up to 200 a day`   |
| Members    | `Up to 2 members`                                 | `Up to 5 members`                                    |
| Storage    | `100 MB of receipt storage` (decision 6)          | `5 GB of receipt storage` (decision 6)               |
| Workspaces | `1 workspace to own`                              | `Own up to 2 workspaces, each upgraded separately`   |
| Capacity   | (none)                                            | `Never paused on busy days`                          |
| Product    | `Merchant, date, items, tax and totals, with confidence scores and review flags` | `Everything in Free`              |
| Product    | `Searchable history, CSV export and JSON copy`    |                                                      |

Keep the per-day number: it is a real limit people hit, and leaving it off would make the first block feel like a
broken promise. It stays the secondary clause.

All of these are built: the pool that pauses Free (`poolPerDay`, null on Pro), workspace ownership, the member cap
with pending invitations, confidence and review flags, CSV and JSON. Don't list: an API (there isn't one), own keys
or own storage, integrations, SSO, priority support or an uptime promise, retention promises, or the per-minute and
batch limits (abuse guards, the same on both plans).

**Upgrade modal comparison (`comparisonRows`):** `Scans a month` 50 / 500, `Scans a day` 20 / 200, `Members` 2 / 5,
`Storage` 100 MB / 5 GB (with decision 6), `Workspaces you can own` 1 / 2, `Busy-day pauses` Can pause / Never.
Drop the "per person / shared" qualifiers; the modal's header says `Per workspace`.

**In-app Billing for a Free owner:** Free and Pro cards with the rows above, and under them one line, not a third
card: `Need more than Pro? Contact us`.

### Copy that changes with per-workspace Free

| Where                                  | Today                                                                         | New                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Pricing FAQ, plans bullet              | Free scans (…) are per person, counted across every Free workspace you use.   | Each workspace has its own scans, shared by everyone in it, on Free and on Pro.          |
| Pricing FAQ, Pro bullet                | …and scanning there never uses anyone's Free scans.                           | (delete: no longer a distinction)                                                         |
| Billing usage description, Free        | Free scans are counted per person, across every Free workspace you use.       | Shared by everyone in this workspace.                                                     |
| Limit card scope line                  | Free scans are counted per person, across every Free workspace you use.       | Scans are counted for this workspace.                                                     |
| Plan card scan line (`scansLine` user) | 20 scans a day and 30 a month for each member                                 | 50 scans a month per workspace, up to 20 a day                                            |
| Welcome email                          | Your Free plan includes 20 scans a day, up to 30 a month.                     | Your Free plan includes 50 scans a month per workspace, up to 20 a day.                   |
| Upload panel, month tighter            | You have 3 receipts left today, so only the first 3 will be scanned.          | You have 3 scans left this month, so only the first 3 will be scanned.                   |

## Spec: the Custom card

What exists, checked in code: `user_credentials` is a table and a type in `packages/db` with no reader or writer
(per-user, from the Clerk-era plan); `receipts.storage_source` defaults to `managed` and nothing sets anything else.
No `ai_keys`, no `workspace_overrides`, no encryption service. The BYOK plan is "proposed, nothing built" and sizes
own keys at about 15 days and own storage at about 7 more. So one customer can't get higher limits either: Admin →
Settings raises a whole plan, and the only per-workspace lever is comping Pro.

**Can promise today:** that we read the request and answer plainly, Pro by hand (a comp), and "everything in Pro".
**Can't promise yet:** "expandable as needed" (no per-workspace limits), own AI keys, own storage, SSO, an SLA,
invoicing outside Paddle.

| Field       | Today                                                                       | Recommended                                                                         |
| ----------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Price       | Let's talk                                                                  | Let's talk                                                                          |
| Description | Need more than Pro? Tell us what you need and we'll say what we can do.     | For teams that need more than Pro. Tell us what you need and we'll say plainly what we can do. |
| Features    | Everything in Pro · More scans, members or workspaces, if we can arrange it | Everything in Pro · Higher limits on request, where we can arrange them             |
| Button      | Contact us                                                                  | Contact us                                                                          |

When each piece ships, add a line, no sooner: `Higher limits for your workspace` once per-workspace overrides exist;
`Use your own AI provider keys` once own keys ship; `Keep files in your own S3-compatible bucket, such as Cloudflare
R2` once own storage ships. No "coming soon" or dated line in the meantime.

## Spec: the Usage page in Settings

The owner accepted decisions 1 to 9 above. This section adds a detailed usage view.

### Owner decisions

| #   | Decision                              | Recommendation                                                                                                                                                                    | Alternative                                                             |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| U1  | Where it lives                        | **Its own page, `/app/settings/usage`, titled "Usage"**, open to every member. Plan and billing keeps its compact meter and links to it                                       | A Usage block at the top of Plan and billing: one page, but members then open a billing page to see usage |
| U2  | Per-member breakdown (STATUS 3)       | **Owners and workspace admins see every member's counts; a member sees the workspace total and their own count only**                                                           | Everyone sees everyone: simpler, but it shows colleagues' activity to each other |
| U3  | Which months                          | **This month, with last month's total as one line.** No month picker                                                                                                            | A picker back to the ledger's retention (13 months suggested in STATUS 9) |
| U4  | Failed scans                          | **Shown as a breakdown that adds up to "used"**: read, in progress, failed (free and counted)                                                                                  | Hide failures: then the total doesn't add up when a sixth one counts   |

**Why U1:** usage is for everyone in the workspace; billing is the owner's. On its own page, a member never lands on a
page that is mostly "Managed by the workspace owner". **Why U2:** the allowance is shared, so the total matters to
everyone, and the owner needs per-person numbers to manage it. But a colleague's daily scan count is a record of their
work pattern, and nothing a member does needs it. Admins manage members already, so they get the owner's view.

### Settings rows

| Row              | Value                                    | Link               |
| ---------------- | ---------------------------------------- | ------------------ |
| Usage            | `9 / 50 scans this month`                | `View`, the page   |
| Plan and billing | `Free` (badge); owner `Manage`, others `View` | the billing page |

The scan count moves from the Plan and billing row to the Usage row. Both rows at both widths, 44 px tall.

### What the page shows, top to bottom

1. **This month:** the usage card's scan meter, full width, with the full sentence: `9 of 50 scans used. 41 left. Resets
   1 December, 00:00 UTC.`
2. **Today:** `2 of 20 scans today. Resets 00:00 UTC.` A line, not a second meter, until today reaches 80%; then a
   4 px meter appears, amber.
3. **Storage** (only once bytes are counted; until then the row isn't there, never `0 MB`): a 4 px meter and
   `86 MB of 100 MB used`, plus `Delete receipts to make room.` from 80%.
4. **Scans per day, this month:** the chart below.
5. **How "used" adds up** (U4), a four-row list in mono tabular numbers:
   `Read 38` · `In progress 1` · `Failed 7: first 5 free, 2 counted` · `Used 41`.
   Under it: `A receipt counts once however often it is retried. Each day and each month, the first 5 failed scans
   don't count.`
6. **By member** (shared workspaces only, U2). Owner and admins: one row per member, name, then `read · failed`, sorted
   by used, highest first, with `You` marked; members who left or deleted their account fold into one row,
   `Former members`. Member: one row, `You: 12 of the workspace's 41`.
7. **Receipts:** `214 receipts kept in this workspace · 6 need review`, with a link to the filtered list. A count of
   receipts, not scans: deleting receipts lowers it, never "used".
8. **Last month:** `October: 47 of 50 scans used.` One line.

Members and owners see the same page except item 6, and no upgrade or contact action appears here unless the card's
own rules show one (from 80%, the same link as the card).

### The chart

- **Form:** vertical bars, one series (scans read per UTC day), the month's days on the x axis. One series, so no
  legend; the section title names it. One y axis, starting at 0, scaled to the month's highest day (at least 4) with a
  single recessive gridline at that value, labelled. No day-limit line: at 20 a day it would flatten typical days of 1
  to 5 into the baseline.
- **Marks:** `bg-primary` bars, 4 px rounded top, anchored to the baseline, 2 px gap. Days still to come draw as a
  1 px baseline tick, so the month's length is visible. Today has `Today` under its bar instead of a number.
- **Limit days:** a day that reached the day limit gets a small warning icon above its bar (`text-warning`, with the
  tooltip text), never colour alone.
- **Labels:** x ticks on 1, 8, 15, 22 and 29 only; no value on every bar.
- **Interaction:** hovering or focusing a day shows `12 Nov · 4 scans read` (and `Daily limit reached` when it applies).
  Each day's hit area is the full column height. On touch, dragging across the chart moves the readout, which sits
  above the chart, so bars 9 px wide still work. The chart is one focusable element; arrow keys move between days.
- **Table:** a `Show as table` disclosure under the chart lists every day with scans (date, read, failed). This is
  also what a screen reader gets: the chart has `role="img"` and a label with the month's total.
- **Themes:** token colours only. Primary is the same token in both themes, so no new colours to validate.

### Phone (390)

One column, 16 px gutters. The chart is the full width (358 px, about 9 px per bar with 31 days), 120 px tall, with the
readout line above it. The member list stays rows, not a table; name truncates, numbers never wrap. No horizontal
scroll.

### Empty and edge states

| State                       | Shows                                                                         |
| --------------------------- | ----------------------------------------------------------------------------- |
| No scans this month         | Meters at 0. Chart replaced by `No scans yet this month.` Breakdown hidden    |
| First day of the month      | Same as above. Last month's line still shows                                   |
| Workspace with one member   | No "By member" section                                                        |
| Storage not counted yet     | No storage row                                                                |
| Plan changed this month     | Counts follow the plan now in effect, as the meter does, so the two agree; the line `Includes scans since this workspace moved to Pro on 9 Nov.` |
| Ledger read fails           | The section's error boundary: `Usage couldn't load. Try again.` with a retry |

### What not to show

No model or provider names, no cost or estimated cost (STATUS 3 recommends admins only), no retry attempts or
job states, no Free capacity or service-wide cap numbers, no other workspace's usage, no IPs or devices.

### Data: what exists and what's new

- **Exists:** `ocr_rounds` (one row per upload or retry, with `organization_id`, `user_id`, `plan` and `created_at`)
  and `ocr_calls` (status per model call). `countUsage` in `packages/core/src/usage.ts` gives today's and the month's
  "used" with the failed-rounds rule. `getUsageSummary` (`apps/web/lib/quota.ts`) feeds the meter, and
  `ReceiptRepo.counts` gives the receipt counts.
- **New query, one, in `packages/core`:** the month's rounds of the workspace and plan, grouped by UTC day and by
  `user_id`, returning read, in progress and failed (the same `readOk`, `liveJobForRound` and `failedPaid` predicates,
  shared, not copied). Pro has at most a few hundred rows a month; Free about 50.
- **Indexes:** none new. `ocr_rounds_org_created_at_idx` covers the window, and the per-round `ocr_calls` lookup
  already uses the unique (receipt, round) index the quota uses. Check with `EXPLAIN` on a seeded Pro month in the
  build PR.
- **The sums don't add up per day.** The 5 free failures apply per day and per month, so daily "used" doesn't sum to
  the month's. That is why the chart shows scans read, not "used", and the breakdown carries the month's rule.
- **Per member:** grouped by `user_id`; rows set null by account deletion form `Former members`. A member's view
  filters to their own `user_id` on the server, not in the browser.
- **Storage:** needs the byte total from the storage cap migration; nothing to query until then.
- **Last month:** `countUsage` with last month's window, or the same grouped query.

## Build notes

- `usageWarns` and `upgradeLevel` read both windows and storage; `upgradeLevel` stays month-and-block driven for the
  button (decision 4), so a day at 80% warns without an offer.
- `meterNote` gains the day-at-80% branch and stops showing the day when it is merely tighter.
- PR #262's trap holds: the upload panel hides the upgrade offer when the scope is `workspace`, which is now Free too.
- Screenshots for the PR: every state in both tables at 1440 and 390, dark and light, plus the pricing page and the
  Usage page (empty, typical, owner and member views).
