# Product review: billing, plans, limits and upgrade — 2026-11-13

## Product review — Changes requested

_Scope: `main` at `725ae6c` on the shared review server, walked with Playwright at 1440 and 390 px as five seeded
test accounts plus one account signed up during the walk (`walk-…@example.test`, one fixture scan). Read-only; nothing
was fixed. Skills applied: design-critique, ux-copy, accessibility-review._

**What was not seen.** The review server has no `PADDLE_*` settings, so `getCheckoutFor()` returns `null` for everyone.
That is the same branch the live site takes today for anyone who is not a platform admin (sandbox keys on production).
So every screen below is what a real user sees now. The upgrade modal, the checkout button, the Paddle portal buttons
(invoices, payment method, cancel), the at-limit banner and the Home upgrade card never rendered and are **unreviewed**;
they need a second pass on a server with sandbox keys. `/app?upgrade=1` did nothing for any account, as designed.

Screenshots are in the session scratch directory, written below as `S/` =
`/tmp/claude-1000/-workspaces-receipt-ocr-app/27a05ff3-085a-4f7d-8cb9-bcc0ee2f1d39/scratchpad/review-shots/`.
Each `walk/*.png` has a `.txt` beside it with the page text.

## Verdict

The numbers are right and agree almost everywhere: 20 a day and 100 a month on Free, 500 and 200 on Pro, the same on
the landing page, pricing, sign-up, the meter, Settings and Billing. Sign-up to first scanned receipt is short and
works on a phone. What fails is the state the product is in today, with checkout closed: a subscriber is told "Active"
and "Paid plans aren't open yet" in one card with no way to manage anything, an at-limit user is told to upgrade with
nothing to press, and a member gets no explanation of what they cannot do. On a phone, a user at 85 of 100 gets no
warning unless they open the account sheet.

## Findings, ranked

### Owner-blocking

**1. A Pro subscriber sees "Active" and "Paid plans aren't open yet" together, with no manage, cancel or invoices.**
- Account and route: `pro@example.test`, `/app/settings/billing`, both widths.
- Screenshot: `S/walk/pro-app-settings-billing@1440.png`, `S/walk/pro-app-settings-billing@390.png`.
- Seen: "Pro, monthly · Active · Renews on 1 Dec 2026." then "Paid plans aren't open yet. See pricing for what Pro
  will include." No button of any kind. Settings calls the row "Manage", and it leads here.
- Cause: `apps/web/app/app/settings/billing/page.tsx:112` tests `!checkout` before everything else, so the closed-
  checkout sentence replaces the portal buttons, the member notice and the "managed by" notice for people who already
  pay.
- Why it blocks: `/refunds` and the pricing FAQ both say "Cancel from Settings, Billing". For a subscriber whose
  viewer has no checkout, that is not true. A person who cannot find Cancel disputes the charge.
- Change: decide the actions from the subscription first. With a subscription, always show the portal buttons (they
  need the API key, not the checkout). Show "Paid plans aren't open yet" only when there is no subscription. If the
  portal cannot open either, say "To cancel or get an invoice, reply to your Paddle receipt or contact us" with the
  support button.

**2. The at-limit user is told to upgrade, and there is nothing to upgrade with.**
- Account and route: `limit@example.test`, `/app`, `/app/upload`, `/app/settings/billing`, both widths.
- Screenshot: `S/walk/limit-app-upload@390.png`, `S/walk/limit-app@1440.png`,
  `S/walk/limit-app-settings-billing@1440.png`.
- Seen: the limit card ends "Upgrade a workspace to Pro for more scans." with no link. The only action is "Review the
  receipts you already have". Billing then says "Paid plans aren't open yet". Two screens disagree, and the user's only
  real option (wait until 1 December) is buried mid-paragraph.
- Cause: `apps/web/components/upload-panel.tsx:147` adds the upgrade sentence exactly when there is no offer
  (`offered ? "" : …`), which is the closed-checkout case.
- Change: when there is no offer, drop the sentence. While checkout is closed say "Pro, with 500 scans a month, opens
  soon" and link to `/pricing`; do not use the verb "upgrade" anywhere a button cannot follow it. Lead the body with
  the date.

**3. "in 426 hours" as the wait.**
- Account and route: `limit@example.test`, `/app` and `/app/upload`.
- Screenshot: `S/walk/limit-app-upload@390.png`.
- Seen: "Uploads open again on the 1st at 00:00 UTC, in 426 hours." Nobody can read 426 hours; it is 17 days. The same
  card says "on the 1st" while the meter says "1 December".
- Cause: `apps/web/lib/format.ts:152-157` stops at hours.
- Change: over 48 hours, say days ("in 17 days"). Name the date the same way as the meter: "on 1 December". Show the
  reader's local time with UTC as the secondary form, since "00:00 UTC" is 05:45 in Kathmandu.

**4. A member gets no explanation of what they cannot do.**
- Account and route: `member@example.test`, switched into Pro Owner's Workspace: `/app/settings`,
  `/app/settings/billing`, `/app/settings/members`.
