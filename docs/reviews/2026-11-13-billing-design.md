# Design critique: billing, plans, upgrade and sales surfaces (2026-11-13)

Read-only review of `main` at `725ae6c` on the review server, from the round's screenshots (six accounts, 1440 and
390, dark and light) plus eleven extra captures of what they missed: a member inside the Pro workspace, the phone
account sheet and the desktop account menu. Seeded test data only.

**Two limits on what was seen.** Checkout is closed on the review server, so the upgrade modal, banner, Home upgrade
card, meter button and menu item never rendered; they are judged from the code (`components/upgrade/*`,
`lib/upgrade-copy.ts`) and marked "(code)". The `member` screenshots show that user's own Free workspace, not the Pro
one; the extra captures cover the Pro one.

## Summary

The numbers are honest and the same everywhere, the meter has a proper `role="meter"` and never relies on colour
alone, and pricing explains per-workspace plans clearly. Three things let it down. **The at-limit state is a dead
end:** with checkout closed it tells people to "Upgrade a workspace to Pro" and gives them no way to, and it counts
the wait as "426 hours". **Billing is spread over four places with four names** (a "Plan" row, "Plan and usage" on
Settings, "Plan and usage" again on Billing, "Subscription"), and the same meter shows three times on one desktop
screen. **Once checkout opens, a Free owner at 20% usage gets three upgrade entry points at once** (code), while a
phone user gets no usage number at all outside the account sheet.

## Findings

Severity: High blocks or misleads, Medium costs effort or trust, Low is polish.

### Placement

| #   | Finding                                                                                                                                                                                                                                                                                                      | Sev. | Recommendation                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | **At-limit card has no next step.** Home and Add receipts (`limit`, all four shots) end on "Upgrade a workspace to Pro for more scans." with no link, and Billing then says "Paid plans aren't open yet". The only action is a text link to Receipts. Breaks the "never claim what we can't back up" standard | High | While checkout is closed, say Pro isn't open and link to pricing. When open, a primary button. Copy below.               |
| 2   | **Phone has no usage outside the avatar sheet.** `busy` at 85/100 sees nothing on Home, Add receipts or Settings ("Plan: Free plan"). The first they hear of the limit is the block                                                                                                                          | High | Show the count in the Settings "Plan" row always, and one line under the upload buttons from 80%                         |
| 3   | **Settings repeats Billing.** Desktop Settings shows the meter, three stat cards (20, 100, 1: plan constants styled as KPIs) and a Billing card; Billing shows the meter again; the sidebar shows it a third time                                                                                            | Med  | Settings keeps one row, as the phone already does. Meter and limits live on the Billing page only                        |
| 4   | **"See plans" goes to a page with no plans.** The Settings Billing card promises plans; the Billing page for a Free owner is a meter and "No subscription"                                                                                                                                                   | Med  | Put a Free and a Pro card on the Billing page (wireframe); label the row "Plan and billing"                              |
| 5   | **Too many upgrade doors at once (code).** A Free owner from 20% used gets the meter button, the menu item 40 px below it, and the Home card. At the limit the banner and the limit panel join in                                                                                                            | Med  | One door per level (ladder below). Remove the menu item; drop the 20% Home card                                          |
| 6   | **The primary colour points at what you can't do.** At the limit the green "Add receipts" button and raised Scan tab are the loudest things on screen and lead to the blocked page; the passkey banner above the limit card has the only filled button                                                       | Med  | Keep both reachable (the page explains), but hide the passkey banner while uploads are blocked: one message at a time    |
| 7   | **Signed-in pricing ignores who you are.** The Pro owner sees "Start free" and "Pro checkout opens soon." on `/pricing`, with nothing marking their plan                                                                                                                                                     | Med  | Signed in: badge "Your plan" on the current card; Free button "Open the app"; Pro owner's button "Manage billing"        |
| 8   | **Sales pages feature the plan nobody can buy.** On pricing the featured Pro card holds a grey box that reads as a disabled button; on the landing page Pro has the only filled button ("See pricing") while Free, the only real path, is outlined                                                           | Med  | Until checkout opens: Free is the featured card with the filled button; Pro gets an "Opens soon" badge and a quiet link  |
| 9   | **A member of the Pro workspace sees the subscription.** Billing shows them "Pro, monthly, Active, Renews on 1 Dec 2026". They can't act on any of it                                                                                                                                                        | Low  | Members see plan and usage plus "Managed by the workspace owner". No renewal date, no status                             |

