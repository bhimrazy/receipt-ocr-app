# Test suite audit — 2026-11-08

Read-only audit of `origin/main` at `9bd27c4`. No code was changed. Owner decision this applies: unit tests sit next to
their source as `foo.test.ts`, DB integration tests are `*.int.test.ts`, browser tests are `apps/web/e2e/*.spec.ts`.

**Verdict:** the suite is in good shape. Most titles already describe behaviour, `it.each` is used widely, there are no
snapshots and no `.only` or `.skip` left in. The real problems are in how the suite is wired up, not in the tests:

1. **`packages/core/src/connections.int.test.ts` never runs.** `test:int` lists files by hand
   (`packages/core/package.json:16`, `apps/web/package.json:14`), and that file is not on the list. CI only runs those
   two scripts (`.github/workflows/ci.yml:196`).
2. **`scripts/test.sh` doesn't run the integration suites**, though CI does. It runs `bun run test` and then e2e
   (`scripts/test.sh:30-73`). AGENTS.md says "run what CI runs".
3. **The default `bun run test` collects all 13 `*.int.test.ts` files and skips them**
   (`vitest.config.mts:15` includes `**/*.test.ts`). Their module code still runs (`ManagedRuntime.make(AppLayer)`,
   `vi.mock`) on every unit run. The config comment (`vitest.config.mts:6-9`, "no database") no longer matches what it
   collects.
4. **Setup is copy-pasted.** `createUser` and the `run`/`db` runtime helpers appear in 5 core integration files,
   the mailer mock and session-cookie parsing in 3 web integration files, `sql()` and `freshContext` in 3 e2e specs,
   and `vi.mock("server-only")` in 20 files.

Not verified: I didn't get a unit run to finish. `vitest run` on a worktree of main, with `node_modules` symlinked
from the checkout, hit my 300 s timeout in a busy codespace. `docs/architecture/tooling.md:127` says a run takes about
13 s on a runner. Integration and e2e suites were not run. Counts below come from `git ls-files` and grep. One
`it.each` counts as one case.

## 1. Inventory

| Package          | Unit files / cases | Int files / cases | E2E specs / cases |
| ---------------- | -----------------: | ----------------: | ----------------: |
| apps/web         |           65 / 427 |            5 / 40 |           22 / 98 |
| packages/core    |           20 / 243 |           8 / 117 |                 — |
| packages/ai      |           13 / 144 |                 — |                 — |
| packages/email   |             2 / 37 |                 — |                 — |
| packages/storage |              2 / 8 |                 — |                 — |
| bench            |             2 / 30 |                 — |                 — |
| packages/db, ui  |                  0 |                 0 |                 — |

About 20.4k lines of tests. The biggest files are `jobs/jobs.int.test.ts` (1202 lines, 33 cases),
`receipts.int.test.ts` (631), `telemetry.test.ts` (580), `groups.int.test.ts` (541) and `pdf-pages.test.ts`
(531, 42 cases).

**Files that break the naming rules or sit in odd places.** These test files have no `foo.ts` next to them:

