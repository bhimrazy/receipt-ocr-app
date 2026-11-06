# Usage surfaces: design spec (2026-11-06)

Spec only, no code. Base: `main` @ 303a4bb. Inputs: `AGENTS.md`, `docs/product-standards.md`, plans
`2026-11-06-combined-plan.md` and `2026-11-06-ai-usage-models.md`, reviews `2026-11-06-ceo.md` and `-market.md`.
`2026-11-06-members-admin-plan.md` is **not on disk** (the CEO review notes the same gap), so the member/seat parts
below come from the code (`components/members/*`, `roles.ts`) and the market review's "plan belongs to the workspace"
recommendation.

No dev server was running, so the critique in section 3 comes from reading the code, not screenshots. Before/after
screenshots belong to the implementation PR (`node scripts/screenshot.mjs --widths 1440,390`, scratch dir only).

Data this spec assumes (combined plan, track 1): an `ocr_calls` row per model call (receipt_id with no FK,
organization_id, user_id, round, step, model, provider, status, latency_ms, input/cached/output/reasoning tokens,
cost_micro_usd, price_from, created_at); receipts with overall + per-line confidence and the deterministic checks;
workspace members with roles owner/admin/member; plan limits with a **period** that may be `day` (per user, today) or
`month` (per workspace, later).

---

## 0. Shared foundations (build these first)

### 0.1 One period model, one copy table

Today "today", "a day", "daily" and "00:00 UTC every day" are hard-coded in at least six places (`usage-meter.tsx`
twice, `upload-panel.tsx` three times, settings page twice, admin overview twice). Replace them with one value from
`packages/core` and one copy helper in `apps/web/lib/usage-copy.ts`:

```ts
type UsagePeriod = {
  unit: "day" | "month";
  scope: "user" | "workspace";
  start: Date;
  resetsAt: Date;
};
type Usage = {
  used: number;
  limit: number;
  period: UsagePeriod;
  blocked: "limit" | "global" | null;
};
```

Every string below uses these slots; the table shows both renderings so either period works with no copy change.

| Slot             | `day`                         | `month`                     |
| ---------------- | ----------------------------- | --------------------------- |
| `{this period}`  | today                         | this month                  |
| `{per period}`   | a day                         | a month                     |
| `{period limit}` | daily limit                   | monthly limit               |
| `{resets}`       | Resets in 6 hours (00:00 UTC) | Resets on 1 Dec (00:00 UTC) |
| `{resets short}` | in 6 h                        | on 1 Dec                    |
| `{who}` (scope)  | You                           | This workspace              |

Rules: relative time first, UTC clock second (the product is international and `formatTime` is fixed to UTC for
hydration). Day-unit relative uses `formatTimeUntil`; month-unit uses `formatDate` without the year.

### 0.2 What counts (customer-facing definition, shown on Settings → Usage)

> A receipt counts once, the first time it is read. Receipts that couldn't be read don't count, and neither does
> trying them again. Deleting a receipt doesn't give it back.

The last sentence is new and required once the quota counts from `ocr_calls` (it closes the delete-to-reset P0). The
first rule assumes a successful retry of a failed receipt counts once (owner decision D3).

### 0.3 Number formatting (one module, `apps/web/lib/format.ts`)

All numbers are `font-mono tabular-nums`, right-aligned in tables. Grouping is `en-US` (already used by `Stat`).

| Kind             | Format                                 | Example                | Screen reader / title                                            |
| ---------------- | -------------------------------------- | ---------------------- | ---------------------------------------------------------------- |
| Counts           | grouped integer                        | `1,284`                | same                                                             |
| Remaining        | `{n} left`                             | `6 left`               | "6 receipts left today"                                          |
| Percent          | integer %, one decimal below 10%       | `92%`, `3.4%`          | same                                                             |
| Cost total ≥ $1  | 2 decimals                             | `$12.47`               | "12 dollars 47" is not needed; plain text is fine                |
| Cost total < $1  | 4 decimals                             | `$0.4821`              | same                                                             |
| Cost per receipt | always 4 decimals                      | `$0.0021`              | same                                                             |
| Tokens           | compact, 1 decimal                     | `1.2M`, `84.3K`, `912` | full value in `title` and sr text: "1,204,331 tokens"            |
| Latency          | `ms` below 1 s, else 1-decimal seconds | `640 ms`, `3.2 s`      | same; units always written, never bare                           |
| Unknown          | em dash                                | `—`                    | `<span class="sr-only">Unknown</span>` (existing `None` pattern) |

Never print `$0.0000` or `0 tokens` for unknown; unknown is `—` with a footnote count ("12 calls have no price").
Costs are labelled **Estimated** wherever shown: they come from our price table, not a provider invoice.