### Hierarchy, density and consistency

| #   | Element                 | Issue                                                                                                                                                                                                             | Recommendation                                                                                         |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 10  | Sidebar meter, header   | From two-digit usage the header wraps to two ragged lines at 1440: "Free / plan" and "85 / 100 this / month" (`busy`, `limit`, `pro`). The number never says what it counts                                         | Plan as a badge, then `85 / 100 scans`. "This month" moves to the note                                 |
| 11  | Sidebar meter, note     | Three lines of 12 px text in every state, including a Pro workspace at 24%: "200 left today, 380 this month. The month resets on 1 December, 00:00 UTC." At 85/100 it says "15 left today, 15 this month"          | One line. Day count only when it is the tighter one. Reset date only from 80%. UTC time on Billing     |
| 12  | Meter, colour           | Near (85%) and at-limit (100%) look the same: amber bar, amber icon, a full paragraph in amber. The dataviz rule is status colour on the mark and icon, text in text tokens                                         | Bar and icon carry amber; note in `text-foreground`. At limit the note leads with "Limit reached"      |
| 13  | Plan badges             | Plan is muted text in the meter, bold text in Subscription, a filled badge in the modal (code), and absent from the workspace switcher, where `member` has one Free and one Pro workspace that look identical       | One `Badge`: `secondary` for Free, `default` for Pro, in the meter, switcher rows and Billing          |
| 14  | Billing page            | The left column carries the selling: two grey five-line paragraphs repeating 500, 200, 10, UTC and Paddle. The cards hold almost nothing. "Pricing" is linked twice, 30 px apart                                    | Numbers go in the plan cards. Left column is one sentence per section                                  |
| 15  | Subscription card       | A Pro owner reads "Renews on 1 Dec 2026." then "Paid plans aren't open yet." The `!checkout` branch runs before the subscription state                                                                              | An active subscription never shows the "not open" line; show "Billing is unavailable right now."       |
| 16  | Pricing cards           | Free lists six lines and Pro five, so Pro looks like less. "Cancel any time" is a term, not a feature                                                                                                               | Free: four lines (merge the three extraction lines into one). Move "Cancel any time" under the price   |
| 17  | Sales CTAs              | Four labels for one action: "Get started free" (hero, header), "Start free" (cards, phone header), "Create a free account" (footer). Three for no card: "No card required", "No card needed", "No credit card"       | "Start free" and "No card needed" everywhere                                                           |
| 18  | Landing pricing title   | "Start free, scale when you need" stops mid-phrase and differs from the pricing page's "Start free. Upgrade a workspace when it needs more."                                                                        | Use the pricing page's headline in both places                                                         |

Themes: no billing surface breaks in either theme. Light is the stronger of the two for the meter (the amber note is
a readable dark orange on white); dark's amber paragraph is the loudest thing in the sidebar at 85%. No horizontal
overflow at 390 on the billing screens measured (Home at the limit, Billing). The limit card's link is 44 px tall; the
"Pricing · Refund policy" links on Billing are 16 px tall at 390, so give them `max-md:min-h-11`.

## What works

- Usage numbers, reset times and limits come from one source and agree across meter, Settings, Billing and pricing.
- The limit card names the scope ("per person, across every workspace you use"), which most products get wrong.
- Members never see a buy button (code), and the pricing FAQ answers the real questions in plain words.
- Sign-up states the Free allowance before the form. Keep it.

## Proposal

### Where billing lives

- **One page:** `/app/settings/billing`, titled "Plan and billing". It holds the meter, the limits, the plan cards
  and the subscription. Settings links to it with one row at both widths.
