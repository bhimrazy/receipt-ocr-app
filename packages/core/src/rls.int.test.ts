/**
 * Row-level security against real Postgres. Skipped unless INTEGRATION=1; run with
 * `bun run --filter @receipt-ocr/core test:int` after `bun run db:migrate`.
 */
import { eq, organization, sql } from "@receipt-ocr/db";
import { Effect, ManagedRuntime } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { AppLayer, type AppServices } from "./index";
import { Db } from "./services";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

describe.skipIf(!enabled)("row-level security against Postgres", () => {
  afterAll(() => runtime.dispose());

  it("is enabled, not forced, on every public table", async () => {
    const rows = await db((d) =>
      d.execute<{ name: string; rls: boolean; forced: boolean }>(sql`
        select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
        order by c.relname`),
    );
    expect(rows.length).toBeGreaterThanOrEqual(19);
    // Lists offenders, so a new table without RLS is named in the failure.
    expect(rows.filter((r) => !r.rls).map((r) => r.name)).toEqual([]);
    // FORCE would apply RLS to the owner role the app connects as.
    expect(rows.filter((r) => r.forced).map((r) => r.name)).toEqual([]);
  });

  it("is owned by the app role, which is what lets it through RLS", async () => {
    const rows = await db((d) =>
      d.execute<{ n: number }>(sql`select count(*)::int as n from pg_tables
        where schemaname = 'public' and tableowner <> current_user`),
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("lets the app role read and write", async () => {
    const id = `rls-${Date.now()}`;
    const slug = id;
    await db((d) =>
      d.insert(organization).values({ id, name: "RLS", slug, createdAt: new Date() }),
    );
    const found = await db((d) => d.select().from(organization).where(eq(organization.id, id)));
    expect(found).toHaveLength(1);
    await db((d) => d.delete(organization).where(eq(organization.id, id)));
    const gone = await db((d) => d.select().from(organization).where(eq(organization.id, id)));
    expect(gone).toHaveLength(0);
  });
});
