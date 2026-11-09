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
5. **It reproduces locally.** `packages/db/src/pool.int.test.ts` puts a TCP proxy between postgres.js and compose
   Postgres. The proxy drops the server's bytes after each ReadyForQuery(idle) until the client writes again, which is
   how a transaction-mode pooler releases a backend. With the app's settings (`prepare: false`, one connection), a
   parameter-less query followed by a parameterised one leaves the second **pending indefinitely**. The test asserts
   it is still pending after 2 s, and the backend sits in PARSE. With the fix, both answer.

[970]: https://github.com/porsager/postgres/issues/970

**Why this evening:** #184 added `getUpgradeOffer` to the layout and to two Home sections. One Home render now has
more reads in flight than the 5-connection pool (see [Query counts](#query-counts)), so pipelining went from rare to
most renders. A client navigation back to Home re-renders only the page segment, so its reads start together.

**What it wasn't:** a database or Supavisor outage (healthy, no errors besides the one above); #202's
`<ViewTransition>` or other client code (wrong shape of failure; #205 turned transitions off on a guess and didn't
address this); RECEIPT-OCR-1 (a browser DOM error on a public-page navigation, unrelated to data loading). A dead socket
on a resumed Fluid instance would also hang a query, but nothing in the evidence points to one; the fix covers that
case too.

## Root cause

postgres.js pipelines queries onto busy connections. Through Supabase's transaction-mode pooler, a pipelined query
can lose its reply. Nothing put a time limit on a query (postgres.js 3.4 has no query timeout), and Home's sections
had no error boundary. A lost reply therefore left every section that shared the read on its skeleton until Vercel's
maximum duration ended the response. #184 raised the per-render fan-out past the pool size, which made it frequent.

## Fix (this PR)

1. **No pipelining.** `gatedPool` (`packages/db/src/pool.ts`) lets at most `max` queries or transactions be in flight
   per process, so postgres.js always finds a free connection and never pipelines. Queries inside a transaction skip
   the gate: they run on the connection the transaction holds, and the pooler keeps that backend until COMMIT. So
   `lockQuota`'s advisory lock and the job claim can't deadlock on the gate their transaction holds. Code inside a
   transaction that queries through the outer `db` needs a second permit, as it needed a second connection before.
   If every permit is held that way, the queue deadline below ends the wait.
2. **A deadline on every query.** A query unanswered after `DATABASE_QUERY_TIMEOUT_MS` (default 15 s) rejects with
   `QueryTimeoutError`. postgres.js can't drop the one connection the query is stuck on, so the pool is replaced: new
   queries go to a fresh pool, and the old one gets 5 s to finish its other queries before it is closed. A query that
   waits 15 s for the gate also fails, but keeps the pool. A transaction's BEGIN and each of its queries are timed;
   its body as a whole is not.
3. **A visible error instead of an endless skeleton.** Each Home section (Upload, To check, Spending, Recent) and the
   sidebar usage meter sit in a `catchError` boundary (`components/section-error.tsx`). A failed or timed-out read
   shows "<Section> couldn't load." with **Try again**, which re-fetches only that section through `router.refresh()`.
   The title falls back to "Home". `/admin` already has `admin/error.tsx`, which the deadline now reaches.
4. **A wide event.** Every timeout logs `db.query_timeout` with `db.operation`, `db.table`, `db.statement_hash`
   (FNV-1a of the placeholder text), `db.phase` (`queue` or `query`), `db.timeout_ms`, `db.in_flight` and
   `db.queued`. The error itself reaches Sentry through the section boundary or `onRequestError` as before.
5. **Pool max 5 → 10** (owner's request; see below). This doesn't fix a stalled query. It only makes the gate queue
   less.

### Field audit (`db` group)

| Field               | Source                                                        | PII |
| ------------------- | ------------------------------------------------------------- | --- |
| `db.operation`      | First keyword of the statement, from a fixed list               | No  |
| `db.table`          | First table name after `from`/`into`/`update`/`join`            | No  |
| `db.statement_hash` | FNV-1a of the statement's placeholder text, never its values    | No  |
| `db.phase`          | Ours: `queue` or `query`                                        | No  |
| `db.timeout_ms`     | Config                                                          | No  |
| `db.in_flight`      | Gate counter                                                    | No  |
| `db.queued`         | Gate counter                                                    | No  |

### Reproduced before and after (compose, `next dev`)

A logging proxy in front of compose Postgres dropped the reply to `getReceiptCounts()`'s statement, which is the
owner's first report.

- **Deadline off** (`DATABASE_QUERY_TIMEOUT_MS=600000`, the same as production today): the `/app` response was still
  open when curl gave up at 60 s. The HTML never closed, and To check, Spending and Recent stayed skeletons.
- **Deadline 4 s:** the response closed after 4.27 s. React's stream marked exactly those three boundaries "switched
  to client rendering because the server rendering errored", which renders their "couldn't load" cards. One
  `db.query_timeout` event was logged.

Screenshots of the card at 390 and 1440 are pending. Playwright's Chromium can't start on this machine (a system
library is missing), so they'll come from a preview.

### What the gate counts, and module copies (DB review #208)

- **The gate counts connections in use, not statements.** A plain query holds a permit while it runs. A transaction
  holds one from BEGIN to COMMIT, for the connection it reserves, and its inner queries take none. So permits in use
  never exceed connections in use, and a transaction plus concurrent plain queries can't deadlock on the gate. The
  plain queries wait for a permit, then run on a free connection. The only way to wait on yourself is a transaction
  body that queries through the outer `db` while every other permit is taken. That was already a pool-exhaustion
  hazard; the queue deadline now ends it with a `phase: queue` timeout. `pool.int.test.ts` covers a transaction
  taking an advisory lock while an outer query waits, and the queue timeout.
- **One pool and one gate per process.** The pool map and the event listeners live on `globalThis` under
  `Symbol.for` keys, so every copy of `@receipt-ocr/db` that Next loads shares them. The `db.query_timeout`
  subscription is guarded the same way, so it isn't doubled.

### Abandoned work on the server

When the client deadline gives up, the server may still be working:

- **A lost reply** (this incident): the server has already finished the statement, or, as at 14:14, it sits waiting
  for the rest of the protocol. Production's 120 s `statement_timeout` ends that wait.
- **A slow statement:** it keeps running until it finishes or hits the 120 s `statement_timeout`. The PR doesn't send
  a cancel request. postgres.js's `cancel()` fires its request without a handle to catch a failure, which would risk
  an unhandled rejection.
- **An abandoned transaction** (for example one holding `lockQuota`'s advisory lock): the pool reset closes the old
  pool's sockets 5 s later. Directly against Postgres, a closed socket aborts the session and releases its locks
  (Postgres behaviour; not asserted by a test here). Through Supavisor, the pooler owns the backend. When the
  client disconnects mid-transaction, the backend should be rolled back before reuse, but that wasn't verified
  against Supavisor. `idle_in_transaction_session_timeout` is 0 in production, so nothing else bounds an orphaned
  transaction.
- **Owner decision D4 (not applied here):** role-level `statement_timeout` and `idle_in_transaction_session_timeout`
  for `postgres`. Both close these gaps server-side.

## Timeouts and dead connections

Each layer, and why it is or isn't used:

| Layer | What it catches | Decision |
| ----- | --------------- | -------- |
| Postgres `statement_timeout` | A query the server received and is still working on, or waiting on mid-protocol (the 14:14 case). Not a reply lost on the way back, and not a dead socket. | Already 120 s on production (`postgresql.conf`), and it fired at 14:14. On compose, both the startup parameter (`connection: { statement_timeout }`) and `SET LOCAL` inside a transaction take effect. Through Supavisor's transaction mode a startup parameter can't apply per client, since backends are shared, and it wasn't tested there. `SET LOCAL` would cost a round trip per transaction. **Proposal, not applied:** `ALTER ROLE postgres SET statement_timeout = '30s'` would bound runaway queries tighter. It also applies to migrations and admin SQL run as `postgres` (a migration can `SET` its own). Owner decision; this incident doesn't need it. |
| Client deadline (this PR) | Everything else: a lost reply, a half-open socket, a pooler stall. | `gatedPool`, 15 s by default: well above any query's normal time (Home's reads take milliseconds) and well below the function's maximum duration. postgres.js 3.4 has no query or queue timeout option (v4 adds `queue_timeout`). A timed-out connection is never reused, because the whole pool is replaced. |
| postgres.js lifecycle on Fluid | Sockets that sat idle while an instance was suspended can come back half-open. `idle_timeout: 20` can't fire while suspended, and `keep_alive` (60 s TCP keepalive, the default) only probes a socket the kernel is running. | Kept as they are: `idle_timeout: 20`, the default `max_lifetime` (30–60 min, randomised), the default `keep_alive`. A half-open socket now ends at the deadline with a fresh pool instead of hanging. `@vercel/functions`' `attachDatabasePool` would keep an instance alive until idle connections close. It's an option but not a dependency today, and adding it needs the owner's OK. |
| What the user sees | Any failed read. | Section boundaries with **Try again** on Home and the meter; the segment error pages elsewhere. |
| Observability | — | `db.query_timeout` wide event (above). |

## Pool max 10

Supabase limits for this project (Nano/Micro compute; the Management API reports pool mode `transaction` and no
overrides, so the defaults apply): Postgres `max_connections` 60, Supavisor **200 client connections** and a **pool
size of 15** server connections for the app's user. With `DATABASE_POOL_MAX` 10, each Vercel instance opens up to 10
client connections. The worst case is instances × 10 ≤ 200, so **up to 20 concurrent instances**. Fluid compute
serves many requests per instance, and at today's traffic the pooler showed 4 backends. Server-side, Supavisor still
multiplexes onto its 15 backends whatever the client count, so `max_connections` (60; about 20 in use) isn't at risk.
Past 20 instances, new connections would be refused with a pooler error rather than hang. If traffic grows toward that,
set `DATABASE_POOL_MAX` lower in Vercel or raise the pooler limits. The production env var isn't set, so the code
default applies.

**The gate stays necessary after the efficiency pass.** Concurrent requests on one Fluid instance share its pool, so
even a lean Home goes past `max` in flight under load. Without the gate, postgres.js would pipeline again.

## Query counts

Measured on the compose stack (`next dev`, a signed-in platform admin, one workspace with 8 receipts) through a TCP
proxy that logs every Parse. Counts are for a warm render: an instance's first render adds about 10 more while
per-process caches (settings, Better Auth) fill.

| Render | Before | After | Most started together (before → after) |
| ------ | ------ | ----- | --------------------------------------- |
| `/app` (Home, layout included) | 15 | 13 | 8 → 5 |
| `/admin` (Overview) | 9 | 9 | — |

Before the fix, 8 statements starting together on a 5-connection pool meant 3 were pipelined on every Home render.
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

- **postgres.js v4** (maintainer: pool rewritten, tested through PgBouncer transaction mode, adds `queue_timeout`): a
  major upgrade, owner decision. With it the gate may become unnecessary, which would need a re-test through the proxy
  test here.
- **Source maps in Sentry**, so frames like RECEIPT-OCR-2's `oR` are readable.
- **Vercel logs:** the token can't read request logs (403) and the runtime-log stream only shows live traffic. A log
  drain to Axiom (planned) would have shown the `page.render` durations hitting the max.
- **Optional:** `ALTER ROLE postgres SET statement_timeout = '30s'` (see above).
- #205 (transitions off) was a guess; the coordinator restores transitions separately once Home is confirmed stable.