- **The sidebar meter** (1440) and the **Settings row plus account sheet** (390) answer "how many scans do I have".
- **`/pricing`** is the public sales page. In the app it is only ever a "Compare plans" link.

### What each account sees

| Surface                 | `new` 0/100         | `busy` 85/100                | `limit` 100/100                      | `pro` owner         | Member of Pro        |
| ----------------------- | ------------------- | ---------------------------- | ------------------------------------ | ------------------- | -------------------- |
| Meter note              | 20 left today       | 15 left · resets 1 Dec       | Limit reached · opens 1 Dec          | 380 left this month | 380 left this month  |
| Meter colour and action | Green, none         | Amber, "Upgrade" text link   | Amber, "Upgrade to Pro" button       | Green, none         | Green, none          |
| Home                    | Nothing             | Upgrade card, can be snoozed | Limit card replaces the drop zone    | Nothing             | Nothing              |
| Other pages             | Nothing             | Nothing                      | Banner (not Home, Upload, Billing)   | Nothing             | Nothing              |
| Billing page            | Free and Pro cards  | Same                         | Same, Pro button filled              | Subscription, portal| Plan, usage, manager |
| `/pricing` signed in    | "Your plan" on Free | Same                         | Same                                 | "Your plan" on Pro  | No marker            |

A member of a Free workspace gets the same meter and limit card without any button, plus "Only the workspace owner
can upgrade." While checkout is closed, every "Upgrade" action above becomes the line "Pro opens soon" with a
"Compare plans" link, and the Home upgrade card and banner don't render.

**Upgrade ladder (owner, checkout open):** under 80%, nothing but the Billing page. From 80%, the meter link and the
Home card. At 100%, the limit card on Home and Add receipts, the banner elsewhere, and the meter button. Never the
account menu.

### 1440: sidebar meter states

```
 under 80%                 80 to 99%                 at the limit
+-----------------------+ +-----------------------+ +-----------------------+
| [Free]  12 / 100 scans| | [Free]  85 / 100 scans| | [Free] 100 / 100 scans|
| ==-------------------- | | =================---- | | ====================== |
| 20 left today         | | (!) 15 left · resets  | | (!) Limit reached ·   |
+-----------------------+ |     1 Dec             | |     opens 1 Dec       |
 Pro, same shape:         | Upgrade >             | | [  Upgrade to Pro   ] |
 [Pro] 120 / 500 scans    +-----------------------+ +-----------------------+
 380 left this month       amber bar and icon only   member: no button, "Ask the owner for Pro."
```

### 1440: Plan and billing (Free owner; right card changes with state)

```
| sidebar | Settings > Plan and billing                                              |
|         | Plan and billing                                                         |
|         | Each workspace has its own plan. This is Busy Free User's Workspace.     |
|         | ------------------------------------------------------------------------ |
|         | Usage            +-----------------------------------------------------+ |
|         | Scans this       | [Free]                            85 / 100 scans    | |
|         | month, for you   | ==========================================--------  | |
|         | across your      | (!) 15 left this month. Resets 1 December, 00:00 UTC | |
|         | Free workspaces. | 20 a day · 3 members · 1 workspace                  | |
|         |                  +-----------------------------------------------------+ |
|         | ------------------------------------------------------------------------ |
|         | Plans            +-- Free [Your plan] ------+ +-- Pro ---------------+ |
|         |                  | $0                       | | $9 a month           | |
|         |                  | 100 scans a month, each  | | 500 scans a month,   | |
|         |                  | 20 a day                 | | shared, 200 a day    | |
|         |                  | 3 members                | | 10 members           | |
|         |                  |                          | | [ Upgrade to Pro ]   | |
|         |                  +--------------------------+ +----------------------+ |
|         |                  Compare plans · Refund policy                          |
```

Checkout closed: the Pro button becomes the badge "Opens soon" and no button. Pro owner: the Plans section becomes
"Subscription": `[Pro] monthly · Active`, "Renews on 1 Dec 2026", then "Update payment" and "Cancel". Member: Usage
only, then "Managed by the workspace owner."

