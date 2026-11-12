# Staff code review, 2026-11-12

Scope: `main` at `297c628`, read-only. It covers the receipt path end to end (`apps/web/app/api/receipts/**`, `lib/http.ts`,
`lib/receipts.ts`, `packages/core` pipeline, repository, jobs and groups), the Home, History, Upload, Settings and
receipt pages, the admin actions, the Paddle webhook and the contact route, and `packages/db`'s pool. Every finding
below was checked against the code. `bun run typecheck` and `bun run test` pass (details at the end).

Effort: **S** is under an hour, **M** is about half a day, **L** is a day or more.

## Summary

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | A model-read amount over `numeric(12,2)` or `int4` fails `complete()` every time, and the job pays for OCR 4 times per round | S |
| 2 | High | Receipt edits parse `12,50` as `12.00` and `1,234.56` as `1.00`, and silently drop amounts they can't read | S |
| 3 | Medium | A failed or timed-out insert during upload deletes the stored file, even when the row may have committed | S |
| 4 | Medium | History and Upload stream database reads without `SectionBoundary` (rule 4 of the database skill) | S |
| 5 | Medium | The Paddle webhook reads an unbounded body before it checks the size | S |
| 6 | Medium | Receipt editor: a network error leaves "Saving" spinning forever | S |
| 7 | Medium | The PATCH handler parses and validates the body itself, and has no tests | M |
| 8 | Medium | Settings and `lib/workspaces.ts` run Drizzle directly and bypass the `Db` service | M |
| 9 | Low | The contact route holds about 100 lines of business logic | M |
| 10 | Low | Duplicated plumbing: route preamble (15 handlers), admin `core()`/`ActionError`, `transact`, three body-capping readers, `UploadSection` | M |
| 11 | Low | Admin `recordFailure` writes a raw `error.message` into the audit log | S |
| 12 | Low | `SpendSection`'s try/catch swallows Next's control-flow signals | S |
| 13 | Low | A huge `?page=` overflows `OFFSET`, which errors the History page | S |
| 14 | Low | Currency input is cut to 3 characters before validation (`"EURO"` saves as `EUR`) | S |
| 15 | Low | Stale comments, dead code and an inverted import | S |
| 16 | Low | Oversized files and components | L |

---

## 1. High: an out-of-range amount burns OCR retries, then fails the receipt

**Where:** `packages/core/src/repository.ts:469-472` and `:489-496` (`complete`), schema in
`packages/db/src/index.ts:90-93,142-144`, extraction schema in `packages/ai/src/schema.ts:51-63`, retry classification
in `packages/core/src/jobs/kinds/receipt-extract.ts:101-102`.

**Problem:** The extraction schema accepts any finite `z.number()` for `subtotal`, `tax`, `tip`, `total`, `unitPrice`,
`totalPrice` and `quantity`. The columns are `numeric(12,2)` (at most 9,999,999,999.99) and `integer` for quantity.
`complete()` writes `String(extraction.total)` and `Math.round(item.quantity || 1)` unchecked. Postgres rejects an
out-of-range value with a numeric overflow error, which the code maps to a `DbError`. `classifyExtractionError` treats
every `DbError` as retryable, so the job re-runs the whole attempt, OCR included.

**Failure:** A model can misread a barcode, phone number or card number as the total (for example `4111111111111111`),
or return a huge quantity. Each of the round's 4 job attempts then calls the model, is billed (calls are recorded on the
failure path) and fails the same way. The receipt then fails with the generic "blurry" message. A user retry repeats
this for up to `MAX_EXTRACTION_ATTEMPTS` = 3 rounds, so one photo can cost 12 or more paid model calls. High-denomination
currencies such as IDR, VND and IRR bring real totals within a few digits of the limit.

**Fix (S):** Bound the amounts in `receiptExtractionSchema`, for example `z.number().min(-1e9).max(9_999_999_999.99)`
and `quantity.max(1e6)`, so an out-of-range value is `invalid-output` and goes down the fallback chain. Alternatively,
clamp or null those values in `complete()`. Also make a Postgres data error non-retryable: SQLSTATE class `22`
(`22003` numeric_value_out_of_range) and `23` (constraint violations). `errorFields` already extracts the code. Add a
`receipts.int.test.ts` case that completes an extraction with `total: 1e12`.

## 2. High: receipt edits corrupt or silently drop amounts

**Where:** `apps/web/app/api/receipts/[id]/route.ts:74-80` (`decimal`) and `:129-132`. Inputs are in
`apps/web/components/receipt-editor.tsx:188-233` (free text with `inputMode="decimal"`, no client validation).