| File                                                                    | What it tests                                                       | Proposal                                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/rls.test.ts`                                         | `packages/db` schema (`enableRLS` on every table)                   | Move to `packages/db/src/schema.test.ts` (db has no tests)                                                                   |
| `packages/core/src/analytics/time-buckets-hour.test.ts`                 | `time-buckets.ts` (hour buckets)                                    | Merge into `time-buckets.test.ts` as `describe("hour buckets")`                                                              |
| `apps/web/app/api/groups/routes.test.ts`                                | Several group route files                                           | Keep as one file for the feature; rename to `groups.routes.test.ts` or split per `route.ts`                                  |
| `apps/web/lib/seo-routes.test.ts`                                       | `app/robots`, `app/sitemap`, `lib/llms`, `lib/seo`, `next.config`   | Keep (cross-cutting); a feature name is fine, but move it to `apps/web/app/seo.test.ts` next to robots and sitemap           |
| `apps/web/lib/share-worker.test.ts`                                     | `public/share-worker.js` in a `vm` sandbox                          | Keep; it can't sit next to a file in `public/`. Note it in the guide as the exception                                        |
| `apps/web/components/design-tokens.test.ts`                             | A lint over all `.tsx` files                                        | Keep; it's a repo check that happens to use vitest. Move to `scripts/` or leave and document                                 |
| `packages/ai/src/extract.{anthropic,google,groq,openai,effort}.test.ts` | `extract.ts`, per provider                                          | Keep: `foo.<facet>.test.ts` is a reasonable split of a large module. Make it the documented rule                             |
| `packages/core/src/jobs/jobs.test.ts`                                   | `backoff.ts`, `kinds/receipt-extract.ts`, `ocr.ts` cooling          | Split: `backoff.test.ts` and `kinds/receipt-extract.test.ts`                                                                 |
| `packages/core/src/telemetry/telemetry.test.ts`                         | `redact`, `sampling`, `logger`, `current`                           | Split per module, or keep as the package's facade test. Low priority                                                         |
| `*.int.test.ts` without a sibling (`jobs`, `receipts`, `rls`, `two-factor`, `wide-events`, `migrations`) | Flows      | Fine. Integration tests are named for the flow they cover                                                                   |
| `apps/web/e2e/capture-desktop.spec.ts`                                  | Capture at desktop size                                             | Exists only because `capture.spec.ts` is bound to the mobile project. Keep, and say why in a line at the top of the file     |

**Config quirks**

- `vitest.config.mts:15`: one include pattern collects unit and integration files together. Use two vitest
  `projects`: `unit` excludes `**/*.int.test.ts`, and `int` includes only those files with `fileParallelism: false`
  and `env INTEGRATION=1`. Then `test:int` is just `vitest run --project int`, and no file list can drift. That
  closes findings 1 and 3.
- `vitest.config.mts:20-31`: the alias table repeats each package's `exports`. Any new subpath export has to be added
  here too. Keep it, but add a comment saying so.
- 13 files gate on `const enabled = process.env.INTEGRATION === "1"` plus `describe.skipIf(!enabled)`. With an `int`
  project this guard can go, because the unit project never loads those files.
- `apps/web/playwright.config.ts:7`: a random client IP per worker, while `admin.spec.ts:23` and
  `admin-ops.spec.ts:14` build their own `freshContext` with a random IP. Move it into `e2e/helpers.ts`.
- `playwright.config.ts:15`: `retries: 1` in CI hides flakes. Recent failures on `main` (runs 42410999464,
  42400279609) failed on the retry too, so they were real. Keep it, but report flaky tests (`--reporter` or the
  job summary).
- Env-gated specs (`consent-ga`, `turnstile`, `upload`, `capture`, `pdf-pages`) use a top-level `test.skip(...)`.
  The pattern is consistent; document it.
- The integration logs are noisy. The CI log for `receipts.int.test.ts` is full of stdout/stderr wide events. A
  test sink for the logger (in `test-utils`) would make real failures easier to find.

## 2. Candidates to delete or merge (conservative)

| #   | Where                                                                                                     | Action                                                                                                        | Why                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `packages/ai/src/client-cache.test.ts:34-45`                                                              | Delete                                                                                                        | Same test as `packages/storage/src/client-cache.test.ts:40-48`. `LruCache` is itself duplicated (`ai/src/client-cache.ts:11`, `storage/src/client-cache.ts:12`); deduping the class is a separate code change |
| D2  | `packages/core/src/rls.test.ts:11-13`                                                                     | Merge into the next test as a precondition                                                                    | "finds the tables" only guards the filter. One test can assert `tables.length > 0`, then that none are missing RLS                                              |
| D3  | `apps/web/app/admin/settings/connection-status.test.ts:9`                                                 | Delete the line                                                                                               | `toBeTruthy()` on a `Record<ConnectionStatus, string>` (`connection-status.ts:3`). The type already guarantees it                                               |
| D4  | `apps/web/lib/ios-splash.test.ts:19`                                                                      | Delete the line                                                                                               | `toHaveLength(10)` pins a count that line 8 already derives (devices × themes)                                                                                 |
| D5  | `apps/web/lib/auth-rate-limit.test.ts:4-17`                                                               | Collapse 3 tests into one `it.each` table                                                                     | Mirrors config values. Keep it as a review tripwire for security limits, but as one table                                                                     |
| D6  | `packages/ai/src/extract.anthropic.test.ts:292-345`                                                       | Make the status-to-kind cases (429, 529, 500, 402, 413, 401) an `it.each`; keep the 400 cases separate        | 8 near-identical tests. `extract.openai.test.ts:216-238` already does it this way                                                                              |
| D7  | `packages/ai/src/extract.groq.test.ts:165-191, 260`                                                       | `it.each` for 500, 401, 404, 413                                                                              | Same pattern as D6                                                                                                                                             |
| D8  | `packages/ai/src/models.test.ts:121-135`                                                                  | One `it.each` of (model, usage, expected micro-USD)                                                           | Per-model price cases that repeat the catalog. Keep the arithmetic comments as the row label                                                                   |
| D9  | `packages/core/src/analytics/time-buckets-hour.test.ts`                                                   | Merge into `time-buckets.test.ts`                                                                             | Same module. Removes a file and the duplicated imports                                                                                                         |
| D10 | 20 × `vi.mock("server-only", () => ({}))`                                                                 | Replace with one alias in `vitest.config.mts` (`server-only` → an empty stub)                                 | Boilerplate, and easy to forget in a new file                                                                                                                  |
| D11 | `vi.mock("@/lib/http", …)` in 9 route/action tests (`app/api/*/route.test.ts`, `app/admin/**/actions.test.ts`) | Replace with one shared mock (see §4)                                                                   | Each file re-implements `withRequestEvent` and `discardBody`, which pins the wrapper's internals in 7 places                                                   |

**Kept on purpose:**
- `pdf-pages.test.ts:417-531`: the timing and memory tests guard against DoS from hostile PDFs. They are the slow
  unit file.
- `security.spec.ts`: the only black-box check that the route wiring enforces Origin, UUIDs and workspace names,
  even though unit and integration tests cover the same logic.
- `ops.spec.ts` vs `csp-report/route.test.ts`: the spec checks the real headers.
- The `env.test.ts` `.resolves.toBeDefined()` checks: they test "starts without throwing", which is the behaviour.
- `design-tokens.test.ts`.

**Estimate:** about 12 `it` blocks removed or folded into tables, 2 files merged away, roughly 120-160 lines
(about 20 of them `server-only` mocks, about 60-80 from the shared http mock). No behaviour loses coverage. Overall
the suite is lean; the gains come from §4 more than from deleting tests.

## 3. Naming

**Rule:** a title states what the system does, in the present tense, so a failing test reads as a bug report:
`describe(<unit or flow>)` plus `it(<what happens, under what condition>)`. Leave out ticket or audit codes
(`P1-2`, `L3`, `M3`, `U5`, `B4`, `GHSA-…`) and HTTP codes used as the whole subject. If the history matters, put a
short comment above the test, such as `// audit 2026-10 L3`.