### 0.4 Components

| Need                  | Use                                                                                                             | Change                                                                                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usage meter           | **New `Meter` in `packages/ui`** merging `components/usage-meter.tsx` and `components/admin/meter.tsx`          | Two meters already disagree (customer turns amber at the limit, admin turns red). One component, `role="meter"`, tones: primary < 80%, warning ≥ 80%, warning + icon + words at 100%. Red stays for errors, not for a limit the user reached on purpose. |
| Headline numbers      | `components/admin/stat.tsx` (`Stat`)                                                                            | Move to `packages/ui` as `Stat` once the customer usage page uses it (second real use). Add optional `sub` slot for a delta.                                                                                                                             |
| Period / range switch | Link group built from `buttonVariants({variant:"outline", size:"sm"})`, `aria-current="page"` on the active one | No Tabs primitive exists; URL state (`?range=7d`) like `ListToolbar`. Not a new primitive until a third use.                                                                                                                                             |
| Tables                | `packages/ui` `Table*`                                                                                          | Numeric `TableHead`/`TableCell` get `text-right font-mono tabular-nums`.                                                                                                                                                                                 |
| Daily bars            | `components/admin/daily-chart.tsx` generalised to `BarChart` (`days`, `series[]`, `format`)                     | Adds y-axis max label, keyboard-reachable values, visible table toggle (see 0.5).                                                                                                                                                                        |
| Status                | `Badge` variants `success/warning/destructive/secondary`                                                        | Always icon + label.                                                                                                                                                                                                                                     |
| Disclosures           | native `<details>` styled like the existing "Raw extraction (JSON)"                                             | For "Show as table" and per-receipt "How it was read".                                                                                                                                                                                                   |
| Section layout        | `SettingsSection` (customer), `AdminSection` / `AdminPageHeader` (admin)                                        | none                                                                                                                                                                                                                                                     |
| Lists                 | `Pager` (admin)                                                                                                 | none                                                                                                                                                                                                                                                     |
| Notices               | `Alert` variants `warning`, `destructive`                                                                       | none                                                                                                                                                                                                                                                     |

### 0.5 Chart rules (dataviz pass)

- Chart colour tokens are new: add `--chart-1: #059669` and `--chart-2: #3b82f6` to `packages/ui/src/styles.css`.
  Validated with the dataviz validator against the card surface `#141416`, dark mode: lightness band, chroma, CVD
  (worst ΔE 22.7 deutan), normal-vision ΔE 24.0 and 3:1 contrast **all pass**. The existing `--primary #34d399` +
  `--info #7dd3fc` pair **fails** the dark lightness band (both too light, L 0.77 / 0.83), so don't reuse them as
  series colours. `--primary` stays the UI accent; `--destructive` stays the status colour for "failed".