### 390: Home at the limit, and Settings

```
+--------------------------------+   +--------------------------------+
| [R] At Limit User's Wor...  (A)|   | Settings                       |
| Home                           |   | +----------------------------+ |
| +----------------------------+ |   | | Plan and billing           | |
| |            (clock)         | |   | | Free · 100 / 100 scans  (!)>| |
| | You've used this month's   | |   | | Workspace     At Limit... > | |
| | 100 free scans             | |   | | Groups                    > | |
| | Uploads open again on      | |   | | Appearance          Light > | |
| | 1 December, in 18 days.    | |   | | Security           Set up > | |
| | Your receipts are still    | |   | +----------------------------+ |
| | here to check and export.  | |   +--------------------------------+
| | [     Upgrade to Pro     ] | |
| | [     Review receipts    ] | |    Home from 80%, under the upload buttons:
| +----------------------------+ |    +----------------------------+
| To check            12 in total|    | [      Take photos       ] |
| ...                            |    | [      Choose files      ] |
|Home  Receipts (Scan)  Settings |    | (!) 15 scans left this month|
+--------------------------------+    +----------------------------+
```

Checkout closed: "Upgrade to Pro" is replaced by the line "Pro, with 500 scans a month, opens soon. Compare plans",
and "Review receipts" becomes the filled button. Both buttons are full width and 44 px tall.

## Copy

| Where                                    | Now                                                                                                           | Proposed                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Meter header                             | Free plan · 85 / 100 this month                                                                               | `[Free]` 85 / 100 scans                                                                          |
| Meter note, under 80%                    | 20 left today, 100 this month. The month resets on 1 December, 00:00 UTC.                                     | 20 left today (day is tighter) or 62 left this month                                             |
| Meter note, from 80%                     | 15 left today, 15 this month. The month resets on 1 December, 00:00 UTC.                                      | 15 left · resets 1 Dec                                                                           |
| Meter note, month used                   | Monthly limit reached. Resets on 1 December, 00:00 UTC.                                                       | Limit reached · opens 1 Dec                                                                      |
| Meter note, day used                     | Daily limit reached. Resets at 00:00 UTC. 40 left this month.                                                 | Today's limit reached · opens tomorrow                                                           |
| Member line beside the meter             | Ask the workspace owner to upgrade this workspace to Pro.                                                     | Ask the owner for Pro.                                                                           |
| Limit card, title                        | You've used this month's free scans                                                                           | You've used this month's 100 free scans                                                          |
| Limit card, body                         | The Free plan includes 100 scans a month per person, across every workspace you use, and you've used all of them. Uploads open again on the 1st at 00:00 UTC, in 426 hours. | Uploads open again on 1 December, in 18 days. Your receipts are still here to check and export. |
| Limit card, scope (small, under body)    | (inside the body)                                                                                             | Free scans are counted per person, across every Free workspace you use.                          |
| Limit card, checkout closed              | Upgrade a workspace to Pro for more scans.                                                                    | Pro, with 500 scans a month, opens soon. Compare plans                                           |
| Limit card, owner, checkout open         | Or upgrade this workspace to Pro for 500 scans a month, up to 200 a day.                                      | Pro gives this workspace 500 scans a month for $9. Button: Upgrade to Pro                        |
| Limit card, link                         | Review the receipts you already have                                                                          | Review receipts                                                                                  |
| Waiting time, any surface                | in 426 hours                                                                                                  | Hours up to 48, then days: in 18 days                                                            |
| Settings row                             | Plan · Free plan (390); Billing · See plans (1440)                                                            | Plan and billing · Free · 85 / 100 scans                                                         |
| Billing title and description            | Billing. The plan for this workspace. Each workspace has its own plan.                                        | Plan and billing. Each workspace has its own plan. This is {workspace}.                          |
| Billing, Free, checkout closed           | No subscription. Paid plans aren't open yet. See pricing for what Pro will include.                           | Pro opens soon. Nothing to pay on Free. Link: Compare plans                                      |
| Billing, Pro owner, checkout unavailable | Paid plans aren't open yet. See pricing for what Pro will include.                                            | Billing is unavailable right now. Your plan is not affected.                                     |
| Billing, member of Pro                   | This workspace is on Pro. Only its owner can see invoices or change the plan.                                 | Managed by the workspace owner. Ask them to change the plan.                                     |
| Billing, member of Free                  | Only the workspace owner can upgrade this workspace. Ask them, or use your Free scans here.                   | Only the workspace owner can upgrade this workspace.                                             |
| Workspace sheet, Free cap                | Free accounts own 1 workspace. Upgrade a workspace to Pro to create another.                                  | Free accounts own 1 workspace. Pro owners can have 2.                                            |
| Home card, 80% (code)                    | You've used 85 of 100 Free scans this month                                                                   | 15 free scans left this month                                                                    |
| Home card, 80%, body (code)              | They reset on 1 December at 00:00 UTC. Pro gives this workspace 500 scans a month, up to 200 a day, shared by its members, for $9 a month. | Resets 1 December. Pro gives this workspace 500 scans a month for $9.            |
| Modal, description (code)                | Each workspace has its own plan; this upgrades {workspace} only.                                              | This upgrades {workspace} only. Other workspaces stay on their plan.                             |
| Pricing, Pro card, checkout closed       | Pro checkout opens soon. (boxed)                                                                              | Badge: Opens soon. No box                                                                        |
| Sales CTAs                               | Get started free / Start free / Create a free account                                                         | Start free                                                                                       |
| No-card line                             | No card required / No card needed / No credit card to begin                                                   | No card needed                                                                                   |
| Landing pricing title                    | Start free, scale when you need                                                                               | Start free. Upgrade a workspace when it needs more.                                              |

