# apps/web

The Next.js App Router app: every page, every HTTP endpoint, the Better Auth configuration and the admin panel. It is
the only process that runs. Receipt logic is not here; it lives in [packages/core](core.md), and this app adapts it to
HTTP.

## Contents

- [Layout of the app](#layout-of-the-app)
- [Navigation](#navigation)
- [Public API](#public-api)
- [How a request reaches core](#how-a-request-reaches-core)
- [Key modules](#key-modules)
- [Consent and analytics](#consent-and-analytics)
- [Design principles and invariants](#design-principles-and-invariants)
- [How to test it](#how-to-test-it)
- [Common changes](#common-changes)

## Layout of the app

| Path                                                                                                                                                                                               | What is there                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`app/page.tsx`](../../apps/web/app/page.tsx)                                                                                                                                                      | Landing page                                                                                                                                                                                                         |
| `app/sign-in`, `sign-up`, `forgot-password`, `reset-password`                                                                                                                                      | Auth pages; forms in [`components/auth`](../../apps/web/components/auth)                                                                                                                                             |
| [`app/accept-invitation/[id]`](../../apps/web/app/accept-invitation/[id]/page.tsx)                                                                                                                 | Invitation landing page                                                                                                                                                                                              |
| [`app/app`](../../apps/web/app/app)                                                                                                                                                                | Signed-in app: Home with upload panel (`/app`), History, receipt detail, Groups, Settings, Members                                                                                                                   |
| [`app/admin`](../../apps/web/app/admin)                                                                                                                                                            | Platform admin panel: overview, users, workspaces, operations, jobs, audit log, settings                                                                                                                             |
| [`app/api`](../../apps/web/app/api)                                                                                                                                                                | Route handlers (below)                                                                                                                                                                                               |
| `app/(lab)`, `components/marketing`                                                                                                                                                                | Landing-page design experiments, `noindex`, shown only in development or when the build sets `LAB_PAGES=1` (read at build time, the pages are prerendered). Pending removal (see [STATUS](../STATUS.md))             |
| [`lib`](../../apps/web/lib)                                                                                                                                                                        | Server helpers: auth, session, HTTP adapter, env, logging                                                                                                                                                            |
| [`proxy.ts`](../../apps/web/proxy.ts)                                                                                                                                                              | Next.js proxy (formerly middleware): optimistic cookie check for `/app` and `/admin`, and the `signed_in_hint` cookie                                                                                                |
| `loading.tsx` in [`app/app`](../../apps/web/app/app/loading.tsx), [`app/app/receipts/[id]`](../../apps/web/app/app/receipts/[id]/loading.tsx), [`app/admin`](../../apps/web/app/admin/loading.tsx) | Skeletons streamed while a page's data loads. Data helpers (`getSession`, `getActiveScope`, `getCurrentPlan`, `getUsageSummary`) are wrapped in React `cache()`, so the layout and page share one lookup per request |
| [`app/global-error.tsx`](../../apps/web/app/global-error.tsx)                                                                                                                                      | Last-resort error page for failures in the root layout; brings its own `<html>` and logs `app.global_error`                                                                                                          |
| [`drizzle`](../../apps/web/drizzle)                                                                                                                                                                | SQL migrations, generated from [packages/db](db.md)                                                                                                                                                                  |
| [`e2e`](../../apps/web/e2e)                                                                                                                                                                        | Playwright suite                                                                                                                                                                                                     |

The upload panel lives on Home (`/app`) and on `/app/upload`, which the Scan tab and the home-screen shortcut (`?capture=1`
opens the camera on each visit, then is dropped from the URL with `history.replaceState`) and the share target (`?shared=1`) land on. Capture, review and upload in the browser are described in
[Upload, extraction and result](flows/upload-and-extraction.md#1-in-the-browser):

```mermaid
flowchart LR
  camera[Camera sheet] --> review[Review sheet]
  picker[Picker or drop] --> review
  review --> encode["Canvas JPEG,<br/>then prepareFile"]
  encode --> queue["Batch queue (2 at a time)"]
  queue --> api["POST /api/receipts"]
```

## Navigation

The signed-in shell ([`app/app/layout.tsx`](../../apps/web/app/app/layout.tsx)) has two arrangements, switched at the
`md` breakpoint (768 px) with CSS only, so the server renders both and nothing depends on JavaScript to pick one.

```mermaid
flowchart TB
  subgraph desktop["md and wider"]
    sidebar["Sidebar: brand, workspace switcher (dropdown),<br/>Home / History / Settings, Platform: Admin,<br/>usage meter, account menu (dropdown)"]
  end
  subgraph phone["Below md"]
    bar["Top app bar (sticky): brand or Back, workspace name or<br/>scrolled page title, page actions slot, account button"]
    sheet["Account sheet: account, workspaces (switch, create),<br/>usage meter, Admin, sign out"]
    tabs["Bottom tab bar (fixed): Home, History, Scan, Settings"]
    bar -- "account button" --> sheet
  end
  tabs -- "Scan" --> scan["/app/upload?capture=1"]
```

| Piece                                        | Where                                                                                  | Notes                                                                                                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppSidebarNav`, `SidebarNav`                | [`components/app-nav.tsx`](../../apps/web/components/app-nav.tsx)                      | `aria-current="page"` on the active link. A receipt page counts as History. Admin sits in its own "Platform" group                                                                                                                           |
| `AppTabBar`, `BottomTabBar`                  | same                                                                                   | 4rem tall (`--tabbar-h`) plus `env(safe-area-inset-bottom)`; `--app-bottom-inset` is the total, set in [`styles.css`](../../packages/ui/src/styles.css) only while a tab bar is on the page. `<main>` and toasts clear it with that variable |
| `MobileTopBar`                               | same                                                                                   | Back on detail pages (`backFor(pathname)`): returns with `router.back()` when the previous page was the parent list, so filters and scroll survive, else links to it. Shows the page `<h1>` text once it scrolls under the bar               |
| `AppBarActions`                              | same                                                                                   | Portals a page's own phone actions into the app bar (the receipt page's "Receipt actions" sheet)                                                                                                                                             |
| `UserMenu` (desktop), `AccountSheet` (phone) | [`components/user-menu.tsx`](../../apps/web/components/user-menu.tsx)                  | The sheet holds `WorkspaceList` from [`workspace-switcher.tsx`](../../apps/web/components/workspace-switcher.tsx); `CreateWorkspaceDialog` is outside the sheet so closing it doesn't unmount the form                                       |
| `Drawer`                                     | [`packages/ui/src/components/drawer.tsx`](../../packages/ui/src/components/drawer.tsx) | Bottom sheet on Base UI's Drawer: swipe down, Escape or a tap outside closes it. `DrawerAction` is a 48 px row                                                                                                                               |

The admin shell ([`app/admin/layout.tsx`](../../apps/web/app/admin/layout.tsx)) uses the same pieces with its own five
tabs and no Scan action, and keeps "App" in the top bar.

Phone details: `touch-action: manipulation` on `<html>` (no double-tap delay), and in standalone (installed) mode
`overscroll-behavior-y: none`, so there is no rubber band or pull-to-refresh.

## Public API

### Route handlers

| Method and path                              | File                                                                                        | Does                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET, POST /api/auth/*`                      | [`api/auth/[...all]/route.ts`](../../apps/web/app/api/auth/[...all]/route.ts)               | Better Auth. `503` when auth is not configured.                                                       |
| `POST /api/receipts`                         | [`api/receipts/route.ts`](../../apps/web/app/api/receipts/route.ts)                         | Upload one file. `mode=instant` reads it in the request; `mode=queued` returns `202`.                 |
| `GET /api/receipts/status`                   | [`api/receipts/status/route.ts`](../../apps/web/app/api/receipts/status/route.ts)           | Workspace receipt counts, so list pollers refresh only when something changed                         |
| `GET /api/receipts/:id`                      | [`api/receipts/[id]/route.ts`](../../apps/web/app/api/receipts/[id]/route.ts)               | Status for the polling client; drains the receipt's job if it is due and not running                  |
| `PATCH /api/receipts/:id`                    | same file                                                                                   | User corrections to merchant, date, category, currency and amounts                                    |
| `DELETE /api/receipts/:id`                   | same file                                                                                   | Delete the row, then the stored file                                                                  |
| `POST /api/receipts/:id/retry`               | [`api/receipts/[id]/retry/route.ts`](../../apps/web/app/api/receipts/[id]/retry/route.ts)   | Claim a failed receipt for another round and enqueue its job; `202`, then drain in `after()`          |
| `GET /api/receipts/export`                   | [`api/receipts/export/route.ts`](../../apps/web/app/api/receipts/export/route.ts)           | CSV with the History filters (including `?group=`), up to 5,000 rows, with a `groups` column          |
| `GET, POST /api/groups`                      | [`api/groups/route.ts`](../../apps/web/app/api/groups/route.ts)                             | List the workspace's groups with counts; create one (`{ name, color }`, `201`)                        |
| `PATCH, DELETE /api/groups/:id`              | [`api/groups/[id]/route.ts`](../../apps/web/app/api/groups/[id]/route.ts)                   | Rename or recolour; delete (receipts are kept). Creator, owner or admin, else `403`                   |
| `POST, DELETE /api/groups/:id/receipts`      | [`api/groups/[id]/receipts/route.ts`](../../apps/web/app/api/groups/[id]/receipts/route.ts) | Bulk add or remove `{ receiptIds }` (1 to 100); returns `changed`, `unchanged`, `atLimit`, `notFound` |
| `GET, POST, DELETE /api/receipts/:id/groups` | [`api/receipts/[id]/groups/route.ts`](../../apps/web/app/api/receipts/[id]/groups/route.ts) | A receipt's groups; add to or remove from one group (`{ groupId }`)                                   |
| `POST /api/contact`                          | [`api/contact/route.ts`](../../apps/web/app/api/contact/route.ts)                           | Support form: origin check, honeypot, per-IP rate limit, mail to `SUPPORT_EMAIL`                      |

Status codes come from one table in [`lib/http.ts`](../../apps/web/lib/http.ts):

| Core error      | HTTP | Message shown                          |
| --------------- | ---- | -------------------------------------- |
| `InvalidInput`  | 400  | The error's own message                |
| `NotFound`      | 404  | The error's own message                |
| `Forbidden`     | 403  | The error's own message                |
| `Conflict`      | 409  | The error's own message                |
| `QuotaExceeded` | 429  | The error's own message, `Retry-After` |
| `NotConfigured` | 503  | "This feature is not configured…"      |
| `DbError`       | 500  | Generic                                |
| `StorageError`  | 502  | Generic                                |
| `OcrError`      | 502  | Generic                                |

### Server actions

- [`app/admin/actions.ts`](../../apps/web/app/admin/actions.ts): every admin mutation. See
  [Admin actions](flows/admin-actions.md).
- [`lib/impersonation-actions.ts`](../../apps/web/lib/impersonation-actions.ts): stop impersonating.

Customer-side workspace changes (create, switch, invite, change a member's role, remove a member, cancel an invite)
call Better Auth's organization endpoints from the browser through
[`lib/auth-client.ts`](../../apps/web/lib/auth-client.ts); Better Auth checks the caller's workspace role.

## How a request reaches core

```mermaid
sequenceDiagram
  participant B as Browser
  participant P as proxy.ts
  participant R as Route handler
  participant S as lib/session.ts
  participant RT as runtime (ManagedRuntime)
  participant C as packages/core

  B->>P: request to /app or /admin
  P-->>B: redirect to /sign-in if no session cookie
  B->>R: POST /api/receipts
  R->>R: crossOriginResponse (Origin must be the app)
  R->>S: getSession(), getActiveScope()
  S->>RT: resolveScope(userId, preferred workspace)
  RT->>C: query member
  C-->>R: scope { organizationId, userId, role }
  R->>RT: runRoute(program)
  RT->>C: run Effect program with AppLayer
  C-->>R: Exit (value or typed error)
  R-->>B: JSON, status from the error table
```

- [`proxy.ts`](../../apps/web/proxy.ts) only checks that a session cookie exists; it does not touch the database.
  API routes are not matched by it and check the session themselves. On a guarded path with a session cookie it also
  sets `signed_in_hint=1`, a non-HttpOnly cookie that lets the static landing page show "Open the app" without a
  session fetch; it deletes the hint when it redirects to sign-in, and `signOutAndClearHint` in
  [`lib/auth-client.ts`](../../apps/web/lib/auth-client.ts) clears it on sign-out. The hint only picks a button.
- [`lib/session.ts`](../../apps/web/lib/session.ts) always reads the session row (the cookie cache is off in
  [`lib/auth.ts`](../../apps/web/lib/auth.ts), and reads also pass `disableCookieCache: true`), so a ban or a revoked
  session applies on the next request. `getSession` and `getActiveScope` are wrapped in React `cache`, so a
  request does each lookup once.
- [`lib/runtime.ts`](../../apps/web/lib/runtime.ts) builds one `ManagedRuntime` from core's `AppLayer` per server
  process. The database pool and the settings cache live in it.
- [`runRoute`](../../apps/web/lib/http.ts) runs the program and maps failures. Work after the response runs the
  [job queue](flows/jobs.md) through [`lib/jobs.ts`](../../apps/web/lib/jobs.ts) (`runJobNow`, `drainJobs`), which
  logs one `job.attempt` event per attempt and a `job.tick` per drain.

Pages follow the same path without the HTTP mapping: server components call helpers in
[`lib/receipts.ts`](../../apps/web/lib/receipts.ts), which call `requireActiveScope()` and then `runtime.runPromise`.

## Key modules

| Module                                                                                | Purpose                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`lib/auth.ts`](../../apps/web/lib/auth.ts)                                           | Better Auth config: email/password, OAuth, organization and admin plugins, rate limits, hooks that create the personal workspace                                                                                                                                                                                            |
| [`lib/auth-guards.ts`](../../apps/web/lib/auth-guards.ts)                             | Organization hooks: workspace-name rules, 10 invitations per inviter per hour, and `assertWorkspaceRole` (a role must be exactly `owner`, `admin` or `member`; GHSA-c85h) on invite, accept, add member and role change                                                                                                     |
| [`lib/session.ts`](../../apps/web/lib/session.ts)                                     | `getSession`, `requireSession`, `requireAdmin`, `getActiveScope`, `requireActiveScope`                                                                                                                                                                                                                                      |
| [`lib/http.ts`](../../apps/web/lib/http.ts)                                           | `runRoute`, `runBackground`, error-to-status table, origin check, client IP, capped multipart reader                                                                                                                                                                                                                        |
| [`lib/env.ts`](../../apps/web/lib/env.ts)                                             | Auth, email and proxy env parsing. Throws at boot on bad production config, loaded by [`instrumentation-node.ts`](../../apps/web/instrumentation-node.ts)                                                                                                                                                                   |
| [`instrumentation.ts`](../../apps/web/instrumentation.ts)                             | `register()` loads the env check on the Node runtime; `onRequestError` logs render, route and action failures as `request.error` (message and digest only)                                                                                                                                                                  |
| [`lib/quota.ts`](../../apps/web/lib/quota.ts)                                         | `enforceUploadQuota` (early, read-only check) and the usage meter summary                                                                                                                                                                                                                                                   |
| [`lib/plan-limits.ts`](../../apps/web/lib/plan-limits.ts)                             | Plan table from Settings (3 s timeout, defaults on error), current user's plan, revalidating pages that print limits                                                                                                                                                                                                        |
| [`lib/receipts.ts`](../../apps/web/lib/receipts.ts)                                   | History list, filters from URL params, counts, export rows, receipt with signed image URL                                                                                                                                                                                                                                   |
| [`lib/upload-prep.ts`](../../apps/web/lib/upload-prep.ts)                             | Browser side: orient, size to a ~3 MP budget (short edge kept at 1,000 px or more) and re-encode images as JPEG near 500 KB before upload                                                                                                                                                                                   |
| [`lib/log.ts`](../../apps/web/lib/log.ts)                                             | One JSON wide event per request on stdout                                                                                                                                                                                                                                                                                   |
| [`lib/json-body.ts`](../../apps/web/lib/json-body.ts)                                 | Size-capped JSON body read and Zod validation for the group routes; `400` or `413` on bad input                                                                                                                                                                                                                             |
| [`components/groups`](../../apps/web/components/groups)                               | Group chips, the searchable picker (popover from md, bottom sheet below), History filter chips and selection mode, the `/app/groups` manager                                                                                                                                                                                |
| [`lib/csv.ts`](../../apps/web/lib/csv.ts)                                             | CSV export with formula-injection escaping                                                                                                                                                                                                                                                                                  |
| [`components/upload-panel.tsx`](../../apps/web/components/upload-panel.tsx)           | Picks files or opens the camera, sends photos to review, uploads the batch two at a time with progress and retry, up to the plan's `batchMax`                                                                                                                                                                               |
| [`components/capture`](../../apps/web/components/capture)                             | Camera sheet and review sheet (corner crop, rotate, filters), loaded with `next/dynamic` on first use                                                                                                                                                                                                                       |
| [`lib/capture`](../../apps/web/lib/capture)                                           | Pure maths for capture: homography and warp, edit state, edge detection, filters, the batch queue; plus the camera, canvas and XHR upload helpers                                                                                                                                                                           |
| [`components/processing-poller.tsx`](../../apps/web/components/processing-poller.tsx) | Polls one receipt's status, or the workspace counts (`/api/receipts/status`) for a list, on the schedule in [`lib/backoff-poll.ts`](../../apps/web/lib/backoff-poll.ts): backs off from 2 s to 15 s, pauses while the tab is hidden, gives up after 6 minutes of visible polling (a receipt job's retries can take about 4) |
| [`lib/consent`](../../apps/web/lib/consent)                                           | Cookie consent and analytics rules, cookie registry; see [Consent and analytics](#consent-and-analytics)                                                                                                                                                                                                                    |
| [`lib/signed-in-hint.ts`](../../apps/web/lib/signed-in-hint.ts)                       | The `signed_in_hint` cookie name and browser helpers to read and clear it                                                                                                                                                                                                                                                   |
| [`components/dashboard/`](../../apps/web/components/dashboard)                        | Home `Spending` section: streamed in Suspense and loaded once per request. Range, compare and currency live in the URL. Recharts (shadcn `ChartContainer`) sits in a lazy chunk that loads when a chart nears the viewport; each chart has a text summary and a table view                                                  |

## Consent and analytics

Analytics runs on an allowlist of public pages only (`isAnalyticsPath` in
[`lib/consent/config.ts`](../../apps/web/lib/consent/config.ts): `/`, `/sign-in`, `/sign-up`, `/privacy`, `/terms`,
`/cookies`). `/app` and `/admin` URLs and titles carry receipt and workspace ids, so nothing runs there.

| Tool                 | When it runs                                           | Consent                                          |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| Vercel Web Analytics | Vercel builds (`VERCEL=1`), allowlisted pages          | Opt-out; with GA configured, only after a choice |
| Google Analytics 4   | `NEXT_PUBLIC_GA_MEASUREMENT_ID` set, allowlisted pages | Opt-in; Consent Mode v2, basic mode              |
| Browser signals      | GPC and DNT turn both GA and page counts off           | Can't be overridden in the dialog                |

```mermaid
flowchart TD
  L[Root layout] --> M[ConsentManager]
  M --> S[(consent cookie)]
  M -->|GA set, no choice, no GPC or DNT, public page| B[Banner: Accept all, Reject all, Customise]
  B --> D[Cookie settings dialog]
  F[Footer: Cookie settings] --> D
  B -->|choice| W[saveConsent]
  D -->|choice| W
  W --> S
  W -->|POST /api/consent, same origin| R[Route sets the same cookie server-side]
  M -->|allowed + public page| G[gtag.js, page views with stripped URL]
  M -->|allowed + public page| V[Vercel Analytics, beforeSend strips query, drops non-public]
```

- **Referrer.** Allowlisted pages send `Referrer-Policy: origin` (`next.config.ts`), so the same-origin `/view` fetch and Google never see a path or query. gtag's `page_location` and `page_referrer` are set in `config` and `set` so its automatic hits are stripped too. Withdrawing deletes `_ga*` in `saveConsent` even when gtag never loaded.
- **Choice.** The `consent` cookie holds version, timestamp and one flag per category (6 months, `SameSite=Lax`,
  `Secure` on HTTPS). A different `CONSENT_VERSION` or an older timestamp means no choice, so the banner asks again.
  [`lib/consent/state.ts`](../../apps/web/lib/consent/state.ts) holds the pure rules;
  [`lib/consent/store.ts`](../../apps/web/lib/consent/store.ts) is the browser store. `POST /api/consent` re-sets the
  cookie from the server because Safari caps script-written cookies at 7 days.
- **GA.** [`lib/consent/gtag.ts`](../../apps/web/lib/consent/gtag.ts) queues `consent default` (all four signals
  denied) before `config`, then grants only `analytics_storage`. `send_page_view` is off and page views carry
  `origin + pathname`. gtag.js can't be unloaded, so `ga-disable-<id>` is set during render whenever the page leaves
  the allowlist or consent is withdrawn. Withdrawing also deletes the `_ga*` cookies.
- **Cookie list.** [`lib/consent/cookies.ts`](../../apps/web/lib/consent/cookies.ts) lists every cookie and storage
  key; `/cookies` renders it, and `cookies.test.ts` scans the code for cookie, `localStorage`, Cache Storage and
  IndexedDB names that have no entry.
- **CSP.** `buildContentSecurityPolicy` adds Google's origins only when GA is on. Vercel's script is same-origin.

## Design principles and invariants

- **Thin adapters.** A route handler checks origin, session and input shape, then runs one core program. If a
  handler grows a loop or a transaction, that code belongs in core.
- **Mutations require the app's own `Origin`.** `crossOriginResponse` refuses a POST, PATCH or DELETE whose `Origin`
  is not `BETTER_AUTH_URL`, including one with no `Origin`.
- **The scope comes from `member`, not the session.** `session.activeOrganizationId` is only a preference, because
  Better Auth leaves it set on a removed member's other sessions.
- **The client is never trusted for roles.** Admin pages call `requireAdmin()` (a non-admin gets a 404); every admin
  action calls it again. Hiding a button in the UI ([`receipt-permissions.ts`](../../apps/web/lib/receipt-permissions.ts)) is
  convenience only; core enforces edit and delete rights.
- **Safe messages only.** Only `InvalidInput`, `NotFound`, `Conflict` and `QuotaExceeded` messages reach the browser.
  The log gets the error's tag, kind, class and SQLSTATE (`errorFields`), never its message.
- **One wide event per request.** Every route handler is wrapped in `withRequestEvent`
  ([`lib/http.ts`](../../apps/web/lib/http.ts)) and every `/app` and `/admin` page calls `logPageRender`; each writes
  one event through the schema allowlist. Requests made while impersonating carry `impersonated_by`. See
  [Observability](flows/observability.md).
- **Bodies are capped while streaming.** `readFormData` refuses a declared or streamed body over 10 MB plus 64 KB.
- **Degrades without config.** With no `DATABASE_URL` or auth secret, `authEnabled` is false, auth endpoints return
  `503` and the auth pages show a "not configured" card. In production off Vercel, the app refuses to start without
  `TRUSTED_IP_HEADERS`, because rate limits would otherwise share one bucket.

Security headers (HSTS, `X-Frame-Options: DENY`, a report-only CSP) are set in
[`next.config.ts`](../../apps/web/next.config.ts).

## How to test it

| What                                      | Command                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| Unit tests (all `*.test.ts`, Node, no DB) | `bun run test`                                                              |
| Better Auth against a real database       | `bun run --filter @receipt-ocr/web test:int` (needs `DATABASE_URL`)         |
| Playwright e2e against a built app        | `scripts/test.sh` (starts Postgres and RustFS, fresh database, fixture OCR) |
| Consent flow with GA configured           | `scripts/test.sh --analytics` (rebuilds with a test id; Google is stubbed)  |
| Type check                                | `bun run typecheck`                                                         |

The e2e specs ([`e2e/`](../../apps/web/e2e)) cover auth, upload, admin, smoke pages and security checks.
`capture.spec.ts` runs in its own `mobile-camera` project (390x844 Chromium with a fake camera). They run with
`OCR_PROVIDER=fixture`, so no model is called.

## Common changes

### Add an API route

1. Put the workflow in core as an Effect program returning typed errors from
   [`errors.ts`](../../packages/core/src/errors.ts).
2. In the handler: `crossOriginResponse` for mutations, `getActiveScope()` (or `getSession()`), validate the input,
   then `return runRoute(program, onSuccess)`.
3. Add a unit test for any pure parsing, and an e2e test if it changes what a user sees.

### Add an admin action

See [Admin actions](flows/admin-actions.md#add-an-admin-action).

### Add an environment variable

1. Read it where it is used: Effect `Config` in core, or [`lib/env.ts`](../../apps/web/lib/env.ts) for auth and email.
2. Add it to [`apps/web/.env.example`](../../apps/web/.env.example), and to the root
   [`.env.example`](../../.env.example) and [`docker-compose.yml`](../../docker-compose.yml) if the container needs it.
3. Add it to `tasks.build.env` in [`turbo.json`](../../turbo.json), so Turborepo passes it to the build and includes
   it in the cache key.
4. Add a row to the variables table in [deployment.md](../deployment.md#4-environment-variables).
