---
name: database
description: Rules for any Receipt OCR change that touches the database — queries, transactions, the pool, timeouts, schema or migrations. Load before editing packages/db, a repository or job query, a page's data loading, or a migration.
---

# Database work

The details live in [docs/architecture/db.md](../../../docs/architecture/db.md). These are the rules that keep it
simple and portable.

1. **Portable Postgres only.** Code must run unchanged on direct Postgres (Docker, RDS), PgBouncer, Supabase and Neon.
   No provider-specific behaviour, no startup-parameter settings, no workarounds wrapped around the driver. If a driver
   misbehaves, change the configuration or the driver, not the plumbing.
2. **The pool is node-postgres, created once in `createPool`.** Don't create another pool or client. Timeouts are pg's
   own (`query_timeout` 15 s, `connectionTimeoutMillis` 10 s). The server limits are role settings (`statement_timeout`
   10 s, `idle_in_transaction_session_timeout` 15 s), always below the client's, and are a setup step for every new
   database.
3. **Keep transactions short.** No network calls (R2, the model, Paddle, email) inside a transaction or while holding an
   advisory lock. Writes that can be retried must be idempotent: a timed-out write may still have committed.
4. **Every streamed section can fail.** A Suspense section that reads the database has an error state with Try again
   (`SectionBoundary` in `apps/web/components/section-error.tsx`), never an endless skeleton. Next's own signals pass through (`unstable_rethrow`).
5. **Query budget per page.** When a page's data loading changes, count its statements (Home is about 13) and don't
   start more at once than the pool holds. Share per-request reads through `cache()`. No N+1, no `COUNT(*)` that the
   page doesn't show.
6. **Measure, don't guess.** For a new or changed hot query, run `EXPLAIN (ANALYZE, BUFFERS)` on seeded volume and
   check the index it uses. Scope every tenant query by `organization_id`.
7. **Safe migrations.** Through the Database Migration workflow only, never on deploy. Start with
   `SET LOCAL lock_timeout`, and add `SET LOCAL statement_timeout` for anything that may run past 10 s (index builds,
   backfills). Old code must keep working against the new schema until the deploy.
8. **Prove it in CI.** Behaviour that depends on Postgres goes in an `*.int.test.ts` that CI runs (`test:int` in the
   package, listed in `ci.yml`).

Background: [Home incident](../../../docs/reviews/2026-11-09-home-stuck-incident.md),
[database review](../../../docs/reviews/2026-11-09-database-review.md).
