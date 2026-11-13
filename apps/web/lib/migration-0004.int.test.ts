/**
 * Migration 0004 (billing checkouts) against rows written before it, on a scratch database next to DATABASE_URL's:
 * it validates the 0003 CHECKs without rewriting the tables, repeats the `low_confidence` backfill for receipts
 * completed by pre-0003 code, and adds `billing_checkouts`. Skipped unless INTEGRATION=1.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.INTEGRATION === "1";
const dir = path.join(import.meta.dirname, "..", "drizzle");
const scratch = `migration_0004_probe_${process.pid}`;
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const target = files.find((f) => f.startsWith("0004_"))!;
const sqlOf = (file: string) => readFileSync(path.join(dir, file), "utf8");
const CHECKS = [
  "receipt_items_position_check",
  "receipts_discount_check",
  "receipts_invoice_number_check",
  "receipts_merchant_tax_id_check",
  "receipts_receipt_date_calendar_check",
  "receipts_service_charge_check",
];

describe.skipIf(!enabled)("migration 0004 on existing rows", () => {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://localhost/x");
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const scratchUrl = new URL(url);
  scratchUrl.pathname = `/${scratch}`;
  const db = postgres(scratchUrl.toString(), { max: 1, onnotice: () => {} });
  const ids: Record<string, string> = {};
  let fileNodes: Record<string, number> = {};

  const relfilenodes = async () =>
    Object.fromEntries(
      (
        await db`select relname, relfilenode from pg_class
          where relname in ('receipts', 'receipt_items')`
      ).map((r) => [r.relname, Number(r.relfilenode)]),
    );

  beforeAll(async () => {
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.unsafe(`create database ${scratch}`);
    for (const file of files.filter((f) => f < target)) await db.unsafe(sqlOf(file));

    await db`insert into "user" (id, name, email) values ('u1', 'Test', 'test@example.com')`;
    await db`insert into organization (id, name, slug) values ('o1', 'Test', 'test')`;
    // `late`: completed by pre-0003 code after 0003 ran, so its review_reasons kept the default.
    for (const [key, status, confidence, reasons] of [
      ["late", "completed", "0.8000", "{}"],
      ["flagged", "completed", "0.9500", "{total_mismatch}"],
      ["clean", "completed", "0.9500", "{}"],
    ] as const) {
      const [row] =
        await db`insert into receipts (organization_id, user_id, status, confidence, review_reasons)
        values ('o1', 'u1', ${status}, ${confidence}, ${reasons}) returning id`;
      ids[key] = row!.id;
    }
    await db`insert into receipt_items (receipt_id, name, position) values (${ids.late!}, 'only', 0)`;
    fileNodes = await relfilenodes();

    await db.begin((tx) => tx.unsafe(sqlOf(target)));
  });

  afterAll(async () => {
    await db.end();
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.end();
  });

  it("validates every 0003 CHECK without rewriting the tables", async () => {
    const rows = await db`select conname, convalidated from pg_constraint
      where conname in ${db(CHECKS)} order by conname`;
    expect(rows.map((r) => [r.conname, r.convalidated])).toEqual(CHECKS.map((c) => [c, true]));
    expect(await relfilenodes()).toEqual(fileNodes);
  });

  it("flags receipts the old confidence rule flagged, and leaves the rest as they were", async () => {
    const rows = await db`select id, review_reasons from receipts`;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.review_reasons]))).toEqual({
      [ids.late!]: ["low_confidence"],
      [ids.flagged!]: ["total_mismatch"],
      [ids.clean!]: [],
    });
  });

  it("adds billing_checkouts: one row per transaction, gone with its workspace or buyer", async () => {
    const [table] =
      await db`select relrowsecurity from pg_class where relname = 'billing_checkouts'`;
    expect(table?.relrowsecurity).toBe(true);
    const checkout = (txn: string) => db`insert into billing_checkouts
      (provider, provider_transaction_id, organization_id, user_id, provider_customer_id, price_id)
      values ('paddle', ${txn}, 'o1', 'u1', 'ctm_1', 'pri_1')`;
    await checkout("txn_1");
    await expect(checkout("txn_1")).rejects.toThrow(/billing_checkouts_provider_transaction_idx/);
    await db`delete from receipts`;
    await db`delete from "user" where id = 'u1'`;
    expect(await db`select 1 from billing_checkouts`).toHaveLength(0);
  });
});
