# Upgrade call-to-action for Free workspaces (2026-11-08)

Status: proposed, revised 2026-11-08 after the owner's review (an upgrade button on Home, and a modal instead of a
redirect). Owner decisions are at the end, each with a recommended default.

## Goal

Free owners can see what Pro gives and buy it without leaving the page they are on: from Home, the sidebar meter, the
account menu and, when they are blocked, a page banner. Every surface opens one upgrade modal; the modal starts Paddle's
checkout. People who can't buy are not nagged. Every number is real: usage comes from `getUsageSummary()`, Pro's limits
from `getPlanTable()` and the price from `PRO_PRICE`. Nothing is hard-coded.

## Who sees it (one gate, `getUpgradeOffer()`)

Add a server-only `apps/web/lib/upgrade-offer.ts`. It returns `null` or
`{ level, audience, checkout, usage, free, pro, workspaceName, dismissed }`, and every surface uses it. It returns
`null` when any of these is true:

- The active workspace's plan is not `free`. This also covers workspaces an admin gave Pro (comps).
- The session is impersonating (`session.session.impersonatedBy`).
- Billing is off (`getCheckoutConfig()` is `null`: no `PADDLE_*` settings at all).
- Usage is blocked with `"global"` (Pro is paused too, so upgrading would not help).

`checkout` is `"open"` when `getCheckoutFor(isAdmin(session))` returns a config, else `"soon"`: sandbox keys on
production for a non-admin, the state the live site is in today. In `soon` the modal cannot sell; see "Checkout not
open" below. `soon` surfaces show at `near` and `at` only (decision 2).

`audience` is `"owner"` when `canManageBilling(scope.role)`, which is the `owner` role only. Otherwise it is
`"member"`; workspace admins count as members.

- **Owners** get every surface below.
- **Members** get no promotion. They only get the at-limit text: "Ask the workspace owner to upgrade this workspace to
  Pro." It appears in the upload panel's limit state and in the meter note when the meter is amber.
- An owner whose account already has Pro elsewhere (the `SEPARATE_UPGRADE` case) sees the normal CTA. The modal's
  subtitle says the upgrade is for this workspace only.

## Levels (pure `upgradeLevel(usage)`, unit-tested)

Ratios use the monthly window. If an admin removes the Free monthly limit, they use the daily window.

| Level   | Condition                             | Treatment                                                                         |
| ------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `quiet` | under 80% used, not blocked           | meter: outline button. Home card only from 20% used, neutral, outline button      |
| `near`  | 80% or more used, not blocked         | meter: primary button, amber bar. Home card emerald-edged, primary button         |
| `at`    | `blocked` is `month`, `day` or `pool` | upload panel's limit state gets the primary button; warning banner on other pages |

Two exported constants: `NEAR_RATIO = 0.8`, shared with `UsageMeter`'s amber state so the colour and the CTA level
never disagree, and `WARM_RATIO = 0.2`, below which Home shows no card (see "Home" for why).

## The modal (`UpgradeModal`)

One client component, mounted once in the app layout, so every `/app/*` page can open it and the deep link works
everywhere. It gets the offer from the layout as props and renders nothing when the offer is `null`.

- **Desktop (`md` and up):** the `Dialog` primitive, `sm:max-w-md` (the default `max-w-sm` is too narrow for a
  two-column comparison). Centred, close button top right, Escape and outside press close it.
- **Phone:** the `Drawer` primitive (bottom sheet): swipe down, Escape or a tap outside close it. Same children; the
  switch is `useIsDesktop()` from `components/groups/responsive-panel.tsx` (move it to `lib/`), read when the modal
  opens so it never flips mid-way.
- **Open:** every trigger dispatches a window event `upgrade-modal:open` with `{ surface }` (the pattern
  `OPEN_ACCOUNT_SHEET` already uses), so nothing is prop-drilled through Home. The modal records which element opened
  it and returns focus there on close; with no trigger (deep link) focus goes to `#main-content`.
