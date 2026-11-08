# Upgrade call-to-action for Free workspaces (2026-11-08)

Status: proposed. Owner decisions are at the end, each with a recommended default.

## Goal

Free owners can see what Pro gives and how to get it, from Home, the account area and, when they are blocked, a page banner. People who can't buy are not nagged. Every number is real: usage comes from `getUsageSummary()`, Pro's limits from `getPlanTable()` and the price from `PRO_PRICE`. Nothing is hard-coded.

## Who sees it (one gate, `getUpgradeOffer()`)

Add a server-only `apps/web/lib/upgrade-offer.ts`. It returns `null` or `{ level, audience, usage, pro, dismissed }`, and every surface uses it. It returns `null` when any of these is true:

- The active workspace's plan is not `free`. This also covers workspaces an admin gave Pro (comps).
- The session is impersonating (`session.session.impersonatedBy`).
- `getCheckoutFor(isAdmin(session))` is `null`: billing is off, or sandbox keys are on production for a non-admin. Today that hides everything on production for normal users. That is intended.
- Usage is blocked with `"global"` (Pro is paused too, so upgrading would not help).

`audience` is `"owner"` when `canManageBilling(scope.role)`. Otherwise it is `"member"`; workspace admins count as members.

- **Owners** get every surface below.
- **Members** get no promotion. They only get the at-limit text: "Ask the workspace owner to upgrade this workspace to Pro." It appears in the upload panel's limit state and in the meter note when the meter is amber.
- An owner whose account already has Pro elsewhere (the `SEPARATE_UPGRADE` case) sees the normal CTA. The billing page already explains that each workspace is upgraded separately.

## Levels (pure `upgradeLevel(usage)`, unit-tested)

Ratios use the monthly window. If an admin removes the Free monthly limit, they use the daily window.

| Level   | Condition                             | Treatment                                                                 |
| ------- | ------------------------------------- | ------------------------------------------------------------------------- |
| `quiet` | under 80% used, not blocked           | neutral card, outline button                                              |
| `near`  | 80% or more used, not blocked         | emerald-edged card, primary button                                        |
| `at`    | `blocked` is `month`, `day` or `pool` | upload panel's limit state gets the button; warning banner on other pages |

The 80% threshold is one exported constant, `NEAR_RATIO`, shared with `UsageMeter`'s amber state, so the colour and the CTA level never disagree.

## Surfaces

All links go to `/app/settings/billing?via=<surface>&level=<level>`. That page already has the usage meter, Pro's allowance, the monthly/yearly toggle and the Paddle button.

There is no direct checkout from a CTA, for three reasons:

- Paddle.js and its CSP origins load only on the billing page.
- The buyer should see what they are paying for.
- It is one extra tap.

The public `/pricing` page is not linked from inside the app.

### 1. Home (`apps/web/app/app/page.tsx`)

**Where.** A `PlanCard` in the right column, rendered inside the existing `CheckSection` Suspense boundary, under "To check" or "How it works". At 390px the column stacks, so the card sits between the upload panel and Spending, full width.

**When it shows:**

- Owners only, at `quiet` and `near`.
- Only once `counts.total >= 1`, so a brand-new user sees value before a sales pitch.
- Not at `at`. The upload panel's limit state replaces the drop zone and carries the button there, so the page never shows two CTAs.

**Quiet copy:**

- Badge (`secondary`): "Free plan"
- Title: "Pro for this workspace"
- Body: "{used} of {limit} Free scans used this month. Pro gives this workspace {allowance(pro)}, shared by its members."
- Actions: outline button "See Pro, {$9} a month" and ghost button "Not now".

**Near copy:**

- Badge (`warning`, with a CircleAlert icon): "{used} of {limit} used"
- Title: "You've used {used} of {limit} Free scans this month"
- Body: "They reset on {1 December} at 00:00 UTC. Pro gives this workspace {allowance(pro)}, shared by its members, for {$9} a month."
- Actions: primary button "Upgrade to Pro" and ghost button "Not now".

**Visual treatment:**

- The `Card` primitive, `p-5`, same rhythm as `HowItWorks`.
- An emerald icon chip (`border-primary/25 bg-primary/10 text-primary`, Sparkles icon).
- `near` adds `border-primary/30`.
- Numbers use `font-mono tabular-nums`.
- No glow and no gradient. The glow belongs to the hero, not the app.

**Upload panel limit state** (`LimitReached` in `components/upload-panel.tsx`), for owners: add a primary "Upgrade to Pro" link button under the body. Copy changes:

