# Code organization review — 2026-11-12

Read-only review of `main` at `297c628`. No code was changed and no tests, build or server were run. File counts and line
counts come from `git ls-files` and `wc -l`; import counts come from `grep`. The rules in `AGENTS.md` are taken as given.

**Verdict.** The package boundaries are right and need no new package. The problem is two flat folders in `apps/web`:
`lib/` has 102 source files and 61 tests at its root, and `components/` has 62 files at its root. Group both by feature,
using the same feature names in each, and fix the few places where a boundary leaks. Tests stay next to their source,
which the owner already decided (`docs/decisions.md:21`). Each move is mechanical and fits in a small PR.

## 1. What is where today

| Area                       | Size                                                                              | Shape                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib`             | 102 sources + 61 tests at the root; `capture/`, `consent/`, `content/`, `telemetry/` | Flat. Server loaders, client hooks, server actions, pure helpers and auth all sit side by side              |
| `apps/web/components`      | 62 files at the root; 13 feature folders (`admin/`, `auth/`, `billing/`, …)       | Half grouped. Receipts, the app shell, marketing, settings, install and support are still loose at the root   |
| `apps/web/app`             | Routes; colocated private pieces (`admin/settings/*-form.tsx`)                    | Fine. Follows App Router conventions                                                                          |
| `packages/core/src`        | 30 files at the root; `analytics/`, `billing/`, `jobs/`, `step-up/`, `telemetry/` | Mostly fine. Admin (4 files, about 2,000 lines) and receipts (7 files) are the obvious clusters still flat      |
| `packages/db/src/index.ts` | 799 lines                                                                         | All tables, enums, relations, the pool, TLS and row types in one file                                         |
| `packages/{ai,storage,email,ui,bench}` | Small, cohesive                                                       | Leave as they are                                                                                             |

## 2. Boundary leaks and mixed concerns (fix these first, they are real)

1. **Web queries the database directly, outside core.** `apps/web/lib/workspaces.ts:45` and `:56` and
   `apps/web/app/app/settings/page.tsx:43` call `createDb` and write Drizzle queries in the app. AGENTS.md says shared
   backend work goes in `packages/core`. `lib/auth.ts:109` is a fair exception, because Better Auth's adapter needs
   the handle. Move `listWorkspaces`, `isSharedWorkspace` and the settings page's workspace load into
   `packages/core/src/workspace.ts`.
2. **`lib` depends on `components`.** `lib/quota.ts:12`, `lib/upgrade-copy.ts` and `lib/upgrade-level.ts` import the
   `Usage` type from `@/components/usage-meter`. Move the type into lib (it belongs in `lib/billing/`) and have the
   component import it from there.
3. **Bench and scripts reach into the app by relative path.** These imports go straight into `apps/web/lib`:
   `packages/bench/prep.ts:4-5` (`../../apps/web/lib/upload-encoding`, `upload-prep`), `scripts/splash-ios.ts:16` and
   `scripts/manifest-screenshots.ts:17`. That is acceptable for dev tools, but every move below has to update these
   paths. `tsc` catches it for bench (`packages/bench/tsconfig.json` includes `*.ts`). Make sure the scripts are
   typechecked or covered by knip (`knip.json` lists `scripts/*.{ts,mjs}` as entries, so an unresolved import shows up).
4. **Config drift.**
   - `packages/core/package.json:13` exports `./receipt-fields`, but `vitest.config.mts` has no alias line for it,
     although its comment says every subpath needs one. It resolves only through the workspace link.
   - `turbo.json` defines a `test` task, but no package has a `test` script and the root `test` runs Vitest directly
     (`package.json` `"test": "vitest run --project unit"`). The task is dead config, and
     `docs/architecture/tooling.md:21` describes it as live.
5. **Test outliers from the [test-suite review](2026-11-08-test-suite.md) are still open.** None of these has moved:
   - `packages/core/src/rls.test.ts` tests the db schema.
   - `analytics/time-buckets-hour.test.ts` should merge into `time-buckets.test.ts`.
   - `jobs/jobs.test.ts` mixes three modules.
   - `apps/web/lib/seo-routes.test.ts` tests `app/robots` and `app/sitemap`.
   - `createUser` is copied into 6 core integration files: `receipts`, `jobs/jobs`, `groups`, `admin-ops`, `admin`
     and `billing/billing.int.test.ts`.

**Too big but not mechanical to split.** Leave these until the next time they are edited for another reason:
`capture/review-sheet.tsx` (832), `upload-panel.tsx` (758), `dashboard/spend-dashboard.tsx` (641),
`admin/ops/charts.tsx` (556), `core/billing/service.ts` (1013), `core/admin-ops.ts` (935), `core/repository.ts` (744)
and `lib/auth.ts` (698). `db/src/index.ts` is the one large file whose split is purely mechanical (§4, PR 3).

## 3. Test layout: keep tests next to the source

**Decision: keep `foo.test.ts` and `<flow>.int.test.ts` next to the code. Don't add `tests/` or `__tests__/`.** This
confirms `docs/decisions.md:21`. Each tool, weighed:

| Concern | Colocated (today) | `tests/` mirroring `src/` | `__tests__/` per folder |
| --- | --- | --- | --- |
| Vitest | Suffix globs (`apps/**/*.test.{ts,tsx}`, `packages/**/*.test.ts`, `*.int.test.ts`) already work anywhere | Same globs work, so no gain | Same |
| Imports | `./foo` | `../../src/lib/foo` everywhere, or a new alias in tsconfig, Vitest and knip | `../foo` |
| tsconfig | Packages `include: ["src"]` typecheck their tests today | 6 package tsconfigs need `tests` added, or tests stop being typechecked | No change |
| knip | Vitest plugin treats `*.test.*` as entries | Same | Same |
| turbo | Tests don't run through turbo (root Vitest), so there is no cache effect | None | None |
| Upkeep | A move or rename takes its test along | Two trees to keep in step; orphaned tests go unnoticed | Twice as many folders |
| Churn | None | About 106 unit and 13 integration files move; every open PR conflicts | Same |

The pain the owner sees, 61 tests in one flat folder, comes from `lib/` being flat, not from colocation. The feature
folders below bring the `lib/` root from 163 files down to about 30. For readers who want sources only, add VS Code
file nesting (`explorer.fileNesting.patterns`: `"*.ts": "${capture}.test.ts, ${capture}.int.test.ts"`, same for
`*.tsx`). That is one optional `.vscode/settings.json` with no build impact.

Rules to write down in `docs/architecture/tooling.md`, from the earlier review's draft:

- A test file has a source sibling, unless it is a flow (`*.int.test.ts`) or a repo check (`design-tokens.test.ts`,
  `share-worker.test.ts`).
- Split a large module's tests by facet: `extract.<provider>.test.ts`.
- Shared setup goes in `packages/<pkg>/src/test-utils.ts`, `apps/web/test-utils/` and `apps/web/e2e/helpers.ts`.

## 4. Target layout

Group by feature, and use the same feature names under `lib/` and `components/`. Two rules apply to every move:

- **No barrels (`index.ts`).** A barrel would mix `server-only` and client modules, and that defeats tree-shaking.
  Imports stay `@/lib/<feature>/<file>`.
- **Drop a prefix only when the folder repeats it** (`auth-errors.ts` → `auth/errors.ts`). Other names stay as they
  are, so git records each move as a rename.

`apps/web/features/<x>/{components,lib}` was considered and rejected. It moves twice as many paths, and the app
already has `components/<feature>/` started.

```text
apps/web/lib/
  (root: request plumbing and generic helpers, about 15 files)
    env  log  runtime  http  json-body  request-id  session  page-event  redirect  signed-in-hint
    format  site  csp  csp-report  cron-auth  health  jobs  theme  theme-script  time-zone-cookie
    use-hydrated  use-is-desktop  use-online  no-react-email
  auth/       auth→server, auth-client→client, accounts, errors, guards, method, rate-limit, routine,
              two-factor, admin-bootstrap, captcha-endpoints, totp, totp-uri, passkey-label, set-password,
              sign-in-methods(+int), account-deletion, email-limits, security-prompt, impersonation-actions,
              turnstile, auth.int / two-factor.int tests
  step-up/    step-up, actions, check, paths (+ step-up.int.test)
  billing/    billing, setup-hint, payment-link, plans, plan-copy, plan-limits, pricing, processors, quota,
              usage (the `Usage` type from components/usage-meter)
  upgrade/    actions, copy, dismissal, event, level, offer
  receipts/   receipts, permissions, reading, groups, spend, csv, counts-key, backoff-poll, return-watch
  upload/     encoding, prep, telemetry (from upload-*), share-target, use-shared-files
  capture/    unchanged (image pipeline)
  pwa/        pwa, display-mode, ios-splash, manifest-screenshots, install-offer-actions, install-offer-event,
              use-install-offer, back-transition, bottom-slot (+ share-worker.test)
  seo/        seo, seo-hosts, llms, og-image, home-faqs, product-preview
  email/      mailer, contact-mail, contact-reply-mailer, welcome, welcome-mailer, newsletter, test-email
  consent/ content/ telemetry/   unchanged
  workspaces.ts, settings-rows.ts, support-widget.ts → workspaces moves to core (§2.1); the other two go with
              their only users (settings/ and support/ below)

