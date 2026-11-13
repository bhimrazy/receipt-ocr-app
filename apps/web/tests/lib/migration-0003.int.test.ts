/**
 * Migration 0003 (receipt fields) against rows written before it, on a scratch database next to DATABASE_URL's:
 * the backfills keep today's "needs review" set and line order, a second run changes nothing, and the new CHECKs
 * are added NOT VALID. Skipped unless INTEGRATION=1.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.INTEGRATION === "1";
const dir = path.join(import.meta.dirname, "..", "..", "drizzle");
const scratch = `migration_0003_probe_${process.pid}`;
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const target = files.find((f) => f.startsWith("0003_"))!;
const sqlOf = (file: string) => readFileSync(path.join(dir, file), "utf8");

describe.skipIf(!enabled)("migration 0003 on existing rows", () => {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://localhost/x");
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const scratchUrl = new URL(url);
  scratchUrl.pathname = `/${scratch}`;
  const db = postgres(scratchUrl.toString(), { max: 1, onnotice: () => {} });
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.unsafe(`create database ${scratch}`);
    for (const file of files.filter((f) => f < target)) await db.unsafe(sqlOf(file));

    await db`insert into "user" (id, name, email) values ('u1', 'Test', 'test@example.com')`;
    await db`insert into organization (id, name, slug) values ('o1', 'Test', 'test')`;
    for (const [key, status, confidence] of [
      ["low", "completed", "0.8500"],
      ["high", "completed", "0.9500"],
      ["processing", "processing", "0.5000"],
    ] as const) {
      const [row] = await db`insert into receipts (organization_id, user_id, status, confidence)
        values ('o1', 'u1', ${status}, ${confidence}) returning id`;
      ids[key] = row!.id;
    }
    for (const name of ["first", "second", "third"]) {
      await db`insert into receipt_items (receipt_id, name) values (${ids.low!}, ${name})`;
    }
    await db`insert into receipt_items (receipt_id, name) values (${ids.high!}, 'only')`;

    await db.begin((tx) => tx.unsafe(sqlOf(target)));
  });

  afterAll(async () => {
    await db.end();
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.end();
  });

  const reasons = async () =>
    Object.fromEntries(
      (await db`select id, review_reasons from receipts`).map((r) => [r.id, r.review_reasons]),
    );
  const order = async () =>
    (
      await db`select receipt_id, name, position from receipt_items
        order by receipt_id = ${ids.low!} desc, position, id`
    ).map((r) => [r.receipt_id === ids.low ? "low" : "high", r.name, r.position]);

  it("flags what the old confidence rule flagged, and nothing else", async () => {
    expect(await reasons()).toEqual({
      [ids.low!]: ["low_confidence"],
      [ids.high!]: [],
      [ids.processing!]: [],
    });
  });

  it("numbers line items in the order they were stored", async () => {
    expect(await order()).toEqual([
      ["low", "first", 0],
      ["low", "second", 1],
      ["low", "third", 2],
      ["high", "only", 0],
    ]);
  });

  it("changes nothing when its backfills run again", async () => {
    const [before, items] = [await reasons(), await order()];
    const updates = sqlOf(target)
      .split("--> statement-breakpoint")
      .map((statement) =>
        statement
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((statement) => statement.startsWith("UPDATE"));
    expect(updates).toHaveLength(2);
    for (const statement of updates) await db.unsafe(statement);
    expect(await reasons()).toEqual(before);
    expect(await order()).toEqual(items);
  });

  it("adds every CHECK as NOT VALID, still enforced on new writes", async () => {
    const rows = await db`select conname, convalidated from pg_constraint
      where conname in ('receipts_receipt_date_calendar_check', 'receipts_invoice_number_check',
        'receipts_merchant_tax_id_check', 'receipts_discount_check', 'receipts_service_charge_check',
        'receipt_items_position_check') order by conname`;
    expect(rows.map((r) => [r.conname, r.convalidated])).toEqual([
      ["receipt_items_position_check", false],
      ["receipts_discount_check", false],
      ["receipts_invoice_number_check", false],
      ["receipts_merchant_tax_id_check", false],
      ["receipts_receipt_date_calendar_check", false],
      ["receipts_service_charge_check", false],
    ]);
    await expect(
      db`update receipts set receipt_date_calendar = 'bs' where id = ${ids.high!}`,
    ).rejects.toThrow(/receipts_receipt_date_calendar_check/);
  });
});