- **Deep link:** `/app?upgrade=1` (any `/app/*` path) opens it on load for an owner with an offer; otherwise the
  parameter is ignored. It is removed with `history.replaceState` once read, the way `?capture=1` is, so Back leaves
  the page instead of reopening the modal, and a reload shows the plain page. `&via=email` sets the surface for the
  event; unknown values fall back to `link`.
- **Back:** no history entry is pushed, so Back behaves as it does for every other dialog in the app (there is no
  popstate convention in the codebase yet; adding one for this modal alone would make it the odd one out). Escape,
  the close button, "Not now", swipe and outside press all close it.
- **No JS:** every trigger is a real `<a href="/app/settings/billing">`; the click handler opens the modal and
  prevents navigation. Billing keeps its own checkout, so nothing is lost.

### Contents, top to bottom

```
┌──────────────────────────────────────────────────────────┐
│ FREE PLAN · 84 / 100 used this month                 [x] │
│ Pro for Acme Books                                       │
│ Each workspace has its own plan; this upgrades Acme     │
│ Books only.                                              │
│                                                          │
│ ( Monthly ) ( Yearly  2 months free )                    │
│                                                          │
│ $9  a month per workspace                                │
│ Plus sales tax or VAT where it applies.                  │
│                                                          │
│                              Free            Pro         │
│ Scans a month          100 per person   500 shared       │
│ Scans a day                   20            200          │
│ Members per workspace          3             10          │
│ Workspaces you can own         1              2          │
│ Busy-day pauses           can pause         never        │
│                                                          │
│ [ Continue to checkout, $9 a month ]   [ Not now ]       │
│                                                          │
│ Paddle takes the payment and sends the invoice.          │
│ Cancel any time; full refund within 14 days.             │
│ Compare all plans →                                      │
└──────────────────────────────────────────────────────────┘
```

- **Eyebrow:** `Badge` `secondary` "Free plan" and mono `{used} / {limit} used this month` (`font-mono tabular-nums`).
  At `near` the badge is `warning` with a CircleAlert icon; at `at` it reads "Limit reached".
- **Title:** "Pro for {workspace name}". The name is the user's own; it never goes in an event.
- **Description:** "Each workspace has its own plan; this upgrades {name} only." This is `SEPARATE_UPGRADE` made
  shorter, and it answers "which workspace am I paying for" before the price.
- **Interval:** the existing `IntervalToggle` (native radios, arrow keys work). Default monthly; `?interval=year`
  from the pricing page preselects yearly.
- **Price:** mono `$9` + "a month per workspace", or `$90` + "a year per workspace ($7.50 a month)". Under it, in
  muted small text, "Plus sales tax or VAT where it applies."
- **Comparison:** a real `<table>` with `scope="col"` headers Free and Pro and `scope="row"` labels, five rows, all
  from `getPlanTable()` and `plan-copy.ts` (`allowance`, `membersLine` wording). Numbers `font-mono tabular-nums`,
  right-aligned. The Free column is `text-muted-foreground`, Pro is `text-foreground`, and the Pro header carries the
  `default` emerald badge. The last row says in words what the pool limit means ("can pause on busy days" / "never");
  it is the one Pro advantage the limits table can't show.
- **Actions:** primary "Continue to checkout, {$9 a month | $90 a year}" and ghost "Not now". The primary is
  `disabled` with a spinner while Paddle.js loads or the transaction is created. In `soon` see below.
- **Small print:** "Paddle takes the payment and sends the invoice. Cancel any time; full refund within
  {REFUND_DAYS} days." and the link "Compare all plans" to `/pricing` (same tab; the page's Get Pro sends a signed-in
  visitor back to Billing). Admins on sandbox keys get the existing "Test mode: no real charge" badge above the
  actions.

Copy is clear, literal and free of idioms, per `docs/product-standards.md`. No "Learn more", no "Unlock".

### Primary button: straight to Paddle's overlay, our modal closed first

