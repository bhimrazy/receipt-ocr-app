# Incident: Home sections stuck on skeletons (2026-11-09)

**Status:** root cause found, fix in review. **Impact:** signed-in pages (Home, `/admin`) intermittently left one or
more streamed sections on their skeletons until the function timed out. No data was lost or exposed.

## Timeline (UTC)

| Time        | What happened                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| 06:23       | #184 (upgrade modal) merges: `getUpgradeOffer` runs about 9 reads in parallel, in the app layout and in Home.      |
| 06:23–14:00 | #185–#202 deploy; none touches the database path.                                                                   |
| 14:00:51    | 8d7adbd (#200) deploys to production.                                                                               |
| 14:05:27    | Sentry RECEIPT-OCR-1: browser `removeChild` TypeError during a / → /sign-in navigation (unrelated, see below).      |
| 14:12:13    | A statement reaches Postgres through Supavisor and waits in the PARSE phase.                                        |
| 14:14:13.212 | Postgres cancels it after 120 s: `canceling statement due to statement timeout` (57014, user `postgres`, app `Supavisor`, command tag `PARSE`). |
| 14:14:13.249 | Sentry RECEIPT-OCR-2: handled server error on `/admin/jobs`, Effect frames, the same second.                       |
| evening     | The owner sees Home sections stuck, which ones varying; `/admin` stuck on its loading skeleton; a later visit loads. |

## Evidence

1. **Which sections hung points at one shared read each time.** Home's sections share per-request `cache()`d reads.
   First report: "To check", Spending and Recent hung, Upload loaded. Those three await `getReceiptCounts()`, and Upload
   doesn't. Second report: Upload and "To check" hung, Spending and Recent loaded. Those two await `getCurrentPlan()`
   (directly and through `getUpgradeOffer`), and the other two don't. One promise that never settles explains both
   exactly. A client-side, streaming or View Transition cause wouldn't pick sections by their data dependencies.
2. **Postgres saw a statement that started and never finished its protocol cycle.** Supabase `postgres_logs`,
   14:14:13.212: the only ERROR of the day is a statement timeout (server `statement_timeout` = 120 s) in the `PARSE`
   phase, on a backend that Supavisor opened at 14:05:01. With `prepare: false`, postgres.js sends a query with
   parameters as Parse + Describe + Flush, waits for ParameterDescription, and only then sends Bind + Execute + Sync.
   A backend left in PARSE for 120 s means it got the Parse and never got the rest: the client never received (or
   never acted on) the reply. `log_lock_waits` is on with a 1 s `deadlock_timeout`, and no lock wait was logged, so it
   wasn't a lock. Sentry's `/admin/jobs` error arrived 37 ms after the cancel, so the connection itself was alive.
3. **Database health was fine throughout.** About 20 of 60 connections, no ungranted locks, no long-running
   statements, health checks at about 0.3 s.
4. **The driver pipelines whenever the pool is busy.** In postgres.js 3.4.9, when no connection is open or closed, a
   new query is written to a busy one behind the query it's running (`handler()` → `busy.shift()`), and a connection
   that opens with queued queries runs several back to back. Through a transaction-mode pooler that is unsafe. When
   the first query's ReadyForQuery(idle) arrives, the pooler treats the transaction as over and hands the backend on.
   The pipelined query's reply then goes nowhere, and its promise never settles. This is [porsager/postgres#970][970]
   (hung pools through Supavisor and PgBouncer in transaction mode, traced to pipelining). The maintainer reports that
   v4 rewrote the pool.
5. **It reproduces locally.** A TCP proxy between postgres.js and compose Postgres dropped the server's bytes after
   each ReadyForQuery(idle) until the client wrote again, which is how a transaction-mode pooler releases a backend.
   With the app's settings then (`prepare: false`, one connection), a parameter-less query followed by a
   parameterised one left the second **pending indefinitely**, with the backend sitting in PARSE. The same proxy is
   now in `packages/db/src/pg.int.test.ts`, where the new driver answers every query.

[970]: https://github.com/porsager/postgres/issues/970

**Why this evening:** #184 added `getUpgradeOffer` to the layout and to two Home sections. One Home render now has
more reads in flight than the 5-connection pool (see [Query counts](#query-counts)), so pipelining went from rare to
most renders. A client navigation back to Home re-renders only the page segment, so its reads start together.

**What it wasn't:** a database or Supavisor outage (healthy, no errors besides the one above); #202's
`<ViewTransition>` or other client code (wrong shape of failure; #205 turned transitions off on a guess and didn't
address this); RECEIPT-OCR-1 (a browser DOM error on a public-page navigation, unrelated to data loading). A dead socket
on a resumed Fluid instance would also hang a query, but nothing in the evidence points to one; the driver's
`query_timeout` covers that case too.

## Root cause

postgres.js pipelines queries onto busy connections. Through a transaction-mode pooler (here Supabase's Supavisor),
a pipelined query can lose its reply. Nothing put a time limit on a query (postgres.js 3.4 has no query timeout),
and Home's sections had no error boundary. A lost reply therefore left every section that shared the read on its skeleton until Vercel's
maximum duration ended the response. #184 raised the per-render fan-out past the pool size, which made it frequent.

## Fix (this PR): a standard driver with its built-in timeouts

1. **Driver: node-postgres (`pg` 8.23.1) with `drizzle-orm/node-postgres`, replacing postgres.js.** pg-pool checks
   out one client per query and never writes a query onto a busy connection, so the failure above can't occur through
   any transaction pooler. Nothing is provider-specific: the same configuration runs against direct Postgres (Docker,
   RDS), PgBouncer, Supavisor and Neon. Drizzle sends unnamed statements, so no prepared-statement setting is needed.
   Changes that came with the switch:
   - Raw `db.execute()` returns a `QueryResult`, so about 70 call sites read `.rows`, and one test reads the
     constraint name from `constraint` instead of `constraint_name`.
   - Types are unchanged: drizzle's node-postgres session keeps timestamps as strings in raw results, as the
     postgres-js one did, and bigint and numeric stay strings.
   - The e2e helpers and the migrations test still use postgres.js directly, as test-only clients.
2. **Built-in timeouts, set in `createPool`:**
   - `query_timeout` 15 s (`DATABASE_QUERY_TIMEOUT_MS`) is the client-side deadline for a lost reply or a dead
     socket. It sits above the role's 10 s `statement_timeout` (D4, applied 2026-11-09).
   - `connectionTimeoutMillis` 10 s bounds connecting and the wait for a free client.
   - Also `idleTimeoutMillis` 20 s, `keepAlive`, `allowExitOnIdle` and `max` 10.

   pg's source shows a timed-out query stays the client's active query and absorbs its late reply. Replies are
   matched in order, so a late reply can never reach the next query. `pool.query` releases the client with the error,
   so the pool drops it. One gap: drizzle's `transaction()` releases its client without the error. If a statement
   inside a transaction outlasts the timeout, and so does the ROLLBACK queued behind it, the client would go back to
   the pool with the transaction still open, and the next borrower's queries would run inside it.
   `TimeoutClosingClient`, about 10 lines in `createDb`, closes a client whose query timed out. `pg.int.test.ts`
   reproduces the gap with the helper removed: the stale client is reused and the next query times out. With the
   helper, the client is closed and never reused.
3. **A visible error instead of an endless skeleton.** Each Home section (Upload, To check, Spending, Recent) and the
   sidebar usage meter sit in a `catchError` boundary (`components/section-error.tsx`). A failed or timed-out read
   shows "<Section> couldn't load." with **Try again**, which re-fetches through `router.refresh()`. The title falls
   back to "Home", and still lets Next's redirect signals through (`unstable_rethrow`). `/admin` uses its existing
   `admin/error.tsx`.
4. **Observability from pg's own errors.**
   - `errorFields` reports pg's two client-side timeouts, which carry no SQLSTATE, as `error.code = query_timeout` or
     `connect_timeout`. These are fixed driver strings, not user data.
   - `pool.on("error")` logs `db.pool_error` with `errorFields` when an idle client dies (a database restart, or a
     socket lost while a serverless instance was suspended). Without a listener that event would crash the process.
   - No new schema fields.
5. **Pool max 5 → 10** (owner's request; see below). This doesn't fix a stalled query.

### Why the first version's gate was dropped

The first commits on this PR kept postgres.js and wrapped it in a 300-line `gatedPool`: a semaphore to stop
pipelining, a deadline that replaced the whole pool (postgres.js 3.4 can't drop one stuck connection), timing for
BEGIN and COMMIT, and a TCP-level label and event system. A review found a hole in it: a COMMIT whose reply never came
wedged the instance. It worked, but it was custom machinery around a driver behaviour that a standard driver doesn't
have. Every pooler and provider would have had to be re-verified against it. node-postgres removes the cause and
brings the timeouts, so the gate, the pool reset and the `db.query_timeout` event were deleted.

### Reproduced before and after (compose, `next dev`, during the first version)

A logging proxy in front of compose Postgres dropped the reply to `getReceiptCounts()`'s statement, which is the
owner's first report.

- **Deadline off** (as production ran before this PR): the `/app` response was still open when curl gave up at 60 s. The
  HTML never closed, and To check, Spending and Recent stayed skeletons.
- **Deadline 4 s:** the response closed after 4.27 s. React's stream marked exactly those three boundaries "switched
  to client rendering because the server rendering errored", which renders their "couldn't load" cards.

The section boundaries are unchanged by the driver switch. `pg.int.test.ts` shows the same bounded failure at the
driver level. Screenshots of the card at 390 and 1440 are in PR #210.

### Tests (`packages/db/src/pg.int.test.ts`, run in CI by the db package's `test:int`)

- 30 queries at once on a 2-connection pool, through the proxy modelling a transaction pooler's backend release, all
  answer.
- A frozen socket fails within `query_timeout`, and the pool answers afterwards.
- A transaction whose statement outlasts `query_timeout` while the server stays alive has its client closed. That
  client's backend never serves another query, and its session is gone from `pg_stat_activity`.
- The wait for a free client is bounded by `connectionTimeoutMillis`.

The full integration suite (212 tests) passes on pg. A CI job against a real PgBouncer in transaction mode is a
possible follow-up.

## Timeouts and dead connections

| Layer | What it catches | Decision |
| ----- | --------------- | -------- |
| Client `query_timeout` (pg) | A lost reply, a half-open socket, a pooler stall: anything where no reply comes. | 15 s, above the server's 10 s, so it only fires when no reply comes at all. A timed-out write may still have committed, so a caller that retries one must be idempotent. |
| Server `statement_timeout` | A statement the server is still running, including a lock wait (`usage.ts`, `billing/service.ts`, `jobs/admin.ts`). | **D4, applied 2026-11-09** on staging and production: `ALTER ROLE postgres SET statement_timeout = '10s'` (was 120 s from `postgresql.conf`, which fired at 14:14). The server ends a long statement first, and its transaction rolls back cleanly. Not a client option: pg would send it as a startup parameter, which PgBouncer rejects and Supavisor ignores. Migrations run as `postgres` too: a statement that may exceed 10 s sets `SET LOCAL statement_timeout` next to its `SET LOCAL lock_timeout`. The Supabase SQL editor is capped too unless a query runs `SET` first. |
| Server `idle_in_transaction_session_timeout` | A transaction whose client went away mid-way, still holding locks (for example `lockQuota`'s advisory lock). | **D4, applied 2026-11-09:** 15 s on the role (was 0). When the app's client closes a timed-out connection, direct Postgres ends that session; through a pooler, the pooler owns the backend, and this setting is what bounds it. |
| Pool `connectionTimeoutMillis` | Connecting, and waiting for a free client. | 10 s. |
| Idle sockets on serverless | A socket that sat idle while a Fluid instance was suspended can come back half-open. | `idleTimeoutMillis` 20 s and `keepAlive`. A half-open socket now ends at `query_timeout`, and its client is dropped. `pool.on("error")` stops a dying idle client from crashing the process. `@vercel/functions`' `attachDatabasePool` is an optional Vercel-only add-on, not used. |
| What the user sees | Any failed read. | Section boundaries with **Try again** on Home and the meter; the segment error pages elsewhere. |

**Portability.** Nothing changes between deployments. Direct Postgres (self-hosted Docker, RDS) and a transaction
pooler (PgBouncer, Supavisor, Neon) use the same driver settings. Only the connection-count arithmetic differs: behind
a pooler `DATABASE_POOL_MAX` counts against the pooler's client limit, and direct it counts against
`max_connections`. The D4 role settings are plain Postgres and apply the same way everywhere: a self-hosted deployment runs them on
its app role (`docs/deployment.md`, Database).

How to check or undo D4, and what it affects: [db.md](../architecture/db.md#design-principles-and-invariants). The
long-lived pg_net worker keeps the settings it started with, which is harmless.

## Pool max 10

Supabase limits for this project (Nano/Micro compute; the Management API reports pool mode `transaction` and no
overrides, so the defaults apply): Postgres `max_connections` 60, Supavisor **200 client connections** and a **pool
size of 15** server connections for the app's user. With `DATABASE_POOL_MAX` 10, each Vercel instance opens up to 10
client connections. The worst case is instances × 10 ≤ 200, so **up to 20 concurrent instances**. Fluid compute serves
many requests per instance, and at today's traffic the pooler showed 4 backends. Server-side, Supavisor still
multiplexes onto its 15 backends whatever the client count, so `max_connections` (60; about 20 in use) isn't at risk.
Past 20 instances, new connections would be refused rather than hang (and fail within `connectionTimeoutMillis`). If
traffic grows toward that, set `DATABASE_POOL_MAX` lower or raise the pooler limits. The production env var isn't set,
so the code default applies.

## Query counts

Measured on the compose stack (`next dev`, a signed-in platform admin, one workspace with 8 receipts) through a TCP
proxy that logs every Parse. Counts are for a warm render: an instance's first render adds about 10 more while
per-process caches (settings, Better Auth) fill.

| Render | Before | After | Most started together (before → after) |
| ------ | ------ | ----- | --------------------------------------- |
| `/app` (Home, layout included) | 15 | 13 | 8 → 5 |
| `/admin` (Overview) | 9 | 9 | — |

With postgres.js, 8 statements starting together on a 5-connection pool meant 3 were pipelined on every Home
render. With pg they wait for a free client instead. Concurrent requests on one instance share the pool, so even a
lean Home can exceed `max` under load; the driver must not pipeline either way.
The DB review (#208) counted 17 with different data. The same repeats show up in both counts.

Folded into this PR (cheap, no behaviour change):

- Home's recent list no longer counts every matching receipt for a total it never shows (`listRecentReceipts`;
  `repo.list` takes `total: false`).
- The workspace allowance takes "workspaces you own" from the switcher's per-request list (now with the member's
  role) instead of its own `count(*)` on `member`.

Checked and already fine: no N+1 on either page, and no statement repeats within a render (`cache()` dedupes).
Plan limits and OCR settings are cached per process for 30 s (`Settings`) and dropped when an admin saves.
`getCheckoutConfig` reads env only.

Left as follow-ups, because each is more than a cheap merge:

- `member` is still read three times in a Home render: active scope, the switcher list, and "is this workspace
  shared" for the security nudge. Folding them means the scope resolver returns the membership list.
- Passkeys are counted twice: the security nudge (`hasStrongFactor`) and the security prompt both count them, and
  they never show together.
- `accountPlan` and `workspacePlan` are separate reads by design (account limits and workspace limits).

## Follow-ups

- **D4: done 2026-11-09** (owner approved; staging and production, verified in `pg_roles.rolconfig`).
- **A CI job against a real PgBouncer in transaction mode**, in addition to the proxy model.
- **Source maps in Sentry**, so frames like RECEIPT-OCR-2's `oR` are readable.
- **Vercel logs:** the token can't read request logs (403) and the runtime-log stream only shows live traffic. A log
  drain to Axiom (planned) would have shown the `page.render` durations hitting the max.
- #205 (transitions off) was a guess; the coordinator restores transitions separately once Home is confirmed stable.