- Month: replace "Upgrade a workspace to Pro for more scans." with "Or upgrade this workspace to Pro for {allowance(pro)}."
- Day: append "Pro allows up to {pro.receiptsPerDay} a day in this workspace."
- Pool: keep "…or upgrade this workspace to Pro." and add the button.
- Members get the "Ask the workspace owner…" sentence and no button.

### 2. Account area: sidebar and phone sheet

- **Usage meter** (`components/usage-meter.tsx`). For owners at any level, add a footer link under the note: "Upgrade to Pro" with an arrow, `text-primary text-xs font-medium`, `max-md:min-h-11`. The `meter` node is shared, so it appears in both the desktop sidebar and the phone `AccountSheet` with no extra row. It is never dismissible, because this is a place the user goes to on purpose.
- **Desktop dropdown** (`UserMenu`). Add a `DropdownMenuItem` "Upgrade to Pro" with a Sparkles icon in `text-primary` and trailing muted mono "$9/mo", placed above Settings. It is the same at every level, so the menu stays calm. The layout passes `upgrade?: { href }`.
- **Phone sheet.** No extra row, because the meter link is already in the sheet and a row would duplicate it. There is no badge or dot on the avatar either. PR #149's "Install app" row sits alongside; order is Upgrade (in the meter), then the rows.
- **Members.** No link and no item. The meter note gets the owner sentence only when it is amber.

### 3. Page banner, only when blocked

**Where.** In the flow at the top of `<main>`, in the slot the layout already gives `SecurityNudge` or `SecurityPrompt`. Priority: security nudge, then security prompt, then upgrade banner, so only one ever shows.

It is not fixed to the bottom. That keeps it out of the tab bar, the cookie banner, the support launcher and PR #149's bottom slot entirely.

**When it shows:**

- Owners, level `at`.
- On every `/app/*` page except `/app` and `/app/upload` (the limit state covers those), `/app/settings/billing`, and `/app/receipts/*`. Receipt pages are where PR #149's install card lives, so this guarantees they never stack.

**Copy:**

- Month: "You've used all {100} Free scans this month. Uploads open on {1 December}. Pro gives this workspace {500} scans a month."
- Day: "You've used today's {20} Free scans. Uploads open at {00:00 UTC}. Pro allows up to {200} a day in this workspace."
- Pool: "Free scanning is busy today: the shared Free capacity is used up. Pro workspaces don't use it."
- Actions: primary button size `sm`, "Upgrade to Pro". Dismiss icon button with `aria-label="Hide until {opens}"`.

**Visual treatment.** Extract a shared `Banner` primitive to `packages/ui/components/banner.tsx`, with tones `primary` and `warning`. `SecurityNudge` becomes its second user, which justifies the abstraction.

- The upgrade banner uses `warning`: `border-warning/30 bg-warning/10`, CircleAlert icon in `text-warning`, body in `text-foreground`.
- The words "used all" / "today's" carry the meaning, so it is not colour alone.
- Markup: `<aside aria-label="Plan limit">`, not `role="status"`, so it is not re-announced on every navigation.

## Dismiss and snooze

Dismissal is stored in a cookie, `receiptocr.upgrade`: httpOnly, `SameSite=Lax`, `path=/app`. It is written by a server action `dismissUpgradeOffer(surface)` and read by `getUpgradeOffer()`. The server omits a dismissed CTA, so there is no flash and no layout shift; the client hides it optimistically while the action runs. Add the cookie to /cookies as a functional preference.

Format: `{ home: { quietDismissals, until, level }, banner: { until } }`

- **Home quiet:** "Not now" hides it for 30 days. The second "Not now" hides quiet for good.
- **Home near:** "Not now" hides it until the month resets.
- **Escalation:** a higher level shows again. A quiet dismissal does not suppress near, and nothing suppresses the limit state.
- **Banner:** dismiss hides it until `usage.opensAt`, i.e. the window reopens.
- **Meter link, menu item, limit-state button:** never dismissible and never shown more than once per screen.
- After a dismissal, focus moves to `#main-content`, which already has `tabIndex=-1`.

## Usage data: already cheap