Terms to hold everywhere: "scans" (never "uploads" for the allowance), "Free" and "Pro" as plan names, "Plan and
billing" for the page, "opens" for when uploads return and "resets" for the counter, dates as "1 December" in
sentences and "1 Dec" in the meter. For translators: "left" and "opens" are short on purpose; allow 40% expansion
in the meter note, which is why it holds one fact.

## Priority

1. Fix the at-limit card: no upgrade instruction without a way to act, days not hours, a real second action (1).
2. Give phone users the count: Settings row always, one line under the upload buttons from 80% (2).
3. Make Billing the one place: plan cards on it, Settings reduced to one row at both widths (3, 4, 14).
4. Shorten the sidebar meter to badge, count with unit, bar and one line; amber on the bar and icon only (10 to 12).
5. One upgrade door per level; remove the menu item and the 20% Home card (5).
6. Until checkout opens, feature Free on pricing and landing and mark Pro "Opens soon"; make signed-in pricing
   show "Your plan" (7, 8).

Then: the subscription card's contradiction (15), what members see (9), one plan badge (13), one CTA label (17, 18).

## Decisions for the owner

1. **Drop the Home upgrade card below 80%?** Today it shows from 20% used. Recommend dropping it: the meter and the
   Billing page are enough until usage makes Pro relevant, and an early card teaches people to dismiss it.
2. **Which card is featured while checkout is closed?** Recommend Free, with Pro marked "Opens soon". The other
   choice keeps Pro featured for price anchoring and accepts a featured card with no button.
3. **What does a member of a Pro workspace see on Billing?** Recommend plan, usage and "Managed by the workspace
   owner" only. Today they see status and renewal date.
4. **Is a phone usage line from 80% enough, or should the count always show on Home?** Recommend from 80% plus the
   Settings row: an always-on meter costs a row of the phone Home that the navigation plan is trying to slim.
5. **Reset times in UTC or local time?** Recommend the date only in the meter and cards ("1 Dec"), with "00:00 UTC"
   kept on the Billing page and FAQ. Converting to local time is more accurate for the person but is new work.
6. **Remove "Upgrade to Pro" from the account menu?** Recommend yes: on desktop it sits directly under the meter's
   own button, and on the phone it is in the same sheet as the meter.