There are 39 titles with codes, all from the security and database audits:

| Where                                    | Now                                                                    | Proposed                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/web/lib/env.test.ts:77`            | `trusted IP config (P1-2)`                                             | `trusted client IP headers`                                                    |
| `apps/web/lib/http.test.ts:28,52,68,189` | `clientIp (P2-6)`, `crossOriginResponse (L4)`, `failureResponse (L2)`, `discardBody (audit L1)` | Drop the suffixes: `clientIp`, `crossOriginResponse`, …              |
| `apps/web/lib/auth-guards.test.ts:67`    | `assertWorkspaceRole (GHSA-c85h)`                                      | `assertWorkspaceRole refuses role lists`                                       |
| `apps/web/lib/auth.int.test.ts:200`      | `M3: locks sign-in per address after 10 attempts, …`                   | `locks sign-in per address after 10 attempts, atomically, even for unknown addresses` |
| `apps/web/lib/auth.int.test.ts:111`      | `P2-2: stores reset tokens hashed, …`                                  | `stores reset tokens hashed, and the emailed link still works`                 |
| `packages/core/src/receipts.int.test.ts:151` | `U4: bootstraps one workspace with an owner, idempotently`         | `creates one personal workspace with an owner, idempotently`                   |
| `receipts.int.test.ts:497`               | `M1: successful and failed reads together`                             | `usage ledger counts successful and failed reads together`                     |
| `receipts.int.test.ts:538,548`           | `B4: …` ×2                                                             | Same text, prefix removed                                                      |
| `packages/core/src/pipeline.test.ts:396` | `deleteReceipt (U1)`                                                   | `deleteReceipt`                                                                |
| `packages/core/src/quota.test.ts:49`     | `enforces the global daily OCR cap (U5) ahead of …`                    | Remove `(U5)`                                                                  |
| `apps/web/app/api/receipts/route.test.ts:70` | `POST /api/receipts before the body is read (audit L1)`            | `POST /api/receipts refuses before reading the body`                           |
| `apps/web/e2e/security.spec.ts:4`        | `API hardening: workspace names, receipt ids and Origin checks`        | Fine as it is; just drop the `P1-1`/`L3`/`L4` comment prefixes inside          |
| `packages/ai/src/extract.anthropic.test.ts:292-340` | `429: rate-limited, …`                                      | In the D6 table: `maps HTTP %i to %s`                                          |

The rest are the same mechanical removal: `admin-bootstrap.test.ts:4`, `auth-guards.test.ts:33,57`, `auth.int.test.ts:81,88,147,172,307`,
`redirect.test.ts:30`, `csv.test.ts:105`, `admin.int.test.ts:139`, `files.test.ts:12`, `pdf-pages.test.ts:137`,
`repository.test.ts:14,28`, `receipts.int.test.ts:202,230,265,293,423,440,516,607` and `storage/src/index.test.ts:15`.
Get the list with
`grep -nE "\b([A-Z][0-9]+(-[0-9]+)?|GHSA-[a-z0-9]+|audit [A-Z][0-9])\b" $(git ls-files '*.test.ts' '*.spec.ts')`.

I found no vague titles ("works", "test 1", "should work"). `it("should …")` doesn't appear; keep it that way.

## 4. Shared helpers

| Helper                                       | Duplicated in                                                                                                                                                                        | Proposed home                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `runtime`, `run`, `runExit`, `db(f)`         | `admin-ops.int:43-46`, `admin.int:35-37`, `groups.int:38-41`, `receipts.int:34-46`, `jobs.int:111-116`                                                                               | `packages/core/src/test-utils.ts` (`intRuntime(layer = AppLayer)`)                                                               |
| `createUser(name)` → owner scope             | `admin-ops.int:61`, `admin.int:42`, `groups.int:56`, `jobs.int:164`, `receipts.int:103`, `wide-events.int:34-41`                                                                     | same file: `createOwner(tag, name, { createdAt? })`                                                                              |
| `join` / `joinAs` member                     | `admin.int:55`, `groups.int:66`                                                                                                                                                      | same file: `addMember(scope, name, role)`                                                                                        |
| `JPEG`, `FAILING_JPEG`, `limits`             | `admin.int:41`, `admin-ops.int:52-58`, `jobs.int:47-48`, `receipts.int:40-43`, `wide-events.int:72`                                                                                  | same file: `jpeg(tag)`, `failingJpeg(tag)`, `ROOMY_LIMITS`                                                                       |
| "run the receipt's job to the end"           | `receipts.int:51-82` (`extract`), `jobs.int:194` (`runToEnd`), `admin-ops.int:110` (`settle`)                                                                                        | same file, once the three are shown to be equivalent (check before merging)                                                     |
| `outcome(effect)` → `{ tag, message }`       | `groups.int:44`; similar `runExit` checks in admin/receipts                                                                                                                          | same file                                                                                                                        |
| Mailer mock capturing `sent[]`               | `auth.int:24-31`, `step-up.int:15-22`, `two-factor.int:27-34`                                                                                                                        | `apps/web/test-utils/mailer.ts`, used as `vi.mock("@receipt-ocr/email", () => import("@/test-utils/mailer"))`                    |
| Session cookie from `Set-Cookie`             | `auth.int:52-56`, `step-up.int:28-33`, `two-factor.int:39-44`                                                                                                                        | `apps/web/test-utils/auth.ts`: `sessionCookie`, `apiErrorOf`, `signUpUser`                                                       |
| `APIError` → status/code                     | `auth.int:68` (`status`), `step-up.int:62` (`errorOf`), `two-factor.int:49` (`failure`)                                                                                              | same file                                                                                                                        |
| `@/lib/http`, `@/lib/session`, `@/lib/log` mocks | 9, 7 and 7 route/action tests                                                                                                                                                    | `apps/web/test-utils/route-mocks.ts` exporting factories, plus a `scope` state the test sets                                     |
| `sql(run)` (postgres, max 1)                 | `e2e/admin.spec.ts:13`, `admin-ops.spec.ts:5`, `dashboard.spec.ts:10,99`, `auth.spec.ts:89`, `passkey.spec.ts:33`, `helpers.ts:55,89`                                               | `e2e/helpers.ts`: `withDb(fn)`                                                                                                   |
| `freshContext`, `adminPage`                  | `admin.spec.ts:22-48`, `admin-ops.spec.ts:14-29`                                                                                                                                     | `e2e/helpers.ts`                                                                                                                 |
| `LruCache` tests                             | ai + storage                                                                                                                                                                         | Goes away with D1 (and with deduping the class)                                                                                  |

Notes:
- Name the file `test-utils.ts`, or a `test-utils/` folder in `apps/web`, so knip and the build can exclude it with
  one pattern. Check `knip.json` after adding it.
- A helper takes the file's `tag`, so cleanup stays per file.
- Don't put assertions in helpers. They do arrange and act; the test does the asserting.

## 5. Testing guide (draft for `docs/architecture/tooling.md`)

> ### Tests
>
> | Kind        | File                                    | Runs with                     | Use it for                                                                                   |
> | ----------- | --------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
> | Unit        | `foo.test.ts(x)` next to `foo.ts`       | `bun run test`                | Pure logic, parsing, mapping, policies; route handlers with their collaborators mocked       |
> | Integration | `<flow>.int.test.ts` next to its module | `bun run test:int` (Postgres + RustFS from compose) | SQL, transactions, constraints, RLS, queue claims, Better Auth against a real database |
> | E2E         | `apps/web/e2e/<feature>.spec.ts`        | `bun run test:e2e` after `next build` | What a user sees and the HTTP wiring: sign-in, step-up, upload → result, CSV, admin   |
>
> - **Choose the lowest level that can fail for the right reason.** Use unit tests by default. Write an integration
>   test when the behaviour lives in SQL or in a library's database adapter, such as quotas, workspace scoping, job
>   leases or auth tokens. Write an e2e test for each user journey and for a security property only the full stack
>   shows. One e2e test per journey; don't repeat its edge cases there.
> - **Split big modules by facet:** `extract.anthropic.test.ts`. Files with no source sibling are for flows
>   (integration) or repo checks only.
> - **Names:** `describe` takes the unit or flow; `it` states the behaviour and its condition in the present tense
>   ("refuses a link off the app's origin"). No ticket or audit codes in titles; put them in a comment if they
>   matter. Use `it.each` when cases differ only in data.
> - **Helpers:** `packages/<pkg>/src/test-utils.ts`, `apps/web/test-utils/`, `apps/web/e2e/helpers.ts`. Reuse them
>   before writing setup. Helpers arrange and act; tests assert.
> - **Isolation:** each integration file tags its rows (`<file>-${Date.now()}`) and deletes them in `afterAll`.
>   E2E tests sign up fresh users with `uniqueEmail` and a per-context client IP.
> - **No secrets and no real network.** Providers are mocked at `fetch` or use `OCR_PROVIDER=fixture`. Email goes
>   to the mailer mock. Only `scripts/test.sh --turnstile` reaches out (Cloudflare's published test keys). Test
>   credentials are local dummies like those in `scripts/test.sh`. Never use a real key, and never log one.
> - **Assertions:** behaviour, not internals. No snapshots of large markup; assert the parts that matter (escaping,
>   links, plain-text part). Don't assert what the type system already guarantees.
> - **Before handing off:** `scripts/test.sh` runs unit, integration and e2e the same way CI does.

## 6. Execution plan

Wait until the open branches merge: `feat/sign-in-methods` (touching `auth-method.test.ts`, `templates.test.ts`,
the new `account-security.test.ts`), `feat/welcome-email` (`jobs.int.test.ts`, `templates.test.ts`, new
`welcome*.test.ts`), `feat/schema-fixes` / schema 0003 (`migrations.int`, `receipts.int`, `spend.int`,
`dashboard.spec`), `feat/observability-otlp` (telemetry) and `design/auth-pages`. Each PR below is sized to touch
as few files as possible, and each one is still worth having if later ones slip.

| #   | PR                                                                                                                                                                                                                                        | Size | Conflicts with                                              | Can start                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------- | --------------------------------------- |
| 1   | **Run every integration file.** Add vitest `projects` (unit, int); `test:int` = `vitest run --project int`; drop the hand-written lists, the `INTEGRATION` guards and the 20 `server-only` mocks (D10); `scripts/test.sh` runs `test:int`; fix the config comment. Confirm `connections.int` passes in CI | S    | Touches the first lines of every int file (the guard). Land it after schema-fixes and welcome-email, or keep the guard for now and remove it in PR 3 | **Now** (config-only version)            |
| 2   | **Naming pass** (§3): remove the codes from 39 titles, titles only                                                                                                                                                                        | S    | `auth.int`, `receipts.int`: after sign-in-methods and schema-fixes | After those two                        |
| 3   | **Core integration helpers**: `packages/core/src/test-utils.ts`; move `createOwner`, `addMember`, the runtime, the fixtures and a quiet logger sink; adopt them in 5 files                                                                | M    | `jobs.int` (welcome-email), `receipts.int`/`spend.int` (schema-fixes) | After both                        |
| 4   | **Web test helpers**: `apps/web/test-utils/` (mailer, auth cookies and errors, route mocks); adopt them in 3 int files and 9 route/action tests (D11)                                                                                      | M    | auth/step-up/two-factor ints (sign-in-methods)              | After sign-in-methods                   |
| 5   | **E2E helpers**: `withDb`, `freshContext`, `adminPage` into `e2e/helpers.ts`                                                                                                                                                             | S    | `dashboard.spec` (schema-fixes), `auth.spec` (design/auth-pages) | After both                         |
| 6   | **Tidy**: D1-D9, move `rls.test` to `packages/db`, merge `time-buckets-hour`, split `jobs.test.ts`                                                                                                                                        | S    | telemetry split deferred until observability-otlp merges    | Mostly now; ai and core files aren't on any branch |
| 7   | **Guide**: §5 into `docs/architecture/tooling.md` and a line in AGENTS.md "Validation"                                                                                                                                                    | S    | none                                                        | With PR 1                               |

Check every PR the same way: the vitest case count before and after (`vitest list` in each project) shouldn't drop
except by the D-items above, and CI's integration step should report one more file (`connections.int`) after PR 1.