- `getUsageSummary()` (`lib/quota.ts`) and `getCurrentPlan()` are wrapped in React `cache`. The layout's `Meter` and Home's `UploadSection` already call them on every `/app` request. That is the plan row plus one usage query (`ReceiptRepo.usage`).
- `getCheckoutFor()` reads env only. `getPlanTable()` is the settings read Billing already uses, which is cached in core.
- **Change needed:** the banner and the menu item need plan and usage in the layout before the shell renders. Move `getCurrentPlan()`, `getUsageSummary()` (through `loadUsage`'s try/catch) and `getCheckoutFor()` into the layout's existing `Promise.all`. That adds no new queries; the meter's Suspense then resolves at once from the cache.
- **Risk to check:** this puts the usage query on the shell's critical path. Compare p95 render time on the `/app` page event before and after. If it gets worse, keep the banner in its own Suspense with a `null` fallback, which accepts a shift only in the rare blocked state.

## Layout stability

- The Home card renders in the same Suspense as "To check". Make `PanelSkeleton` cover the card's height for Free owners, or accept growth below the fold on phones.
- The banner is server-rendered with the shell.
- The meter link grows the meter by about 1.25rem. The sidebar foot is bottom-anchored (`mt-auto`), so the user menu doesn't move. Raise `MeterSkeleton` to `h-[6.5rem]` only if the measured shift is visible.

## Accessibility and 390px

Contrast on the dark theme, computed:

| Pair                           | Ratio  |
| ------------------------------ | ------ |
| foreground on `primary/10`     | 13.6:1 |
| muted on `primary/10`          | 6.2:1  |
| warning text on `warning/10`   | 10.1:1 |
| primary button text            | 10.0:1 |
| `text-primary` link on card    | 9.6:1  |
| `text-primary` link on popover | 9.2:1  |

- **Not colour-only:** every state change is also in words (badge text, title) and an icon.
- **Focus:** existing `focus-visible:ring-2 ring-ring` on links and buttons. The menu item uses the dropdown's own roving focus.
- **Tap targets:** button `sm` is already `max-md:h-11`, `icon-sm` is `max-md:size-11`, and the meter link gets `max-md:min-h-11`.
- **Layout at 390px:**
  - Banner and card are `flex-col sm:flex-row`, with actions wrapping onto their own row.
  - Copy wraps and is never truncated.
  - No fixed widths, so there is no horizontal scroll.
- Links read "Upgrade to Pro" or "See Pro, $9 a month". Never "Learn more".

## Measurement (server-side `track()` only, no PII)

Add to `EVENTS` in `apps/web/lib/telemetry/analytics.ts`:

- `upgrade_cta: { action: "token", surface: "token", level: "token" }`
  - `action` is `opened` or `dismissed`
  - `surface` is `home`, `banner`, `limit`, `meter` or `menu`
  - `level` is `quiet`, `near` or `at`
- `checkout_started: { interval: "token", via: "token" }`

Where each is sent:

- `opened`: in `BillingPage` when `?via` and `?level` are in their closed sets. Owner only, not impersonating.
- `dismissed`: in `dismissUpgradeOffer`.
- `checkout_started`: in `startCheckoutAction` on success. `via` is passed from the billing page into `CheckoutButton`.

The funnel then reads: `plan_limit_hit` → `upgrade_cta.opened` → `checkout_started` → `plan_changed`.

There is no `shown` event. Server renders repeat on every navigation, and exposure can be derived from Free owners' Home page events. Add it later only if the funnel needs it.

**Field audit:** all values are closed tokens validated on the server, with source the URL query or a server action argument. None can carry PII.

## Build notes

- Copy goes in a client-safe `lib/upgrade-copy.ts`, worded from `allowance()`, `PRO_PRICE_LABEL` and the usage fields, following the `plan-copy.ts` pattern.
- **Unit tests:** `upgradeLevel` boundaries (79/80/100, day, pool, global), the gate matrix (Pro, comped, impersonating, no checkout, member, admin), and the copy with admin-edited limits.
- **e2e tests:**
  - A Free owner sees the Home card.
  - "Not now" survives a reload with no flash.
  - A member, a Pro workspace and billing turned off each see nothing.
  - At the limit, the banner shows on History and not on Home or Upload.

Screenshots at 1440 and 390 go in a scratch directory, not the repo.

## Owner decisions (recommended default first)

1. **Near threshold:** 80%, matching the meter's amber. The alternative is 70% (the "72 of 100" example).
2. **Production while checkout is admin-only:** hide every CTA, with no "Pro is coming" teaser, per the claims standard.
3. **Shared Pro honesty:** for a workspace with six or more members, 500 shared can be fewer than their combined Free scans (100 each). Default: the copy always says "shared by its members" and never makes multiplier claims. Optionally hide the quiet card when the member count is 5 or more.
4. **Dismissal storage:** cookie (no flash, listed on /cookies) rather than a database column.
5. **Banner only when blocked,** not at near. Near is handled on Home and the meter only.
6. **Members:** no promotion, only the at-limit "ask the owner" line.
7. **Price shown:** "$9 a month" only. The yearly $90 appears on Billing's toggle.
8. **Sequencing:** land after PR #149 merges, so the menu/sheet ordering and the receipt-page exclusion are written against its final markup.
