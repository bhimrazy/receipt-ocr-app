# Navigation redesign: Receipts, Spending and a slimmer Home (2026-11-13)

Status: spec, not built. Implements the navigation target the owner approved on 2026-11-12 (finding 4 of
`docs/reviews/2026-11-12-design-critique.md`, with findings 3 and 7 where they touch navigation). Written from the code
on `main` at `a911a84`; no screenshots were taken for it. Owner decisions recorded 2026-11-13 (end of file).

## Goal

People find their receipts under **Receipts**, their totals under **Spending**, and on Home only what needs them and
what happened lately. Nothing new is stored: Spending reuses `getSpendView()` and
`SpendDashboardView` as they are.

Out of scope: the list, row and header badges and BS/AD dates (PR #224 owns them), the phone filter sheet (finding 7),
group totals (finding 8), the Settings split (finding 9).

## Information architecture

| Section  | URL                    | Desktop sidebar       | Phone tab bar        | Notes                             |
| -------- | ---------------------- | --------------------- | -------------------- | --------------------------------- |
| Add      | `/app/upload`          | "Add receipts" button | Centre "Scan" button | URL unchanged (manifest, email)   |
| Home     | `/app`                 | Home                  | Home                 | Slimmed, see below                |
| Receipts | `/app/receipts`        | Receipts              | Receipts             | Today's History page, renamed     |
| Receipt  | `/app/receipts/[id]`   | (Receipts active)     | (Receipts active)    | Unchanged; Back says "Receipts"   |
| Groups   | `/app/receipts/groups` | (Receipts active)     | (Receipts active)    | No longer a top-level entry       |
| Spending | `/app/spending`        | Spending              | Spending             | New page; the dashboard from Home |
| Settings | `/app/settings/**`     | Settings              | Settings             | Gains a "Groups" row              |
| Admin    | `/admin`               | Under "Platform"      | Account sheet        | Unchanged                         |

`/app/receipts/groups` is a static segment, so Next resolves it before `[id]`; receipt ids are UUIDs and never collide.

### Desktop (1440; the sidebar starts at `md`)

```
+--------------------------+--------------------------------------------------------------+
| [R] Receipt OCR          |  Home                                                        |
| [Workspace v]            |                                                              |
|                          |  +- To check ------------- 312 receipts -+ +- Add receipts -+|
| [ + Add receipts      ]  |  | ! Needs review                    4 > | |  Drop photos   ||
|                          |  | x Couldn't scan                   1 > | |  or PDFs here  ||
|  Home          <- active |  +---------------------------------------+ |  [Choose files]||
|  Receipts                |                                            +----------------+|
|  Spending                |  Recent receipts            All receipts > +- This month ---+|
|  Settings                |  +---------------------------------------+ | GBP 482.10     ||
|                          |  | Merchant A      12 Nov     GBP 12.40  | | +8% vs October ||
|  PLATFORM                |  | ... 6 rows                            | | See spending > ||
|  Admin                   |  +---------------------------------------+ +----------------+|
|  [usage meter]           |                                                              |
+--------------------------+--------------------------------------------------------------+
```

### Phone (390)

```
+--------------------------------+      +--------------------------------+
| [R]   Workspace          (o)   |      | < Receipts   Groups        (o) |
+--------------------------------+      +--------------------------------+
| Home                           |      | Groups                         |
| +- To check ---- 312 total --+ |      | Collect receipts for a trip... |
| | ! Needs review         4 > | |      | +----------------------------+ |
| | x Couldn't scan        1 > | |      | | Trip 2026        12 recei. | |
| +----------------------------+ |      | +----------------------------+ |
| +- This month ---------------+ |      |                                |
| | GBP 482.10   +8% vs Oct    | |      |                                |
| | See spending >             | |      |                                |
| +----------------------------+ |      |                                |
| Recent receipts  All receipts> |      |                                |
| | Merchant A    GBP 12.40    | |      |                                |
+--------------------------------+      +--------------------------------+
|Home Receipts (Scan) Spend Sett.|
+--------------------------------+
```

Tab bar: Home · Receipts · Scan (raised, centre) · Spending · Settings, five slots of 78 px by 64 px at 390. Groups
leaves the bar. Admin stays in the account sheet.

## Route changes (no redirects)

Decided 2026-11-13: there are no users yet, so the old URLs are removed outright. No `next.config.ts` redirects and no
forwarding of old `/app?range=…` dashboard links. `/app/history` and `/app/groups` return the app's 404 after PR 1, and
`/app?range=…` simply shows Home after PR 4. Old bookmarks, sign-in `?redirect=` links and installed-PWA shortcuts
("History", `/app/history`) break until the browser refreshes the manifest, which can take days. This is accepted
before launch.

| Old URL                 | New URL                | Done in |
| ----------------------- | ---------------------- | ------- |
| `/app/history`          | `/app/receipts`        | PR 1    |
| `/app/groups`           | `/app/receipts/groups` | PR 1    |
| `/app?range=…` (and co) | `/app/spending?…`      | PR 3    |

So each build PR updates every internal reference in the same change:

- Nav and links: `app-nav.tsx` (`APP_NAV`, `isActive`, `backFor`, `labelFor`), `historyHref`/`exportHref`
  (`components/history/history-href.ts`), `groups/hrefs.ts`, the ToCheck and Recent links on Home,
  `receipt-actions.tsx`, `receipt-result.tsx`, `upload-panel.tsx`, `dashboard/empty-states.tsx`, `group-filter.tsx`.
- `components/dashboard/links.ts`: rename `homeHref` to `spendingHref` and point it at `/app/spending` (PR 3).
- `app/manifest.ts`: the shortcut becomes "Receipts", `/app/receipts`. The share target (`/share-target`, sending to
  `/app/upload?shared=1` in `public/sw.js`) and the email templates (`/app/upload`) don't name the old paths; check
  again in the PR.
- `logPageRender` route names and the `/app/groups/:id` pattern in `lib/telemetry/scrub.ts`. Old route names stop
  appearing in telemetry; say so in the PR.
- Tests: the e2e specs (`smoke`, `mobile-nav`, `app-shell-phone`, `groups`, `history-bulk`, `pwa`, `seo`, `upgrade`,
  `receipt-review`) and unit tests (`app-nav`, `list-view`, `receipts`, `proxy`, `redirect`, `pwa`, `use-online`,
  `empty-states`; the last few use the path only as sample input but should match the app).
- Living docs: `docs/architecture/web.md` and `docs/STATUS.md`. Dated plans and reviews stay as written.
- PR checklist: these must print nothing, the first from PR 1 on and the second from PR 3 on.

  ```bash
  git grep -nE '/app/(history|groups)' -- apps packages docs/architecture docs/STATUS.md
  git grep -nE 'homeHref|"/app\?' -- apps/web
  ```

## Navigation components (`components/app-nav.tsx`)

- `APP_NAV`: Home (`House`), Receipts (`ReceiptText`), Spending (`ChartNoAxesColumn`), Settings (`Settings`). Groups is
  removed. Remove the `MOBILE_TABS` "three" layout and `mobile-tabs.ts`: the owner chose five tabs, and the switch
  doubles every branch in `isActive` and `backFor`.
- `isActive`: Receipts owns `/app/receipts` and everything under it (receipt pages and Groups).
- `backFor`: `/app/receipts/groups` and `/app/receipts/[id]` go back to `{ href: "/app/receipts", label: "Receipts" }`.
  `labelFor` gains Receipts, Spending and Groups, so Back from a receipt opened on Spending says "Spending".
- **Add receipts** (desktop): a `buttonVariants({ variant: "default" })` link with the `Plus` icon, full sidebar width,
  `h-10`, placed between the workspace switcher and the Main `nav` (outside the `nav`'s list, so the list stays pure
  navigation). It links to `/app/upload` without `capture=1`. On `/app/upload` it gets `aria-current="page"` and keeps
  its look; no sidebar row is highlighted there.
- The phone centre button is unchanged: label "Scan", `SCAN_HREF`.

## Pages

### Home (`/app`) keeps and drops

Keeps: the title ("Home", or "Scan your first receipt" when empty), To check (as PR #224 words it), the upgrade card,
Recent receipts (6 rows), How it works for an empty workspace. Adds: a **This month** card. Desktop only (`md` and up):
the upload panel in the right column.

Drops: the two-sentence description (only an empty workspace keeps one line), the range and currency controls, the KPI
tiles, Spend over time, Last 12 months, By category, Top merchants, Largest receipts, By day of the week. All move to
Spending unchanged.

- Order on desktop: left column To check, then Recent receipts; right column (22rem) upload panel, then This month.
  Phone: To check, This month, Recent receipts. The upload panel is hidden below `md` (the Scan tab replaces it); in an
  empty workspace it shows on phones too, because it is the page's only action.
- **This month** is the existing `ThisMonthCard` (exported from `spend-dashboard.tsx`) for the most-used currency, with
  a footer link "See spending" to `/app/spending`. With more than one currency the footer reads "See spending (3
  currencies)". It still costs one `getSpendView()` read, as Home does today; a lighter query is a follow-up only if
  `home` render time says so.
- Hidden when nothing has been scanned yet (`read <= 0`); To check already says what is scanning or failed.

### Receipts (`/app/receipts`)

Today's `app/app/history/page.tsx`, moved. Changes: title and metadata "Receipts"; the summary stays "{n} receipts in
this workspace". The "Manage groups" link in `group-filter.tsx` points to `/app/receipts/groups`. Toolbar, table,
selection bar, sort, page size and badges are untouched (#219, #224). Rename the `components/history/` folder in a
later refactor, not here, so #224 rebases cleanly.

### Groups (`/app/receipts/groups`)

The current page, moved, with the same title and description. On desktop, above the title, a ghost link
"`<` Receipts" (`buttonVariants({ variant: "ghost", size: "sm" })`) because the sidebar no longer names Groups. On
phones the app bar's Back does this. Settings gains a row "Groups" ("Collect receipts by trip, client or year") under
Workspace, linking here.

### Spending (`/app/spending`)

First version: exactly the dashboard Home shows today (`SpendDashboardView` with `getSpendView(searchParams)`), now
with an `h1` "Spending" in a `PageHeader` instead of the section's `h2`, and the existing explanatory line as the page
description. Controls (range, compare, currency) stay in the URL. Slices still link to Receipts filtered by date,
category or merchant. No new query, column or chart.

## States

| Page / part | Loading                                           | Empty                                                                                  | Error                                      |
| ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| Home        | `PanelSkeleton`, `RowsSkeleton rows={6}`          | How it works + upload panel (all widths)                                               | `SectionBoundary` per section, as today    |
| This month  | `Skeleton h-36 rounded-lg`                        | Hidden until a receipt is scanned                                                      | Card hidden; logged as `home.spend_failed` |
| Receipts    | as History today (`loading.tsx` moves)            | as History today                                                                       | as History today                           |
| Groups      | as today (`loading.tsx` moves)                    | as today                                                                               | as today                                   |
| Spending    | `SpendSkeleton` moves into `spending/loading.tsx` | No receipts: card below. None scanned: `NoReadReceipts`. Range empty: `NothingInRange` | Card below, `role="status"`                |

## Copy

| Where                          | Copy                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| Sidebar and tab labels         | Home · Receipts · Spending · Settings                                              |
| Sidebar button                 | Add receipts                                                                       |
| Phone centre button            | Scan                                                                               |
| Upload page title / metadata   | Add receipts / "Add receipts"                                                      |
| Receipts title / metadata      | Receipts                                                                           |
| Back labels                    | Receipts · Spending · Groups · Home · Settings                                     |
| Home description (empty only)  | Add a photo of a receipt and we scan the merchant, date, items and total.          |
| Home "This month" link         | See spending                                                                       |
| Home "Recent receipts" link    | All receipts (unchanged)                                                           |
| Spending title / metadata      | Spending                                                                           |
| Spending description           | Scanned receipts by the date printed on them. (+ the existing multi-currency line) |
| Spending, no receipts: heading | No spending yet                                                                    |
| Spending, no receipts: body    | Totals by month, category and merchant show here once a receipt has been scanned.  |
| Spending, no receipts: button  | Add receipts (desktop) / Scan a receipt (phone), to `/app/upload`                  |
| Spending, load failed          | Spending totals couldn't load just now. Reload the page to try again. (unchanged)  |
| Groups back link (desktop)     | Receipts                                                                           |
| Settings row                   | Groups · Collect receipts by trip, client or year                                  |
| PWA shortcut                   | Receipts · "Your scanned receipts"                                                 |

"Scan" (phone) and "Add receipts" (desktop) name the same action on purpose: a phone opens the camera, a desktop
picks files. Status text stays "Scanning".

## Keyboard and screen reader

- Tab order in the sidebar: brand, workspace switcher, Add receipts, Main nav (Home … Settings), Platform nav, meter.
  The skip link still jumps to `#main-content`.
- Exactly one `aria-current="page"` per nav: Receipts while on a receipt or Groups; none on `/app/upload` except the
  Add receipts button.
- Every route sets `metadata.title` (Home, Receipts, Groups, Spending, Add receipts), which the Next route announcer
  reads on navigation. Each page has one `h1`; Spending's sections stay `h2`.
- Focus rings: `focus-visible:ring-2 ring-ring` on the new button and the Groups back link, matching `SidebarNav`.
- Tap targets: tabs 78×64 px at 390; the Groups back link and "See spending" use `max-md:min-h-11`.
- Contrast: the button uses `bg-primary text-primary-foreground`, already AA in both themes. Check light mode on the
  sidebar's `bg-sidebar`.

## Build: PRs that merge independently

Each PR is screenshot at 390 (light, dark) and 1440 (where it differs), and leaves no link to a removed URL.

1. **Rename History to Receipts and move Groups under it** (S–M). Move `history/` to `receipts/page.tsx` and `groups/`
   to `receipts/groups/`; `APP_NAV` without Groups (Home, Receipts, Settings; still four slots
   with Scan); remove the "three" layout; `isActive`, `backFor`, `labelFor`; every reference in the list above, then the grep check;
   Settings "Groups" row; Groups back link. Rebase after #224 merges, since both touch
   `history-results.tsx`, `mobile-nav.spec.ts` and `receipt-review.spec.ts`.
2. **Add receipts in the sidebar, one verb** (S). The sidebar button; upload page title "Add receipts". Independent
   of 1.
3. **Spending page** (M, after 1, which frees the tab slot). `app/app/spending/{page,loading}.tsx`, `spendingHref`,
   the no-receipts empty state, and Spending in `APP_NAV` (five slots with Scan). Home
   still shows its dashboard until PR 4, so Spending can ship and be checked on its own.
4. **Slim Home** (M, after 3). Remove the dashboard from Home, add the This month card and the two-column layout, hide
   the upload panel below `md` in a non-empty workspace, one-line empty-state description. Touches `app/app/page.tsx`,
   so it rebases after #224 (ToCheck copy).

## Decided (owner, 2026-11-13)

1. **Desktop Home keeps a compact upload panel** beside the sidebar button: dragging files onto Home is the fastest
   desktop path, and the panel carries the at-limit and upgrade state. Hidden below `md`.
2. **Groups lives at `/app/receipts/groups`**, so the URL matches where the nav puts it.
3. **No redirects.** There are no users yet, so `/app/history` and `/app/groups` are dropped outright and every internal
   reference moves with them (see "Route changes").
4. **Spending v1 is the existing dashboard, moved unchanged.** Whether to cut "By day of the week" is a later call.

No open owner decisions remain for this spec.