- Screenshot: `S/walk/memberpro-app-settings-billing@1440.png`, `S/walk/memberpro-app-settings-members@1440.png`,
  `S/walk/memberpro-app-settings@1440.png`.
- Seen: Settings shows "This workspace is on Pro. [Manage]" to someone who cannot manage. Billing shows the owner's
  renewal date and then "Paid plans aren't open yet", never the written member notice ("Only its owner can see
  invoices or change the plan", `page.tsx:122-128`, hidden by the same branch as finding 1). Members says "Invite
  teammates and choose what they can do" above a list with no invite form and no reason why.
- Change: for a non-owner, label the Settings row "View" and say "Billing is managed by the owner, {name}." on the
  Billing page whatever the checkout state. On Members, change the description for members to "Only owners and admins
  can invite or remove people."

**5. On a phone, the user at 85 of 100 never sees the limit coming.**
- Account and route: `busy@example.test`, `/app`, `/app/upload`, `/app/settings` at 390.
- Screenshot: `S/walk/busy-app@390.png`, `S/walk/busy-app-upload@390.png`, `S/walk/busy-app-settings@390.png`,
  `S/walk/busy-account-sheet@390.png`.
- Seen: at 1440 the sidebar meter turns amber ("15 left today, 15 this month"). At 390 there is no usage on Home, on
  Scan or in the Settings list (the row reads "Plan · Free plan"). The amber meter exists only inside the account sheet
  behind the avatar. The Home upgrade card that would carry this is hidden while checkout is closed. With 15 left and
  "up to 10 at a time", two batches end the month with no warning.
- Change: from 80% used, show one line under the upload area on Home and Scan at every width: "15 scans left this
  month. Resets 1 December." Put the count in the Settings row ("Free plan · 85 of 100"). This is information, not a
  promotion, so it should not depend on the offer.

**6. The usage meter is stale after a scan.**
- Account and route: the walk account, `/app` to the receipt page at 390.
- Screenshot: `S/walk/journey-08-sheet-after-scan@390.png` (0 / 100 after a finished scan),
  `S/walk/journey-09-home-after-first-scan@1440.png` (1 / 100 after a reload).
- Seen: the first receipt scanned and opened; the account sheet still said "0 / 100 this month, 20 left today". A full
  page load showed "1 / 100, 19 left today". Observed once; the likely cause is that the meter is rendered in the app
  layout, which does not re-render on client navigation. A user near the limit reads a number that is wrong until they
  reload, which breaks the standard "Usage and limit numbers shown to users are real".
- Change: refresh the layout (`router.refresh()`) when an upload batch finishes, or have the meter read the same count
  the upload panel uses.

### Polish

**7. Pro is sold as available on the landing page while checkout is closed.**
- Route: `/` (pricing section), `/pricing` header. Screenshot: `S/public/home@1440-dark.png`,
  `S/walk/journey-02-pricing-full@390.png`.
- Seen: `/pricing` says "Pro checkout opens soon" in the card, which is right. The landing page's Pro card has no such
  line (its button is "See pricing"), and both pages lead with "Pro is $9 a month or $90 a year … Cancel any time."
- Change: add "Opens soon" as the Pro card's badge on both pages while `checkoutOpen` is false, so the label travels
  with the price.

**8. "Upgrade a workspace to Pro to create another" in the workspace switcher, with no way to do it.**
- Accounts: every Free account. Screenshot: `S/walk/busy-account-sheet@390.png`, `S/walk/member-switcher@1440.png`.
- Cause: `apps/web/lib/plan-copy.ts:101`. The 4 November review flagged the same dead-end upgrade wording.
- Change: while checkout is closed, "Free accounts own 1 workspace." and stop there.

**9. A signed-in Pro owner on `/pricing` is offered "Start free" and told "Pro checkout opens soon".**
- Account and route: `pro@example.test`, `/pricing`. Screenshot: `S/pro/pricing@1440-dark.png`.
- Change: for a signed-in visitor, mark the card of the active workspace's plan "Your plan" and point the button at
  `/app/settings/billing`.

**10. Settings sends Free users to "See plans", which opens a page with no plans.**
- Accounts: `new`, `busy`, `limit`. Route: `/app/settings` to `/app/settings/billing`.
  Screenshot: `S/walk/new-app-settings@1440.png`, `S/walk/new-app-settings-billing@1440.png`.
- Seen: "Upgrade this workspace to Pro for more scans" then "No subscription. Paid plans aren't open yet." Three clicks
  (Settings, See plans, pricing) to reach a price.
- Change: while checkout is closed, label the row "Plan and billing" with "Pro opens soon", and put Pro's price and
  allowance on the Billing page itself.

**11. The security prompt sits above the limit message.**
- Accounts: `busy`, `limit`, `pro`, every page until dismissed. Screenshot: `S/walk/limit-app-upload@390.png`,
  `S/walk/pro-app-settings-billing@390.png`.
- Seen: at 390 the passkey card takes the first 200 px of every page, Billing included, and pushes "You've used this
  month's free scans" down. The one thing the at-limit user needs to read is second.
- Change: do not show the passkey prompt on a page that is showing a limit state, and keep it to Home.

**12. The sidebar meter's header wraps.**
- Accounts: all, 1440. Screenshot: `S/walk/busy-app@1440.png`, `S/walk/pro-app-settings-billing@1440.png`.
- Seen: "Free / plan" and "85 / 100 this / month" each break over two lines in the 220 px sidebar.
- Change: stack the label above the count, or shorten to "85 / 100 scans".

**13. The member signs in to their own empty Free workspace.**
- Account: `member@example.test`, `/app`. Screenshot: `S/walk/member-app@1440.png`.
- Seen: "Scan your first receipt" and "Free plan 0 / 100", though the reason they have an account is the Pro workspace.
  The seeded session may differ from a real invite acceptance; worth checking that accepting an invite and the next
  sign-in both open the shared workspace.

**14. Wording that differs for the same thing.**
- The failed-scan allowance: "Your first 5 failed scans don't count" (`/app/settings`) and "A few failed reads don't
  count" (`/pricing` FAQ). Use the number in both.
- "read" in the pricing FAQ ("Each receipt read successfully") and "scan" everywhere else. Use "scan".
- The reset: "on the 1st at 00:00 UTC" (limit card), "1 December, 00:00 UTC" (meter), "on the 1st of each month"
  (Settings). Use the meter's form where a specific month is meant.
- "Plan and usage" on `/app/settings` shows the meter and three limits; Billing repeats the meter under the same
  heading without them. Keep the detail in one place.

### Ideas

- At 100 of 100, offer "Email me when Pro opens" (the `soon` branch of the upgrade plan, decision 2, not built). Today
  the most motivated buyer the product has leaves with nothing.
- Show the renewal amount with the date: "Renews on 1 Dec 2026 for $9 plus tax."
- On the first receipt page, a single line "1 of 100 free scans used this month" teaches the limit at the moment it
  starts to matter.
- In a Pro workspace, show members who used what this month, so an owner sharing 500 scans can see where they went.

## Journeys

| Journey | Account | Result |
|---|---|---|
| Landing to pricing to sign-up, 390 | signed out | Works. Three fields, one button, lands on "Scan your first receipt". Numbers match on all three pages. `S/walk/journey-01-landing@390.png` to `journey-04-after-sign-up@390.png` |
| First scan, 390 | walk account | Works: choose file, adjust corners, preview, Upload, receipt page. Meter stale afterwards (finding 6). `S/walk/journey-05-file-chosen@390.png` to `journey-07-settled@390.png` |
| Noticing the limit | `busy` | 1440: amber sidebar meter, clear. 390: nothing unless the account sheet is opened (finding 5) |
| Uploading at the limit | `limit` | Blocked with a clear title, on Home and Scan. The body misleads (findings 2, 3). Receipts, export and Settings stay usable |
| Plan, usage, renewal | `pro` | Plan, usage and renewal date shown and consistent. Cancel, manage, invoices: absent (finding 1). Members: 2 of 10, invite form present |
| Member's view | `member` | Uses the shared 500 correctly, sees the owner's meter. No explanation of limits on their role (finding 4) |
| No horizontal scroll at 390 | all | Passed on every page walked (`OVERFLOW 0` in each `.txt`) |

## Checks against the standards

| Standard | Result |
|---|---|
| No claim the product can't back up today | **Fails**: "Cancel from Settings, Billing" (finding 1); Pro presented as available on the landing page (finding 7) |
| Usage and limit numbers are real | **Fails** after a scan until reload (finding 6); otherwise real and consistent |
| Plain, literal copy for an international reader | **Fails** on "in 426 hours" and UTC-only times (finding 3) |
| 390 px, no horizontal scroll, every section reachable | Passes |
| Currency symbols, monospace numerics | Passes on the pages walked |

Accessibility notes: the meter has `role="meter"` with a text value and the warning state uses an icon and words, not
colour alone; amber warning text passes on light and dark by eye (`S/limit/app-settings-billing@390-light.png`), not
measured. The limit card's only action is a text link; it meets 44 px on phones. Keyboard and screen-reader passes were
not run in this round.

## Proposed standards

Add to `docs/product-standards.md`, dated 2026-11-13:

1. A screen never asks for an action it cannot offer. "Upgrade" appears only where a control that starts the upgrade
   is on the same screen; while checkout is closed, the copy says Pro opens soon.
2. One card never states two plan states. A subscriber's billing page is decided by the subscription first, the
   checkout state second.
3. Anyone who pays can always reach cancel, payment method and invoices from Settings › Billing, or is told on that
   page exactly how.
4. When a role cannot do something, the page says who can, by name or role. No button for an action the viewer cannot
   take.
5. A limit warning shows at every width from 80% used, on the pages where scanning starts.
6. Waits over 48 hours are given in days with the date; times show the reader's local time.

## Follow-up needed

Run this walk again on a server with Paddle sandbox keys, as an owner, a platform admin and a member: the upgrade
modal on phone and desktop, the checkout, the three portal buttons, the at-limit banner, the Home card and its
dismissal, and the past-due, canceling and ended subscription states. None of them could be reached here.
