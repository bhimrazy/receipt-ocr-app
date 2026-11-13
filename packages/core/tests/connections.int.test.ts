/**
 * Check connections against real Postgres and S3 (RustFS locally). Skipped
 * unless INTEGRATION=1; see receipts.int.test.ts for the setup.
 */
import { adminAuditLog, and, eq, sql, user } from "@receipt-ocr/db";
import { Effect, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppLayer, type AppServices } from "../src/index";
import { checkConnections, checkStorage } from "../src/connections";
import { Db } from "../src/services";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

const adminId = `conn-admin-${Date.now()}`;
const audit = { actor: { id: adminId, email: `${adminId}@example.com` }, ip: null };

describe.skipIf(!enabled)("connections (integration)", () => {
  beforeAll(async () => {
    await db((d) =>
      d.insert(user).values({
        id: adminId,
        name: "Conn admin",
        email: audit.actor.email,
        emailVerified: true,
      }),
    );
  });

  afterAll(async () => {
    await db((d) => d.delete(adminAuditLog).where(eq(adminAuditLog.actorId, adminId)));
    await db((d) => d.delete(user).where(eq(user.id, adminId)));
    await db((d) =>
      d.execute(sql`delete from rate_limit where key like ${`%${adminId}%`}`).then((r) => r.rows),
    );
    await runtime.dispose();
  });

  it("round-trips a probe object through the real bucket", async () => {
    const row = await run(checkStorage);
    expect(row).toMatchObject({ id: "storage", status: "ok" });
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("runs once, records statuses only, and limits the next run", async () => {
    const first = await run(checkConnections(audit));
    expect(Array.isArray(first)).toBe(true);
    const rows = await db((d) =>
      d
        .select()
        .from(adminAuditLog)
        .where(
          and(eq(adminAuditLog.actorId, adminId), eq(adminAuditLog.action, "connections.check")),
        ),
    );
    expect(rows).toHaveLength(1);
    expect(Object.keys((rows[0]!.metadata as { statuses: object }).statuses)).toContain("storage");

    const second = await run(checkConnections(audit));
    expect(second).toMatchObject({ limited: true });
    expect((second as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
  });
});