apps/web/components/
  (root: shared atoms) brand  github-icon  turnstile  design-tokens.test.ts
  shell/      app-nav(+test), app-skeletons, mobile-tabs, page-header, user-menu, workspace-switcher,
              impersonation-banner, offline-bar, no-workspace, pushed-screen, refresh-on-return, standalone,
              section-error(+test), skip-link, theme-provider, theme-toggle, usage-meter
  receipts/   receipt-actions, receipt-editor, receipt-list, receipt-result, receipt-status,
              retry-receipt-button, processing-poller
  capture/    + upload-panel, shared-files-notice
  marketing/  landing-page, landing-install, landing-install-sheet, hero-floating-receipts, hero-parallax,
              product-preview, site-header, site-header-bar, site-footer, legal-page, newsletter-signup,
              newsletter-step
  install/    install-card, install-guide(+test), install-offer, use-install-action, pwa
  settings/   about-settings, account-settings, delete-account-confirm, receipt-reading-settings,
              settings-breadcrumb, settings-list, settings-section
  billing/    + plan-card
  support/    support-panel, support-widget, support-widget-client, contact-button
  admin/ auth/ consent/ content/ dashboard/ groups/ history/ members/ security/ step-up/ upgrade/   unchanged

packages/db/src/
  index.ts           re-exports only (public API unchanged)
  client.ts          createPool, createDb, tlsOptions, TimeoutClosingClient (+ client.test.ts from tls.test.ts)
  schema/            receipts.ts, ocr.ts, jobs.ts, billing.ts, groups.ts, step-up.ts, admin.ts, index.ts (schema object)
  auth-schema.ts     unchanged
  schema.test.ts     from core/src/rls.test.ts
  pg.int.test.ts     unchanged