**Problem:** `decimal()` uses `Number.parseFloat(String(value))`, which stops at the first character it can't parse.
It returns `undefined` for anything that isn't a number, and `undefined` means "field not in the patch".

**Failure:**
- `12,50` (decimal comma, standard in most of Europe and Latin America) saves as `12.00`.
- `1,234.56` saves as `1.00`.
- `€12.50` or `abc` leaves the field unchanged but returns `{ ok: true }`. The editor closes, so the user believes it saved.

Corrections are "what gets exported" (the editor's own copy), so this corrupts the export.

**Fix (S):** Validate the body with a zod schema. Accept `^-?\d{1,10}([.,]\d{1,2})?$` after stripping spaces and
currency symbols, treat a comma before the last 1–2 digits as the decimal separator, and return 400 with the field name
on anything else. Never drop a field silently. Also add tests (see #7).

## 3. Medium: the upload's stored file is deleted when the insert's outcome is unknown

**Where:** `packages/core/src/pipeline.ts:203`.

**Problem:** `Effect.tapError(() => storage.remove([imageObjectKey]))` runs on *any* failure of `repo.insert`,
including a `DbError` from pg's `query_timeout` on the COMMIT. The database skill (rule 3) and `packages/db`'s own
comment both say a timed-out write may still have committed.

**Failure:** The row, its round (quota) and its job commit, but the object is gone. The job's `storage.get` then fails
with `StorageError`. That error is retryable, so it uses all 4 attempts before the receipt fails with the generic
message, and the user has paid quota for it.

**Fix (S):** Remove the object only on the quota verdict (`result.kind === "quota"`) or on a failure known to have
rolled back. On a `DbError`, keep the object and log `receipt.ingest_unknown` with its key; a sweep of objects that no
row references (needed anyway, see `receipt.object_delete_failed`) cleans up. Also make a `NoSuchKey` from storage
non-retryable.

## 4. Medium: streamed database sections without an error boundary

**Where:** `apps/web/app/app/history/page.tsx:113-134` (three Suspense sections: `Summary`, `Groups`, `Results`) and
`apps/web/app/app/upload/page.tsx:50-52` (`Panel`).

**Problem:** Rule 4 of the database skill says every Suspense section that reads the database has a `SectionBoundary`.
Home follows it. History and Upload don't.

**Failure:** One slow or failed read (for example `getWorkspaceGroups` for the chip row) replaces the whole page with
`app/app/error.tsx`, though the results list could still render. This is the same class of bug as the Home incident,
in the most-used page after Home.

**Fix (S):** Wrap each section in `SectionBoundary` as Home does.

## 5. Medium: the Paddle webhook buffers an unbounded body

**Where:** `apps/web/app/api/billing/paddle/webhook/route.ts:28-33`.

**Problem:** The route refuses a body by its declared `Content-Length`. A chunked request has no length, so
`request.text()` reads the whole body before the size check on line 33, and the signature is checked after that. The
comment says the read "is checked again", but by then the body is already in memory. The route is unauthenticated.

**Failure:** In the Docker/Bun deployment (no platform body limit), anyone can stream hundreds of MB into one function
instance. Vercel's 4.5 MB limit hides the problem there.

**Fix (S):** Read through the existing capped reader (`readCapped` in `lib/json-body.ts`, exported) and refuse at
256 KB mid-stream. See #10 for merging the three capped readers into one.

## 6. Medium: receipt editor hangs on a network error

**Where:** `apps/web/components/receipt-editor.tsx:89-105`.

**Problem:** `save()` sets `saving` to true, then calls `await fetch(...)` without a try/catch. A rejected fetch (the
phone goes offline, or a deploy restarts the server) skips `setSaving(false)`, and the rejection goes unhandled.
`useRetryReceipt` (`retry-receipt-button.tsx:14-36`) handles the same case correctly. `useDeleteReceipt`
(`receipt-actions.tsx:51-63`) has the same gap.

**Failure:** The Save button stays disabled with a spinner and no message. The user's edits are lost when they leave.

**Fix (S):** Use try/catch/finally like `useRetryReceipt`, with a "Check your connection" error.

## 7. Medium: the PATCH handler holds the validation logic, and none of it is tested

**Where:** `apps/web/app/api/receipts/[id]/route.ts:73-133`, `route.test.ts` (only the 413 and malformed-JSON cases).

**Problem:** Parsing amounts, text, currency and category is domain validation in the HTTP adapter. AGENTS.md says
route handlers stay thin, and `packages/core` already owns `parseCurrency`, `parseReceiptDate` and `ReceiptPatch`. None
of the parsing has a test, which is how #2 and #14 shipped.

**Fix (M):** Add a `receiptPatchSchema` in `packages/core/src/receipt-fields.ts` (zod, returning `InvalidInput` with
field messages), call it from the route through `readJson(request, receiptPatchSchema)`, and unit-test it with
`12,50`, `1,234.56`, `€5`, `-3`, `1e12`, `""`, `null` and `"EURO"`.

## 8. Medium: Drizzle queries outside the `Db` service

**Where:** `apps/web/app/app/settings/page.tsx:31,42-53` (`loadWorkspace`, with `authEnv.databaseUrl!`) and
`apps/web/lib/workspaces.ts:42-61` (`listWorkspaces`, `isSharedWorkspace`).

**Problem:** A page component and a lib module build queries with `createDb(authEnv.databaseUrl)`. They bypass
`packages/core` and the `Db` service, so they get no `DbError` mapping. They also read the URL from `authEnv` rather
than core's `DatabaseUrl`. If the two differ, these reads go to a different pool than the rest of the page. The
`!` assertion in the settings page throws a `TypeError` if the URL isn't set (the page is reachable only with a
session, so this is latent).

**Cost:** Two more places to update when the schema, scoping rules or query budget change, and they don't show up when
`packages/core` is reviewed for the database skill's rules.

**Fix (M):** Move them to `packages/core` (`workspaceSummary(orgId)`, `listMemberships(userId)`,
`isSharedWorkspace(orgId)`) and call them through `runtime`. Better Auth's own `createDb` in `lib/auth.ts` is a
legitimate exception.

## 9. Low: the contact route is a service in a route file

**Where:** `apps/web/app/api/contact/route.ts:54-140`.

**Problem:** The route makes about 10 hand-written field checks on a `z.record(...)` cast to `ContactPayload` (line 60),
sends the support email, checks Turnstile and queues the auto-reply. Each check repeats the same
`event.status_code`/`event.outcome`/`NextResponse.json` triplet.

**Fix (M):** Add a zod `contactSchema` (with custom messages) for the field checks, and a `submitContact` function (in
`lib/contact.ts`, since `@receipt-ocr/email` and the mailer live in the web app) that returns a tagged outcome. Map
outcomes to responses in one table.

## 10. Low: duplicated plumbing

- **Route preamble** in 15 handlers under `app/api/receipts/**` and `app/api/groups/**`: `crossOriginResponse`,
  `getActiveScope`, `jsonError(401)`, `annotateCaller`, `await params`, `event.x_id = id`. The 401 is also inconsistent:
  upload returns 409 when there is no workspace, and the others return 401. **Fix (S):** add a `withScopedRoute({ event,
  route, mutation })` wrapper in `lib/http.ts` that passes `scope` to the handler.
- **Admin action plumbing:** `SAFE_TAGS`, `ActionError`, `context()` and `core()` are copied between
  `app/admin/actions.ts:59-91` and `app/admin/jobs/actions.ts:30-60`. `run()` is almost the same in both files too.
  **Fix (S):** move them to `lib/admin-action.ts`.
- **`transact`:** `packages/core/src/groups.ts:58-70` repeats `audit.ts:43-60`, differing only in which refusal classes
  pass through. `hasCode`/`isUniqueViolation` exist only in `groups.ts`, but they are general.
  **Fix (S):** have `audit.ts`'s `transact` accept `Forbidden` too, and move `hasCode` to `errors.ts`.
- **Capped body readers:** `lib/http.ts:319-346` (multipart), `lib/json-body.ts:9-31` (JSON) and the webhook's
  uncapped read (#5). **Fix (S):** one `readCapped(request, limit)` that the others build on.
- **Upload panel loader:** `app/app/page.tsx:192-207` (`UploadSection`) and `app/app/upload/page.tsx:23-37` (`Panel`)
  are identical. **Fix (S):** export one server component.

## 11. Low: raw error messages in the audit log

**Where:** `apps/web/app/admin/actions.ts:107-115` (`recordFailure`).

**Problem:** `metadata.error = error.message.slice(0, 300)` stores the raw message of whatever the Better Auth call
threw. AGENTS.md: "Describe errors with `errorFields(error)`, never a message". An `APIError` message is usually safe.
A driver or `Cause.pretty` message (from `core()`, line 90) can carry query parameters, including emails. The admin
audit log is shown in the UI and kept indefinitely.

**Fix (S):** Store `errorFields(error)` (type, code), plus `error.message` only when it is an `APIError`.

## 12. Low: `SpendSection` swallows Next's signals

**Where:** `apps/web/app/app/page.tsx:296-302`.

**Problem:** `try { view = await getSpendView(...) } catch (error) { logger.error(...) }` has no `unstable_rethrow`.
`getSpendView` goes through `requireActiveScope` → `requireSession`, which calls `redirect()` when the session is
missing or expires mid-render. That redirect is caught and logged as `home.spend_failed`. `HomeTitle` on line 184 does
this correctly.

**Fix (S):** Add `unstable_rethrow(error)` as the first line of the catch, or drop the catch and let the
`SectionBoundary` around it handle the failure.

## 13. Low: unbounded `?page=` breaks History

**Where:** `apps/web/lib/receipts.ts:78,99,105`.

**Problem:** `page` is only clamped below. `?page=99999999999999999999` gives an offset of about 2.5e21, which is
outside Postgres `bigint`, so the query fails. The DbError ends up on `app/app/error.tsx` (and in Sentry as a 5xx).

**Fix (S):** Clamp `page` to `Math.min(page, 1_000_000)`, or redirect to the last page when `offset >= total`.

## 14. Low: currency is truncated before it is validated

**Where:** `apps/web/app/api/receipts/[id]/route.ts:120-122`.

**Problem:** `text(body.currency, 3)` slices to 3 characters *before* the `^[A-Za-z]{3}$` check, so any input whose
first three characters are letters passes: `"EURO"` saves as `EUR` and `"Dollars"` as `DOL`. Input like `"US Dollar"`
is still refused, because its slice `"US "` fails the regex.

**Fix (S):** Validate the full trimmed string. This belongs in #7's schema.

## 15. Low: stale comments, dead code, an inverted import

- `apps/web/lib/jobs.ts:6-16` ("until a worker and a drain route exist") and `app/api/receipts/route.ts:28-32` ("Until a
  worker or drain route exists"): `/api/jobs/drain` exists and runs every minute.
- `apps/web/lib/session.ts:30` `getCurrentUserId` has no callers.
- `apps/web/app/admin/actions.ts:348`: the comment says files are purged after Better Auth deletes the user. In fact
  `prepareUserDeletion` purges them before `removeUser`.
- `apps/web/lib/quota.ts:13` imports the `Usage` type from `@/components/usage-meter`. A server lib depends on a UI
  component; the type belongs in `lib/`.

**Fix (S):** Update or delete each one.

## 16. Low: oversized files

The largest non-test files are `packages/core/src/billing/service.ts` (1,013 lines), `core/src/admin-ops.ts` (935),
`apps/web/components/capture/review-sheet.tsx` (832), `packages/db/src/index.ts` (799: the whole schema plus the pool
and TLS code), `components/upload-panel.tsx` (758, with `UploadPanel` itself about 520 lines and 10 state hooks),
`core/src/repository.ts` (744) and `apps/web/lib/auth.ts` (698).

**Fix (L, opportunistic):** Split them when they are next touched.
- `db/index.ts` into `schema/*.ts` and `pool.ts`.
- `UploadPanel`: move the queue/progress state into a `useUploadQueue` hook.
- `billing/service.ts`: separate webhook ingestion, event application and checkout/portal.
- `auth.ts`: move the hooks into `auth-hooks.ts`.

Splitting `db/index.ts` gives the most for the effort, because every database change touches it.

---

## Checked and fine

- **Type escapes:** production code has one `any` (`packages/db/src/index.ts:725`, an annotated pg overload). The
  `as` casts are on `unknown` request bodies or tuple types. One exception is `history/page.tsx:37`
  (`JSON.parse(key) as ReceiptListFilters`); it is safe because the key is built two functions down.
- **Job queue:** claim, fence, settle and reap use `SKIP LOCKED`, and every write checks the attempt. A poll's `kickJob`
  can recover an expired lease because every tick reaps first.
- **Tenant scoping:** every receipt and group query is scoped by `organization_id`, and ids are checked as UUIDs before
  a cast.
- **Edge cases:** CSV formula injection is guarded, and quota is re-checked under the advisory lock in the same
  transaction as the insert.
- **Spend dashboard:** one statement.

## Test run

`bun run typecheck`: passes (8/8 tasks). `bun run test`: 154 files, 1,950 passed, 2 expected failures. Integration and
e2e tests were not run. None of the High or Medium findings has a test today.