- Cached tokens are a subset of input, so they are `--chart-1` with a 45° hatch, not a third hue.
- One y-axis per chart. Cost and receipts are two charts, never one dual-axis chart.
- Every chart: title names the series and unit ("Estimated cost per day, USD"), a y-axis max label, the first and
  last date, a hover **and focus** tooltip (each bar is a focusable `<button>`-less `<g tabindex="0">` or the day
  column is a link to the day's filter), and `<details>` "Show as table" with the same numbers. The sr-only table in
  today's `DailyChart` becomes this visible-on-demand table so sighted keyboard users get it too.
- Single series: no legend box, the title names it. Two or more: legend plus direct labels.
- `prefers-reduced-motion`: no bar grow-in.

---

## 1. Customer side

Principle (CEO review, agreed): customers see **receipts**, not tokens or dollars. Per receipt they see confidence
and what to check; the model is a details line, not a headline. Cost shows only when the service owner turns it on
(D1).

### 1.1 Home (`/app`)

Problem today: on phones the usage meter lives only in the desktop sidebar (`hidden md:block`), and the empty upload
panel doesn't show usage, so at 390px a user sees nothing about their allowance until they have already picked
photos. Fix: a compact usage strip at the top of the upload panel, at every width. The sidebar meter stays on desktop
(it is the always-visible one); on desktop the strip collapses to one line to avoid saying the same thing twice
loudly.

**1440, normal (under 80%)**

```
┌ sidebar ─────────┐  Upload receipts
│ Receipt OCR      │  Add a photo and we read the merchant, date, items and total.
│ [Workspace ▾]    │
│ Home             │  ┌───────────────────────────────────────────┐  ┌ To check ──────────── 48 receipts ┐
│ History          │  │ 14 of 20 used today · 6 left · Resets in 6 h  Usage ›│  │ ▲ Needs review              3  › │
│ Settings         │  │ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │  │ ⊘ Couldn't read             1  › │
│                  │  │   ⤒  Drop receipt photos here, or click    │  └──────────────────────────────────┘
│ ┌ Free plan ───┐ │  │      JPEG, PNG, WebP, HEIC or PDF, 10 MB  │
│ │ 14 / 20 today│ │  │ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
│ │ ███████░░░░░ │ │  └───────────────────────────────────────────┘
│ │ 6 left. Resets in 6 h (00:00 UTC) │
│ └──────────────┘ │  Recent receipts                                   All receipts →
└──────────────────┘
```

**390, near limit (≥ 80%)**

```
┌──────────────────────────────┐
│ Receipt OCR   [Work ▾]  (B)  │
├──────────────────────────────┤
│ Upload receipts              │
│ ┌──────────────────────────┐ │
│ │ ⚠ 2 left today           │ │   ← warning tone, icon + words
│ │ ████████████████░░  18/20│ │
│ │ Resets in 6 h (00:00 UTC)│ │
│ ├──────────────────────────┤ │
│ │      ⤒                   │ │
│ │ Take a photo or choose   │ │
│ │ from your library        │ │
│ │ [ 📷 Take a photo      ] │ │  ← 44px buttons (existing)
│ │ [ Choose photos        ] │ │
│ └──────────────────────────┘ │
│ To check …                   │
├──────────────────────────────┤
│ Home  History  Settings      │  ← tab bar (existing)
└──────────────────────────────┘
```

Strip copy (`UsageStrip`, inside the upload `Card`, above the drop zone, `aria-live="polite"` so a refresh after
upload is announced):

| State                            | Line 1                                                                                                | Line 2                     | Tone                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------- |
| Normal                           | `{used} of {limit} used {this period}` · `{left} left`                                                | `{resets}`                 | muted, primary bar     |
| Near (≥ 80%)                     | `{left} left {this period}`                                                                           | `{resets}`                 | warning, `CircleAlert` |
| Last one                         | `1 left {this period}`                                                                                | `{resets}`                 | warning                |
| Queue exceeds room               | (queue footer, existing) `You have {left} left {this period}, so only the first {left} will be read.` |                            | warning                |
| Workspace scope, several members | `{used} of {limit} used by this workspace {this period}`                                              | `You read {mine} of them.` | as above               |
| Usage failed to load             | strip hidden (existing `loadUsage` behaviour)                                                         |                            |                        |

The strip's right edge carries a `Usage ›` link to `/app/settings/usage` (min 44px tall on mobile).

**Limit reached** (replaces the drop zone, existing `LimitReached` card, copy made period-aware):

| Case                                    | Title                                                            | Body                                                                                                                                        | Actions                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Own limit, user scope                   | `You've used all {limit} receipts for {this period}`             | `Your plan reads {limit} receipts {per period}. You can upload again {resets}. Receipts that couldn't be read don't count.`                 | `Review the receipts you already have` (link), `See usage` (link)                             |
| Workspace scope, viewer is owner        | `This workspace has used all {limit} receipts for {this period}` | `Uploads open again {resets}.`                                                                                                              | `See who used what` → Settings → Usage; upgrade action only when billing exists (claims rule) |
| Workspace scope, viewer is member/admin | same title                                                       | `Uploads open again {resets}. To read more now, ask the workspace owner, {ownerName}.`                                                      | `Review the receipts you already have`                                                        |
| Service-wide cap                        | `Receipt reading is paused for everyone`                         | `The service has read as many receipts as it can today, for all accounts. This isn't a limit on your account. Uploads open again {resets}.` | `Review the receipts you already have`                                                        |

No "Upgrade" button until checkout exists (product standard: no claims we can't back up). When billing ships, the
owner variant gets `Upgrade to Pro` as the primary action.

### 1.2 Settings → Usage (`/app/settings/usage`, new)

Settings keeps a short "Plan and usage" section (meter + "Receipts {per period}" + "Workspaces you can own") with a
`Usage details ›` button (`buttonVariants outline sm`, like the existing `Members ›`). The detail page follows the
members page pattern.

**1440**

```
← Settings
Usage
Receipts read in Acme Studio. Days are UTC.

[ This month ] [ Last month ]                               ← range links; day unit: [ Today ] [ Last 14 days ]

┌ Free plan ──────────────────────────────────────────────────────────────────────────────┐
│ 312 of 500 used this month                                       188 left · Resets on 1 Dec │
│ ███████████████████████░░░░░░░░░░░░░░                                                   │
└──────────────────────────────────────────────────────────────────────────────────────────┘

┌ Read ─────────┐ ┌ Needs review ─┐ ┌ Couldn't read ─┐ ┌ Avg read time ─┐
│ 312           │ │ 27            │ │ 9              │ │ 3.4 s          │
│ counted       │ │ 8.7% of read  │ │ not counted    │ │ per receipt    │
└───────────────┘ └───────────────┘ └────────────────┘ └────────────────┘

Receipts read per day                                                    [Show as table ▸]
 40 ┤            ▇
    │      ▅     █  ▃        ▆
    │ ▂ ▃  █ ▄ ▂ █  █ ▁ ▃    █ ▂
  0 ┼──────────────────────────────
     1 Nov                    Today

By member                                                     (owner/admin only, ≥ 2 members)
 Member                     Role     Read   Needs review   Share
 Asha Rao (you)             Owner     201             14     64%
 Ben Ortiz                  Member     98             11     31%
 Former member              —          13              2      4%
                                     ────
                                      312
```

**390**: range links wrap to a 2-up row of 44px buttons; the four stats go 2×2 (`grid-cols-2`, existing pattern);
the chart keeps 14/30 bars with `gap-0.5` and labels only first/last; the member table becomes a list:

```
│ Asha Rao (you) · Owner        │
│ 201 read · 14 to review   64% │
│ ██████████████░░░░░░          │  ← share bar, decorative (aria-hidden), number is the data
```

Copy:

| Element                               | Copy                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Page title / description              | `Usage` / `Receipts read in {workspace}. Days are UTC.`                                                             |
| Range links                           | day: `Today`, `Last 14 days`; month: `This month`, `Last month`                                                     |
| Meter                                 | as Home strip; past range shows `{used} receipts read in {Month}` with no bar (no limit to compare after it closed) |
| Stat: Read                            | label `Read`, note `counted`                                                                                        |
| Stat: Needs review                    | label `Needs review`, note `{pct} of read`; links to `/app/history?status=needs-review`                             |
| Stat: Couldn't read                   | label `Couldn't read`, note `not counted`; links to `/app/history?status=failed`                                    |
| Stat: Avg read time                   | label `Avg read time`, note `per receipt` (mean of the successful round's call latency)                             |
| Chart title                           | `Receipts read per day` (single series `--chart-1`; failed not shown here, it's in the stat)                        |
| Member table title / description      | `By member` / `Who read the receipts counted {this period}.`                                                        |
| Deleted user row                      | `Former member` (user_id null)                                                                                      |
| What counts (footer, `text-xs muted`) | the three sentences in 0.2                                                                                          |
| Usage since                           | if the period started before `ocr_calls` existed: `Usage is counted from 6 Nov 2026.`                               |

Visibility: workspace **owner and admin** see the member table; **members** see the workspace meter, the stats and a
single `You read {n} of them` line (D4). With one member the table is hidden.

Cost (only if the service owner enables D1 for this workspace): one more stat `Estimated cost` with note
`from model prices, not a bill`, and a `Cost` column in the member table. Never tokens.

Empty states:

| Case                     | Copy                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| No receipts this period  | Title `No receipts read {this period}`; body `Receipts you upload appear here. Failed ones don't count.`; action `Upload receipts` → `/app` |
| Last period empty        | `No receipts were read in {Month}.`                                                                                                         |
| Chart with all zero days | chart replaced by the empty state above, not a flat line                                                                                    |

### 1.3 Per-receipt "How it was read" line (results view)

Under the header badges (date, category, confidence), a details line in `text-xs text-muted-foreground font-mono`
for numbers:

```
Read by Gemini 3.8 Flash · 3.2 s · 92% confidence · Check: total, 2 lines
```

| Case                            | Copy                                                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal                          | `Read by {model label} · {time} · {pct} confidence`                                                                                                                                                              |
| With checks                     | append ` · Check: {fields}` where fields come from `checksFor` (`merchant`, `date`, `total`, `{n} line(s)`); the existing warning banner stays the detailed version and the line links to it (`#checks-heading`) |
| Retry                           | `Read on try {round} of 3 by {model}`                                                                                                                                                                            |
| Fallback used                   | same line, model is the one that produced the result. No "fallback" wording for customers.                                                                                                                       |
| Legacy receipt (no `ocr_calls`) | line omitted, never "Unknown model"                                                                                                                                                                              |
| Failed                          | no line; the existing failure alert already says what to do                                                                                                                                                      |
| In flight                       | no line; existing "Reading this receipt" status                                                                                                                                                                  |
| Cost opted in (D1)              | append ` · est. $0.0021`                                                                                                                                                                                         |

Model label comes from the registry `label`. Mobile: the line wraps at the `·` separators (each segment
`whitespace-nowrap`), no horizontal scroll.

Keyboard/AT: plain text, no interactive parts except the `Check:` link. Confidence keeps its badge with icon + word.

### 1.4 History list

No usage numbers here. One addition: when a filter is `needs-review`, the list header shows `{n} receipts to check`
(already counted on Home). Nothing about models or cost.

---

## 2. Admin side

### 2.1 Navigation and Overview links

- New nav item **Usage** (`/admin/usage`, lucide `Gauge`) between Overview and Users in `admin-nav.tsx`. Six items in
  the 390 bottom tab bar is 65px each: fits 44px targets, but the label `Audit log` gets tight; shorten tab labels to
  `Audit` on mobile only, or move Audit and Settings under a `More` item (D7).
- Overview gets a cost row **above** the user/workspace stats (cost is the number the owner runs the business on):

```
┌ Est. cost today ┐ ┌ Est. cost, 7 days ┐ ┌ Cost per receipt, 7 d ┐ ┌ Failed calls, 7 d ┐
│ $1.84           │ │ $11.20            │ │ $0.0021               │ │ 3.4%              │
│ 812 receipts    │ │ ▲ 18% vs prior 7 d│ │ incl. failed calls    │ │ 1.1% fell back    │
└──────── → usage ┘ └───────── → usage ┘ └──────────── → usage ┘ └──────── → usage ┘
```

Each tile is a `Stat` with `href` into `/admin/usage?range=...`. Deltas: arrow + words + sign ("▲ 18% vs prior 7
days"), colour neutral (cost up is not inherently bad). The existing users/workspaces/receipts tiles move to the
second row.

- The cap card is renamed and its unit made explicit: title `Service-wide daily cap`, number label
  `Model calls today` (not receipts), note `Counts every model call, including retries and fallbacks, since 00:00
UTC.` The banned / unverified links move out of the cap card into the Users stat note.
- "Near the daily limit" becomes period-aware: `Near the limit` / `{Users|Workspaces} at 80% or more of their
{period limit}.`

### 2.2 Usage page (`/admin/usage`)

URL state: `?range=today|7d|30d` (default `7d`), `&model=`, `&page=` for the workspace table. Header description:
`Model calls, tokens and estimated cost across the service. Days are UTC; figures as of {time}. Usage is counted
from 6 Nov 2026.`

**1440**

```
Usage
Model calls, tokens and estimated cost across the service. Days are UTC; figures as of 14:05 UTC.

[ Today ] [ 7 days ] [ 30 days ]

┌ Est. cost ────┐ ┌ Receipts read ┐ ┌ Cost per receipt ┐ ┌ Failed calls ┐ ┌ Needed fallback ┐
│ $11.20        │ │ 5,284         │ │ $0.0021          │ │ 3.4%         │ │ 1.1%            │
│ ▲18% vs prior │ │ 6,102 calls   │ │ incl. failed     │ │ 207 of 6,102 │ │ 58 receipts     │
└───────────────┘ └───────────────┘ └──────────────────┘ └──────────────┘ └─────────────────┘
⚠ 12 calls have no price (model missing from the price table). Totals leave them out.   ← Alert warning, only if > 0

Estimated cost per day, USD                                        [Show as table ▸]
 $2.40 ┤                         ▇
       │        ▅    ▆      ▃    █
       │  ▃  ▄  █ ▂  █  ▅   █ ▂  █   ...30 bars
  $0   ┼──────────────────────────────────
        8 Oct                       Today

┌ Tokens ─────────────────────────────────────────┐ ┌ Failures by kind ───────────────┐
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░░░░                  │ │ Timed out            112  54%  │
│ Input 18.4M   of which cached 4.1M   Output 3.2M │ │ Invalid output        61  29%  │
│ Reasoning (inside output) 0.9M                   │ │ Provider error        24  12%  │
│ Avg per receipt: 3,480 in · 610 out              │ │ Rate limited          10   5%  │
└──────────────────────────────────────────────────┘ └─────────────────────────────────┘

By model                                                                        7 days
 Model                    Calls   Failed   As fallback   p50     p95     Est. cost   Per receipt
 Gemini 3.8 Flash         5,630    3.1%        —         2.9 s   6.8 s     $10.40      $0.0019
 Gemini 3.5 Flash-Lite      472    7.2%       12%        1.8 s   4.1 s      $0.80      $0.0014
 Fixture                      0      —          —          —       —          —            —

By workspace, top 10 by cost                                          All workspaces →
 Workspace         Plan   Receipts   Calls   Failed   Est. cost   Per receipt   Share
 Acme Studio       Pro       1,204   1,260     2.0%      $2.61      $0.0022     23%
 …
                                                          1–10 of 341 workspaces  [‹ Previous] [Next ›]

Recent failed calls                                                          → receipt detail
 Time        Workspace     Model               Result          Time
 14:02 UTC   Acme Studio   Gemini 3.8 Flash    Timed out       30.0 s   →
```

**390**: range links as three equal 44px buttons; stats `grid-cols-2` (fifth stat spans 2); daily chart keeps 30
bars at `gap-px` (each ~10px wide; tooltips on tap; the table toggle is the reliable path); tokens bar full width with
the legend as a stacked `dl`; **by-model and by-workspace tables become card lists** (one `li` per model: name on
line 1, `Calls 5,630 · Failed 3.1% · p95 6.8 s` on line 2, cost right-aligned) — never a horizontally scrolling
table on the page (product standard).

Definitions (shown as `TooltipTrigger` on an info icon next to each label, plus in a `<details>` "How these are
counted" at the page foot, so they are reachable without hover):

| Label                                      | Definition copy                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Est. cost                                  | `Sum of each call's cost from our model price table at the time of the call. Not a provider invoice.`              |
| Receipts read                              | `Receipts with at least one successful call in this range.`                                                        |
| Cost per receipt                           | `Estimated cost of all calls, including failed ones, divided by receipts read.`                                    |
| Failed calls                               | `Calls that returned an error, timed out or gave output we couldn't use.`                                          |
| Needed fallback                            | `Receipts that were read by a model after the first one in the chain failed.`                                      |
| As fallback (model table)                  | `Share of this model's successful calls where it ran as a fallback.`                                               |
| p50 / p95                                  | `Half / 95% of successful calls finished within this time.`                                                        |
| Tokens input / cached / output / reasoning | `Input includes cached tokens. Output includes reasoning tokens.` (prevents the double count the plan warns about) |

Failure kinds (from `OcrFailureKind`): `timeout` → `Timed out`, `rate-limited` → `Rate limited`, `provider-error` →
`Provider error`, `invalid-output` → `Invalid output`, `bad-image` → `Unreadable photo`, `not-configured` →
`Key or model not set up`.

Empty states:

| Case                         | Copy                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| No calls in range            | `No model calls {today                                                                                                      | in the last 7 days | in the last 30 days}.`+`Usage is counted from 6 Nov 2026.` |
| Range starts before tracking | stat note `since 6 Nov` instead of the delta; chart days before it are blank with a `Not tracked` axis label, not zero bars |
| Prior window has no data     | delta omitted (never "▲ ∞%")                                                                                                |
| Model with 0 calls           | row stays (shows configured-but-idle models), cells `—`                                                                     |
| No failures                  | Failures card: `No failed calls in this range.`                                                                             |

Tokens bar: three segments with 2px surface gaps — Input (uncached) `--chart-1`, Cached `--chart-1` hatched,
Output `--chart-2`. Reasoning is not a segment (it is inside output); it is a text line. The `dl` under the bar is the
data; the bar is `aria-hidden`.

Daily cost chart: single series `--chart-1`, bars, y-axis labels at 0 and the rounded max, a dashed reference line
for the range's mean labelled `avg $0.37`. Days with unpriced calls get a small `*` under the bar and a table
footnote. Optional second chart (same component) `Receipts read per day` below it for 30d only; never a second axis.

### 2.3 Workspace and user detail

- `/admin/workspaces/[id]`: add a `Usage, last 30 days` section: three `Stat`s (`Receipts read`, `Est. cost`,
  `Cost per receipt`), the per-member table from 1.2 (with cost), and `Recent receipts` (20, `Pager`) linking to
  receipt detail. The existing `Receipts today` stat becomes `Receipts {this period}` with the `Meter`.
- `/admin/users/[id]`: the existing `Meter` (receipts used today) uses the period copy; add `Est. cost, 30 days`.

### 2.4 Receipt detail with every attempt (`/admin/receipts/[id]`, new)

Reached from: Usage → Recent failed calls, Workspace → Recent receipts, and a `?receipt=` search on the Usage page.

```
← Acme Studio
Receipt 7f3c…a91e                                     [Copy ID]
Uploaded 6 Nov 2026, 13:58 UTC by ben@acme.test · Acme Studio · Pro
Status: ✓ Done · Confidence 92% · 2 reading rounds · 3 calls · Est. $0.0041 · 41.6 s total

Reading attempts (oldest first)
 #  Round     Step         Model               Result            Time     In      Cached   Out    Est. cost
 1  Upload    Primary      Gemini 3.8 Flash    ⊘ Timed out       30.0 s   —       —        —        —
 2  Upload    Fallback 1   Gemini 3.5 Flash-L  ⊘ Invalid output   4.2 s   3,412   0        388   $0.0011
 3  Retry 1   Primary      Gemini 3.8 Flash    ✓ Read             7.4 s   3,410   2,048    602   $0.0030
                                                                 ─────                         ───────
                                                                  41.6 s                       $0.0041
Price rows used: gemini-3.8-flash from 2026-11-01; gemini-3.5-flash-lite from 2026-10-01.
```

- Ordered by `created_at, round, step`. `Round`: `Upload` for 1, `Retry {n-1}` after. `Step`: `Primary`, `Fallback
{n}`.
- Result uses `Badge` with icon + label (success / destructive). Unknown tokens/cost are `—`, never 0; the total row
  says `+ 1 call with unknown cost` when any is null.
- Receipt deleted (no receipt row, attempts remain): title `Deleted receipt 7f3c…a91e`, `Alert` `The receipt was
deleted. Its reading attempts are kept for usage records.` No image, no fields.
- Privacy: the page shows metadata and the extracted fields, **not the photo** by default. Viewing the photo is a
  button `Show photo` that writes an audit-log entry (D6).
- 390: the attempts table becomes an ordered list (`<ol>`), one card per attempt: line 1 `#2 · Upload · Fallback 1`,
  line 2 model + result badge, line 3 `4.2 s · 3,412 in · 388 out · $0.0011`.

### 2.5 Keeping it fast

Volume now is small (the CEO review estimates hundreds of receipts a day). Start simple, with explicit triggers:

1. **Raw queries first** on `ocr_calls` with the planned indexes `(created_at)`, `(organization_id, created_at)`,
   `(receipt_id)`. A 30-day window at 10k calls/day is 300k rows; `percentile_cont` over that is tens of ms in
   Postgres 18. All aggregates live in `packages/core` (thin pages, per AGENTS.md).
2. **One query per section, run in parallel** (`Effect.all`), each streamed in its own `<Suspense>` with a `Skeleton`
   of the final shape, so a slow percentile query doesn't block the stat row.
3. **Cache admin aggregates for 60 s** (`"use cache"` + `cacheLife` 60 s, tag `usage`); the header already says
   "figures as of {time}", which makes staleness visible. Customer usage meter is **never cached** (it gates uploads
   and must be exact).
4. **Daily rollup when a trigger fires** — `ocr_calls` > 2M rows, or the Usage page p95 > 500 ms: table
   `ocr_usage_daily(day, organization_id, model, calls, ok, failed, fallback_ok, receipts_ok, input, cached, output,
reasoning, cost_micro_usd, unpriced_calls, latency_hist int[])`. Closed UTC days come from the rollup, today from
   raw. Percentiles across days come from a fixed log-bucket latency histogram (e.g. 24 buckets, 100 ms → 60 s),
   so p50/p95 are approximate (label them `≈` when served from the rollup). Filled by an idempotent upsert of
   "yesterday" — run on first admin page load after 00:05 UTC until the job runner exists, then as a BullMQ job.
5. **Pagination**: workspace table top 10 with `Pager` (offset is fine at hundreds of workspaces; switch to keyset on
   `(cost desc, organization_id)` past ~10k). Recent failed calls: 20, keyset on `(created_at, id)` with "Older →".
   Receipt attempts: unpaginated (≤ 3 rounds × chain length).
6. Count distinct receipts with `count(distinct receipt_id) filter (where status='ok')` once per query, not per row.

---

## 3. Critique of the current screens (what this should fix)

From the code on `main`; confirm with screenshots during implementation.

### Admin overview (`app/admin/page.tsx`)

1. **No cost anywhere.** The number the owner most needs (what a receipt costs us) is absent; the CEO review's top
   internal ask. Fixed by the cost row (2.1) and the Usage page.
2. **Mixed units side by side.** `Receipts today` counts receipts; the cap card counts provider calls
   (`readsToday`), with the label "Service-wide daily cap" not saying which. An admin comparing 812 receipts with
   1,020 / 2,000 will misread headroom. Fix: label `Model calls today` and explain retries/fallbacks count.
3. **Unrelated content in the cap card.** Banned and unverified user links sit in the cap card's footer. Move them to
   the Users stat.
4. **Chart can't be read for magnitude.** No y-axis value, only the first date and "Today"; values only on mouse
   hover (`group-hover`), so keyboard and touch users get nothing; the data table is sr-only, so sighted keyboard users
   can't reach it either. Fix per 0.5.
5. **Unstated thresholds.** "Failed (x%)" turns amber at 10% with no explanation; it counts failed receipts, not
   failed calls, which hides retries that eventually succeeded. Show both with definitions.
6. **Stats are inconsistently linked.** Users/Workspaces tiles link; Receipts tiles don't. Link them to the Usage page.
7. **Hard-coded daily per-user model.** "Near the daily limit" and "Users at 80% of their plan's daily limit" break
   when limits become monthly per workspace.
8. Two meter components with different colour rules (admin red at 100%, customer amber).

### App home (`app/app/page.tsx` + `usage-meter.tsx` + `upload-panel.tsx`)

1. **Usage invisible on phones until it's too late.** The meter is desktop-sidebar only; the empty upload panel
   shows no allowance; the first hint at 390px is the queue footer after picking photos. Fix: usage strip in the
   upload card (1.1).
2. **"Today" is baked into ~6 strings** ("today", "a day", "Daily limit reached", "Receipts a day", "Receipts reset at
   00:00 UTC every day"). Fix: period copy table (0.1).
3. **Reset time is UTC-only** ("Resets at 00:00 UTC"), which an international user has to convert. Lead with relative
   time.
4. **Near-limit is a colour change in a sidebar** on desktop; nothing near the upload action says "2 left".
5. **Limit-reached has no path for a workspace member** (who to ask) and, later, none for an owner (upgrade). The
   service-wide pause title says "for today" while the period may differ; keep it day-specific but make the personal
   one period-aware.
6. **Results view says nothing about how a receipt was read** (no model, time or try number), so support questions
   like "why did this take 40 seconds?" can't be answered by the user or the owner without SQL. Fix: details line
   (1.3) and admin receipt detail (2.4).
7. Upload hint lists `JPEG, PNG, WebP or HEIC` while the server accepts PDF; update with the PDF track.

---

## 4. Accessibility notes (checklist for the PR)

- Meters: `role="meter"`, `aria-valuenow/min/max`, `aria-valuetext="{used} of {limit} receipts used {this period}"`;
  the numbers are always printed next to the bar; warning tone always has an icon and words.
- Charts: title with unit, visible "Show as table" `<details>` (real `<table>` with `<caption>`, `scope` on headers),
  focusable values or a link per day, tooltips appear on focus as well as hover, no information only in colour,
  hatched texture for cached tokens, `prefers-reduced-motion` respected.
- Numbers: `tabular-nums`, right-aligned, units always written (`s`, `ms`, `USD`, `tokens`); compact tokens carry
  the full number in sr text; "—" carries sr "Unknown".
- Range links: `aria-current="page"`, 44px min height on mobile, visible focus ring (`focus-visible:ring-2 ring-ring`,
  the existing pattern).
- Definitions reachable without hover (info icon is a button that opens the `Tooltip` on focus, plus the "How these
  are counted" disclosure).
- Contrast on `--card #141416` (computed): `--muted-foreground #9a9aa3` 6.59:1, `--warning #fbbf24` 11.02:1 (both
  AA for text); `--chart-1` 4.88:1 and `--chart-2` 5.00:1 (above the 3:1 needed for marks).
- 390px: no table on the page scrolls horizontally; every table has a card-list form below `md`.
- Live regions: Home strip `aria-live="polite"`; Usage page totals are static (no live region).

---

## 5. Owner decisions

1. **D1 Cost for customers**: off for everyone (recommended), or a per-workspace switch in admin that shows
   "Estimated cost" to that workspace's owner (for a future API/BYOK plan). Tokens never shown to customers either way.
2. **D2 Period**: daily per user (today) or monthly per workspace (CEO + market recommend monthly per workspace). The
   design works for both; the meter scope line and member table depend on it.
3. **D3 What counts**: a failed receipt that succeeds on retry counts once (recommended); re-reading a receipt that
   was already read (if ever offered) counts again or not.
4. **D4 Per-member visibility**: owner/admin see the member breakdown, members see only their own count
   (recommended), or everyone sees it.
5. **D5 Model name for customers**: show "Read by Gemini 3.8 Flash" in the details line (CEO review: yes, as a detail),
   or a generic "Read in 3.2 s" with no vendor name.
6. **D6 Admin access to receipt photos**: metadata only with an audited "Show photo" (recommended), or photos shown
   freely to admins.
7. **D7 Admin mobile nav with six items**: shorten labels, or fold Audit + Settings into "More".
8. **D8 New chart tokens** `--chart-1 #059669`, `--chart-2 #3b82f6` in `packages/ui` (validated), vs reusing
   `--primary`/`--info` (fails the dark lightness band).
9. **D9 Rollup trigger**: accept "raw queries until 2M rows or 500 ms p95", or build the daily rollup now.