packages/core/src/   (optional, last)
  admin/      admin, admin-ops(+int), admin-queries, audit, admin.int.test
  receipts/   repository, pipeline, ocr, pdf-pages, files, receipt-fields, upload-limits, receipts.int.test
  groups/     groups, group-rules, group-schemas, groups.int.test
  test-utils.ts   createUser, run/db helpers
  everything else stays at the root
```

## 5. Migration plan: small PRs, in this order

Each PR does `git mv` plus import rewrites, with no logic change. Land each one when few PRs are open, because moves
conflict with in-flight work. Every PR runs the full AGENTS.md gate.

Every move PR must also check that nothing else points at the old path:

- `git grep '<old path>'` across `docs/` (64 doc links point into `apps/web/lib` or `components`), `scripts/`,
  `packages/bench/`, `next.config.ts` and `knip.json`.
- No `tsconfig`, Vitest glob, ESLint `files`, CI `changes` filter or `next-cache` hash glob
  (`.github/actions/next-cache/action.yml:17` hashes whole folders) needs to change for moves inside
  `apps/web/{lib,components}`.

| # | PR | Size | Tooling to touch besides imports |
| --- | --- | --- | --- |
| 1 | **Boundary fixes (§2.1–2.2):** workspace queries into core; `Usage` type into lib | S | `docs/architecture/core.md`, `web.md` (new core functions) |
| 2 | **Test outliers + config drift (§2.4–2.5):** merge `time-buckets-hour`; split `jobs.test.ts`; `seo-routes.test.ts` → `app/seo.test.ts`; core `test-utils.ts` for `createUser`; add the `receipt-fields` alias; drop the dead turbo `test` task | S | `vitest.config.mts` alias; `turbo.json`; `tooling.md:21`; knip (the new `test-utils.ts` is used only by tests, so check knip doesn't flag it) |
| 3 | **Split `packages/db/src/index.ts`** into `schema/*` and `client.ts`; move `rls.test.ts` → `db/src/schema.test.ts` | S | `drizzle.config.ts:4` can stay on `index.ts`. Check that `bun run db:generate` reports no schema change; `docs/architecture/db.md` |
| 4 | `lib/upload/` | S | `packages/bench/prep.ts:4-5` |
| 5 | `lib/auth/` + `lib/step-up/` (about 54 import sites) | M | `docs/architecture/web.md`, flows docs |
| 6 | `lib/billing/` + `lib/upgrade/` | M | `docs/architecture/web.md`, billing docs |
| 7 | `lib/receipts/`, `lib/email/`, `lib/seo/`, `lib/pwa/` (one PR each if the diff is over about 40 files) | S each | `scripts/splash-ios.ts:16`, `scripts/manifest-screenshots.ts:17`, `next.config.ts:69` (`no-react-email` stays at the root) |
| 8 | `components/shell/` + `components/receipts/` | M | `web.md` navigation table |
| 9 | `components/marketing/`, `install/`, `settings/`, `support/`; `upload-panel` → `capture/` | M | `web.md`, `flows/upload-and-extraction.md` |
| 10 | **Write the rule down:** the layout section of `docs/architecture/web.md`, the test rules in `tooling.md`, one line in AGENTS.md ("new web code goes in a feature folder under `lib/` and `components/`"), optional `.vscode` file nesting | S | — |
| 11 | *(Optional)* `packages/core/src/{admin,receipts,groups}/` | M | `packages/core/package.json` `exports` (`upload-limits`, `group-rules`, `receipt-fields`); matching `vitest.config.mts` aliases; `core.md` |

PRs 1–3 are worth doing on their own. PRs 4–9 matter only if the owner wants the folders tidied; they can stop at any
point and leave the tree consistent. PR 11 has the least value and touches public subpaths, so skip it unless core
keeps growing.

**How to check that a move changes nothing:**

- `bun run typecheck` and `bun run knip`. Knip flags any file left unreferenced.
- `bun run test`. Vitest finds tests by suffix, so its count must not change; compare the "Test Files" line before and
  after.
- `bun run build` for PRs that touch `next.config.ts` aliases.
- No e2e is needed for pure moves.

## Not verified

- No gate was run: no typecheck, test, knip or build.
- I didn't confirm that knip's Vitest plugin treats a test-only `test-utils.ts` as used.
- `drizzle-kit generate` was not run against a split schema.
- Import-site counts are from grep and are approximate.