Paddle's overlay checkout is itself a full-screen modal with its own backdrop and focus handling. Stacking it on
Base UI's `Dialog` fails in two ways: the dialog's focus trap keeps focus out of Paddle's iframe, and a click inside
the overlay counts as an outside press that closes our dialog under it. So:

1. Click: button shows a spinner, `startCheckoutAction(interval, via)` creates the transaction on the server (the
   price, workspace and buyer are its choice, not the browser's). Errors ("Only the workspace owner can upgrade
   it.", "Too many tries…") show inside the modal under the buttons, `role="alert"`, and the modal stays open.
2. Success: close our modal, then on the close transition's end call
   `Paddle.Checkout.open({ transactionId, settings: { displayMode: "overlay", theme: <current theme>, allowLogout: false } })`.
   The `theme` follows the app's theme now that light exists (#163).
3. `checkout.completed`: a `role="status"` toast "Payment received. Turning on Pro for this workspace…", then the
   existing refresh loop (`router.refresh()` every 3 s, up to 20 tries) until the layout's plan prop flips to `pro`,
   when the toast becomes "Pro is on for {name}." and the meter already reads Pro. After 20 tries the slow-webhook
   copy from `CheckoutButton` shows as a toast with a link to Billing.
4. `checkout.closed` without payment: nothing. Focus returns to the trigger. The modal does not reopen; the user
   knows where the button is.
5. Paddle.js fails to load (content blockers): the primary becomes a link "Open checkout on the billing page"
   with the existing "Checkout couldn't load…" sentence, so there is always a way through.

**Shared code.** Move Paddle init, the event listener, the refresh loop and the state machine out of
`CheckoutButton` into `useProCheckout()` (`components/billing/use-pro-checkout.ts`). `CheckoutButton` on Billing and
`UpgradeModal` both call it; `Paddle.Initialize` keeps its once-per-page guard. Billing stays the place to manage
and cancel; the modal is only for buying.

**Loading Paddle.js.** The `<Script src={PADDLE_JS_URL}>` mounts the first time the modal opens, never on page load,
so Free owners who don't act load no third-party script. The CSP already allows Paddle's origins whenever
`NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` is set (`next.config.ts`), on every route; the earlier spec's reason for not
checking out from a CTA was really "the script is mounted on one page", which this removes. The privacy page's
Paddle paragraph covers the script; check it names "when you open the checkout" rather than "on the billing page".

### Checkout not open (`checkout: "soon"`)

Production today: sandbox keys, so only admins can check out and `/pricing` says "Pro checkout opens soon." The
claims standard allows a planned feature when it is labelled as coming, so the modal may exist, but it must not
pretend to sell:

- The eyebrow, title, description and comparison are unchanged. The interval toggle is hidden; the price line reads
  "$9 a month or $90 a year per workspace, when Pro opens."
- Primary: "Email me when Pro opens". It calls a server action that runs `requestProductUpdates(session.user.email)`
  (the double opt-in list from #159; the same confirmation mail), then the button becomes a `role="status"` line:
  "Check your inbox to confirm. If you're already on the list, nothing changes." The list is product updates, which
  is where the Pro launch will be announced, so this is honest and needs no waitlist table or flag. The action is
  owner-only and rate limited like the billing actions.
- When the newsletter is not configured (`newsletterEnabled` false), there is no primary; the small print says "Pro
  opens soon. Your Free scans keep working." and "Compare all plans" remains.
- Only `near` and `at` reach this modal (decision 2). A `quiet` owner cannot buy and is not feeling the limit, so
  telling them about a plan they can't have is noise.

This branch is small (one action, one conditional in the modal) and is worth it only if Pro stays closed on
production for more than a couple of weeks after this ships; otherwise skip it and keep today's "offer is `null`"
behaviour (decision 2).

## Surfaces

Every surface opens the modal with its `surface` token. Nothing links to `/pricing` from inside the app except the
modal's "Compare all plans".

### 1. Home (`apps/web/app/app/page.tsx`)

Desktop, 1440, a Free owner at `near` (84 of 100):

```
┌─ sidebar ───────────┬────────────────────────────────────────────────────────────────────────┐
│ ReceiptOCR          │  Home                                                                  │
│ [Acme Books      v] │  Add a photo of a receipt and we scan the merchant, date, items…       │
│                     │                                                                        │
│  Home               │  ┌─ Upload ──────────────────────────────┐  ┌─ To check ─────────────┐ │
│  History            │  │                                        │  │ Needs review      3 →  │ │
│  Groups             │  │   Drop receipts here, or browse        │  │ Scanning now      1 →  │ │
│  Settings           │  │   16 left today, 16 this month         │  └────────────────────────┘ │
│                     │  │                                        │  ┌─ PlanCard (near) ──────┐ │
│                     │  └────────────────────────────────────────┘  │ (!) 84 of 100 used     │ │
│                     │                                              │ You've used 84 of 100  │ │
│                     │  Spending                                    │ Free scans this month  │ │
│                     │  ┌────────────────────────────────────────┐  │ They reset on 1 Dec…   │ │
│ ┌─ meter ─────────┐ │  │ ▁▂▃▅▆ chart                            │  │ Pro gives this work-   │ │
│ │ Free plan 84/100│ │  │                                        │  │ space 500 scans…       │ │
│ │ ▓▓▓▓▓▓▓▓▓▓▓▓░░  │ │  └────────────────────────────────────────┘  │ [ Upgrade to Pro ]     │ │
│ │ (!) 16 left…    │ │                                              │   Not now              │ │
│ │ [Upgrade to Pro]│ │  Recent receipts                 All receipts →  └────────────────────────┘ │
│ └─────────────────┘ │  ┌────────────────────────────────────────────────────────────────────┐ │
│ (o) Bhim  …      v  │  │ …                                                                  │ │
└─────────────────────┴────────────────────────────────────────────────────────────────────────┘
```

**Where.** The `PlanCard` stays in the right column, inside the `CheckSection` Suspense boundary, under "To check"
(or "How it works"). The alternatives were weighed: a slim row above Spending reads as a banner and would be the
second banner-shaped thing on the page once the blocked state exists; and the sidebar meter already gets a button
(surface 2), so a second sidebar element would crowd a 224px column. The right column is in the reading path next to
the drop zone and holds a card without pushing Spending down on desktop.

**When it shows:**

- Owners only, at `quiet` and `near`.
- `quiet` only from `WARM_RATIO` (20 of 100 this month). This replaces "once `counts.total >= 1`". A person with one
  scan has no reason to pay; a card then costs trust and, worse, gets dismissed for 30 days, which hides it exactly
  when it would convert at 80. Below 20% the meter button is the only Home surface. The owner asked for a button
  "somewhere on Home" for every Free user: the meter button is that, and it is there from the first visit.
- Not at `at`. The upload panel's limit state replaces the drop zone and carries the button there, so the page never
  shows two CTAs.

**Quiet copy:**

- Badge (`secondary`): "Free plan"
- Title: "Pro for this workspace"
- Body: "{used} of {limit} Free scans used this month. Pro gives this workspace {allowance(pro)}, shared by its members."
- Actions: outline button "See Pro, {$9} a month" (opens the modal) and ghost button "Not now".

**Near copy:**

- Badge (`warning`, with a CircleAlert icon): "{used} of {limit} used"
- Title: "You've used {used} of {limit} Free scans this month"
- Body: "They reset on {1 December} at 00:00 UTC. Pro gives this workspace {allowance(pro)}, shared by its members, for {$9} a month."
- Actions: primary button "Upgrade to Pro" (opens the modal) and ghost button "Not now".

**Visual treatment:**

- The `Card` primitive, `p-5`, same rhythm as `HowItWorks`.
- An emerald icon chip (`border-primary/25 bg-primary/10 text-primary`, Sparkles icon).
- `near` adds `border-primary/30`.
- Numbers use `font-mono tabular-nums`.
- No glow and no gradient. The glow belongs to the hero, not the app.

**Phone (390).** The column stacks. The right-column cell becomes `flex flex-col gap-6`; at `near` the card gets
`max-lg:-order-1` so it sits directly under the upload panel, above "To check", because on a phone the sidebar meter
is not visible and this card is the only upgrade surface on Home. At `quiet` it keeps its place after "To check".
No tab-bar badge, no dot on the avatar.

```
┌──────────────────────────────┐
│ ≡ ReceiptOCR   Acme Books (o)│
│ Home                         │
│ Add a photo of a receipt…    │
│ ┌──────────────────────────┐ │
│ │  Drop receipts here or   │ │
│ │  [ Take a photo ]        │ │
│ │  16 left today, 16 this… │ │
│ └──────────────────────────┘ │
│ ┌─ near card ──────────────┐ │
│ │ (!) 84 of 100 used       │ │
│ │ You've used 84 of 100    │ │
│ │ Free scans this month    │ │
│ │ They reset on 1 Dec…     │ │
│ │ [ Upgrade to Pro       ] │ │
│ │ [ Not now              ] │ │
│ └──────────────────────────┘ │
│ ┌─ To check ───────────────┐ │
│ │ Needs review         3 → │ │
│ └──────────────────────────┘ │
│ Spending                     │
│ …                            │
├──────────────────────────────┤
│ Home  History (Scan) Groups ⚙│
└──────────────────────────────┘
```

**Upload panel limit state** (`LimitReached` in `components/upload-panel.tsx`), for owners: add a primary "Upgrade to
Pro" button under the body that opens the modal (surface `limit`). Copy changes:

- Month: replace "Upgrade a workspace to Pro for more scans." with "Or upgrade this workspace to Pro for {allowance(pro)}."
- Day: append "Pro allows up to {pro.receiptsPerDay} a day in this workspace."
- Pool: keep "…or upgrade this workspace to Pro." and add the button.
- Members get the "Ask the workspace owner…" sentence and no button.

### 2. Account area: sidebar meter and phone sheet

- **Usage meter** (`components/usage-meter.tsx`). For owners at every level, a full-width button under the note:
  `outline` `sm` at `quiet`, `default` (filled emerald) at `near` and `at`. Label "Upgrade to Pro" at every level
  (the meter's own numbers say how urgent it is). It is the one persistent surface: on every `/app` page, there from
  the first visit, never dismissible, and it escalates in place, so nothing jumps. The `meter` node is shared, so the
  button also appears in the phone `AccountSheet` with no extra row. The button is a link to `/app/settings/billing`
  that opens the modal on click (surface `meter`).
- **Desktop dropdown** (`UserMenu`). Add a `DropdownMenuItem` "Upgrade to Pro" with a Sparkles icon in
  `text-primary` and trailing muted mono "$9/mo", placed above Settings. It opens the modal (surface `menu`) after the
  menu closes, so focus hands over cleanly. Same at every level, so the menu stays calm. The layout passes
  `upgrade?: boolean`.
- **Phone sheet.** No extra row: the meter button is already in the sheet, and a row would duplicate it. Order:
  workspaces, meter (with its button), then Settings, Admin, Install app, Cookie settings, Sign out.
- **Members.** No button and no item. The meter note gets the owner sentence only when it is amber.

### 3. Page banner, only when blocked

**Where.** In the flow at the top of `<main>`, in the slot the layout already gives `SecurityNudge` or
`SecurityPrompt`. Priority: security nudge, then security prompt, then upgrade banner, so only one ever shows.

It is not fixed to the bottom. That keeps it out of the tab bar, the cookie banner, the support launcher and the
install offer's bottom slot entirely.

**When it shows:**

- Owners, level `at`.
- On every `/app/*` page except `/app` and `/app/upload` (the limit state covers those), `/app/settings/billing`,
  and `/app/receipts/*`. Receipt pages are where the install card (#149) lives, so this guarantees they never stack.

**Copy:**

- Month: "You've used all {100} Free scans this month. Uploads open on {1 December}. Pro gives this workspace {500} scans a month."
- Day: "You've used today's {20} Free scans. Uploads open at {00:00 UTC}. Pro allows up to {200} a day in this workspace."
- Pool: "Free scanning is busy today: the shared Free capacity is used up. Pro workspaces don't use it."
- Actions: primary button size `sm`, "Upgrade to Pro" (opens the modal, surface `banner`). Dismiss icon button with
  `aria-label="Hide until {opens}"`.

**Visual treatment.** Extract a shared `Banner` primitive to `packages/ui/src/components/banner.tsx`, with tones
`primary` and `warning`. `SecurityNudge` becomes its second user, which justifies the abstraction.

- The upgrade banner uses `warning`: `border-warning/30 bg-warning/10`, CircleAlert icon in `text-warning`, body in `text-foreground`.
- The words "used all" / "today's" carry the meaning, so it is not colour alone.
- Markup: `<aside aria-label="Plan limit">`, not `role="status"`, so it is not re-announced on every navigation.

## Phone sheet (the modal at 390)

```
┌──────────────────────────────┐
│            ────              │
│ FREE PLAN · 84 / 100 used    │
│ Pro for Acme Books           │
│ Each workspace has its own   │
│ plan; this upgrades Acme     │
│ Books only.                  │
│ ┌────────────┬─────────────┐ │
│ │  Monthly   │ Yearly 2 mo │ │
│ └────────────┴─────────────┘ │
│ $9  a month per workspace    │
│ Plus sales tax or VAT.       │
│                 Free    Pro  │
│ Scans a month    100    500  │
│ Scans a day       20    200  │
│ Members            3     10  │
│ Workspaces         1      2  │
│ Busy-day pauses  can    never│
│ [ Continue to checkout, $9 ] │
│ [ Not now                  ] │
│ Paddle takes the payment…    │
│ Compare all plans →          │
└──────────────────────────────┘
```

- Everything stacks; the interval toggle and both buttons are full width, `h-11`.
- The table's first column wraps; numbers stay right-aligned and mono.
- About 560px tall at 390x844, inside the Drawer's `max-h-[85dvh]`, so the primary is visible without scrolling on
  most phones; when it isn't, the sheet scrolls as the Drawer already does.
- Paddle's overlay is full-screen on small viewports; the sheet is closed before it opens, as on desktop.

## Dismiss and snooze

Dismissal is stored in a cookie, `receiptocr.upgrade`: httpOnly, `SameSite=Lax`, `path=/app`. It is written by a
server action `dismissUpgradeOffer(surface)` and read by `getUpgradeOffer()`. The server omits a dismissed CTA, so
there is no flash and no layout shift; the client hides it optimistically while the action runs. Add the cookie to
/cookies as a functional preference.

Format: `{ home: { quietDismissals, until, level }, banner: { until } }`

- **Home quiet:** "Not now" hides it for 30 days. The second "Not now" hides quiet for good.
- **Home near:** "Not now" hides it until the month resets.
- **Escalation:** a higher level shows again. A quiet dismissal does not suppress near, and nothing suppresses the
  limit state.
- **Banner:** dismiss hides it until `usage.opensAt`, i.e. the window reopens.
- **Closing the modal** ("Not now", Escape, swipe) is not a dismissal. Only the Home card's and banner's own "Not
  now"/dismiss write the cookie; the person may have closed the modal to read the page.
- **Meter button, menu item, limit-state button:** never dismissible and never shown more than once per screen.
- After a dismissal, focus moves to `#main-content`, which already has `tabIndex=-1`.

## Usage data: already cheap

- `getUsageSummary()` (`lib/quota.ts`) and `getCurrentPlan()` are wrapped in React `cache`. The layout's `Meter` and
  Home's `UploadSection` already call them on every `/app` request. That is the plan row plus one usage query
  (`ReceiptRepo.usage`).
- `getCheckoutFor()` reads env only. `getPlanTable()` is the settings read Billing already uses, cached in core.
- **Change needed, now required:** the modal lives in the layout and needs plan, usage, the plan table and the
  checkout config before the shell renders. Move `getCurrentPlan()`, `getUsageSummary()` (through `loadUsage`'s
  try/catch), `getPlanTable()` and `getCheckoutFor()` into the layout's existing `Promise.all`. No new queries; the
  meter's Suspense then resolves at once from the cache.
- **Risk to check:** this puts the usage query on the shell's critical path. Compare p95 render time on the `/app`
  page event before and after. If it gets worse, keep the modal, banner and menu item in one Suspense with a `null`
  fallback; the meter button then appears with the meter, as it does today.
- The modal's props are small: numbers, the plan policies, the workspace name and Paddle's public client token and
  environment, which `CheckoutButton` already sends to the client.

## Layout stability

- The Home card renders in the same Suspense as "To check". Make `PanelSkeleton` cover the card's height for Free
  owners, or accept growth below the fold on phones.
- The banner is server-rendered with the shell.
- The meter button grows the meter by about 2.5rem. The sidebar foot is bottom-anchored (`mt-auto`), so the user
  menu doesn't move. Raise `MeterSkeleton` to match the measured height for a Free owner.
- Opening the modal changes nothing in the page; closing it to open Paddle's overlay happens after the close
  transition, so there is no frame with both.

## Accessibility and 390px

Contrast on the dark theme, computed earlier for the card and banner; the modal is on `bg-popover`, which the menu
pair below already covers. Re-run the table on the light theme (#163) at build time.

| Pair                           | Ratio  |
| ------------------------------ | ------ |
| foreground on `primary/10`     | 13.6:1 |
| muted on `primary/10`          | 6.2:1  |
| warning text on `warning/10`   | 10.1:1 |
| primary button text            | 10.0:1 |
| `text-primary` link on card    | 9.6:1  |
| `text-primary` link on popover | 9.2:1  |

- **Not colour-only:** every state change is also in words (badge text, title) and an icon. The comparison's Pro
  column is marked by its header badge and words, not colour.
- **Modal semantics:** `Dialog`/`Drawer` give `role="dialog"`, `aria-modal`, a labelled title and description, focus
  moved to the first focusable control (the interval toggle) on open and back to the trigger on close. The
  comparison is a `<table>` with column and row headers, so a screen reader reads "Pro, scans a month, 500 shared".
- **Focus after Paddle:** on `checkout.closed` or `checkout.completed`, focus goes to the remembered trigger, or
  `#main-content` for a deep link. Toasts are `role="status"`, errors `role="alert"`.
- **Focus rings:** existing `focus-visible:ring-2 ring-ring` on links and buttons. The menu item uses the dropdown's
  own roving focus.
- **Tap targets:** button `sm` is already `max-md:h-11`, `icon-sm` is `max-md:size-11`, the meter button is `sm`
  and the interval toggle's labels are `min-h-11`.
- **Layout at 390px:**
  - Banner and card are `flex-col sm:flex-row`, with actions wrapping onto their own row.
  - The sheet is full width with the Drawer's `max-w-lg`; the table's label column wraps.
  - Copy wraps and is never truncated.
  - No fixed widths, so there is no horizontal scroll.
- Links and buttons read "Upgrade to Pro", "See Pro, $9 a month" or "Continue to checkout, $9 a month". Never
  "Learn more".

## Measurement (server-side `track()` only, no PII)

Add to `EVENTS` in `apps/web/lib/telemetry/analytics.ts`, following `install_offer`'s shape:

- `upgrade_cta: { action: "token", surface: "token", level: "token" }`
  - `action` is `opened` (the modal opened), `dismissed` (Home card or banner "Not now") or `notify` (the `soon`
    branch's button).
  - `surface` is `home`, `meter`, `menu`, `limit`, `banner`, `email` (deep link with `via=email`) or `link` (deep
    link without a known `via`).
  - `level` is `quiet`, `near` or `at`.
- `checkout_started: { interval: "token", via: "token", level: "token" }`
  - `via` is a `surface` token or `billing` (the billing page's own button). `level` is `none` from Billing.

Where each is sent:

- `opened` and `notify`: a server action `recordUpgradeCta({ action, surface, level })`, called by the modal, like
  `install-offer-actions.ts`. The server re-derives `level` from usage rather than trusting the client, and checks
  the owner, not impersonating.
- `dismissed`: in `dismissUpgradeOffer`.
- `checkout_started`: in `startCheckoutAction(interval, via)` on success; `via` validated against the closed set.
  Billing's `CheckoutButton` passes `billing`.

The funnel then reads: `plan_limit_hit` → `upgrade_cta.opened` → `checkout_started` → `plan_changed`, with
`surface` saying which placement earns its place and `level` whether people buy before or at the wall.

There is no `shown` event. Server renders repeat on every navigation, and exposure can be derived from Free owners'
Home page events. Add it later only if the funnel needs it.

**Field audit:** all values are closed tokens validated on the server, with source a server action argument. None
can carry PII. The workspace name shown in the modal is never sent.

## Build notes

- Copy goes in a client-safe `lib/upgrade-copy.ts`, worded from `allowance()`, `membersLine()`, `PRO_PRICE_LABEL`
  and the usage fields, following the `plan-copy.ts` pattern. The modal's comparison rows are a function of
  `PlanTable` there too, so the unit test covers admin-edited limits.
- `useProCheckout()` is extracted first, with `CheckoutButton` moved onto it and Billing's e2e test still green,
  before the modal is built on it.
- **Unit tests:** `upgradeLevel` boundaries (19/20 for warm, 79/80/100, day, pool, global), the gate matrix (Pro,
  comped, impersonating, billing off, `soon`, member, admin), the copy with admin-edited limits, and the event
  validators' closed sets.
- **e2e tests:**
  - A Free owner at 20% sees the Home card; at 10% only the meter button.
  - The meter button opens the modal; Escape closes it and focus is back on the button.
  - `/app?upgrade=1` opens the modal, strips the parameter, and a reload shows the plain page.
  - "Not now" on the card survives a reload with no flash; closing the modal does not hide the card.
  - At 390 the modal is a bottom sheet with no horizontal scroll.
  - A member, a Pro workspace and billing turned off each see nothing.
  - At the limit, the banner shows on History and not on Home or Upload.
  - The checkout itself stays covered by Billing's sandbox test; the modal's primary is asserted up to
    `startCheckoutAction` succeeding and the modal closing.

Screenshots at 1440 and 390 go in a scratch directory, not the repo.

## Owner decisions (recommended default first)

1. **Near threshold:** 80%, matching the meter's amber. The alternative is 70% (the "72 of 100" example).
2. **Production while checkout is admin-only:** build the `soon` branch ("Email me when Pro opens", product-updates
   list, `near` and `at` only) only if Pro stays closed on production more than two weeks after this ships;
   otherwise keep hiding every CTA, as today. Never show `soon` at `quiet`.
3. **Shared Pro honesty:** for a workspace with six or more members, 500 shared can be fewer than their combined Free
   scans (100 each). Default: the copy always says "shared by its members" and never makes multiplier claims; the
   comparison table says "per person" and "shared" in the cells. Optionally hide the quiet card when the member count
   is 5 or more.
4. **Dismissal storage:** cookie (no flash, listed on /cookies) rather than a database column.
5. **Banner only when blocked,** not at near. Near is handled on Home and the meter only.
6. **Members:** no promotion, only the at-limit "ask the owner" line.
7. **Home card start:** from 20% used (`WARM_RATIO`), not from the first scan. The alternative is the first scan with
   the 30-day snooze; the risk is the snooze hiding the card at 80%.
8. **Checkout from the modal:** Paddle's overlay opens from the modal after it closes, with the shared
   `useProCheckout()`. The alternative is the modal's primary linking to Billing, which keeps Paddle.js on one page
   but adds the tap the owner wants gone.
9. **Deep link history:** no history entry on open, so Back leaves the page. The alternative is a pushState so Back
   closes the sheet on Android; worth doing only as an app-wide convention for every sheet.
