/**
 * Migration 0005 (the plan and paid transaction on billing subscriptions) against rows written before it, on a
 * scratch database next to DATABASE_URL's: no table rewrite, every existing row on Pro, and the checkout's
 * transaction recorded as the paid one where there is a checkout. Skipped unless INTEGRATION=1.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.INTEGRATION === "1";
const dir = path.join(import.meta.dirname, "..", "..", "drizzle");
const scratch = `migration_0005_probe_${process.pid}`;
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const target = files.find((f) => f.startsWith("0005_"))!;
const sqlOf = (file: string) => readFileSync(path.join(dir, file), "utf8");

describe.skipIf(!enabled)("migration 0005 on existing rows", () => {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://localhost/x");
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const scratchUrl = new URL(url);
  scratchUrl.pathname = `/${scratch}`;
  const db = postgres(scratchUrl.toString(), { max: 1, onnotice: () => {} });
  let fileNode = 0;

  const relfilenode = async () =>
    Number(
      (await db`select relfilenode from pg_class where relname = 'billing_subscriptions'`)[0]!
        .relfilenode,
    );

  beforeAll(async () => {
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.unsafe(`create database ${scratch}`);
    for (const file of files.filter((f) => f < target)) await db.unsafe(sqlOf(file));

    await db`insert into "user" (id, name, email) values ('u1', 'Test', 'test@example.com')`;
    await db`insert into organization (id, name, slug) values ('o1', 'Test', 'test')`;
    for (const sub of ["sub_checkout", "sub_older"]) {
      await db`insert into billing_subscriptions (organization_id, user_id, provider,
        provider_subscription_id, provider_customer_id, status, price_id, provider_updated_at)
        values ('o1', 'u1', 'paddle', ${sub}, 'ctm_1', 'active', 'pri_old', now())`;
    }
    await db`insert into billing_checkouts (provider, provider_transaction_id, organization_id,
      user_id, provider_customer_id, price_id, provider_subscription_id)
      values ('paddle', 'txn_1', 'o1', 'u1', 'ctm_1', 'pri_old', 'sub_checkout')`;
    fileNode = await relfilenode();

    await db.begin((tx) => tx.unsafe(sqlOf(target)));
  });

  afterAll(async () => {
    await db.end();
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.end();
  });

  it("adds the columns without rewriting the table", async () => {
    expect(await relfilenode()).toBe(fileNode);
  });

  it("puts every existing subscription on Pro and records the checkout's transaction as paid", async () => {
    const rows = await db`select provider_subscription_id as id, plan, paid_transaction_id,
      paid_period_start from billing_subscriptions order by provider_subscription_id`;
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { id: "sub_checkout", plan: "pro", paid_transaction_id: "txn_1", paid_period_start: null },
      { id: "sub_older", plan: "pro", paid_transaction_id: null, paid_period_start: null },
    ]);
  });

  it("defaults a row written by code that doesn't know the column to Pro", async () => {
    await db`insert into billing_subscriptions (organization_id, user_id, provider,
      provider_subscription_id, provider_customer_id, status, price_id, provider_updated_at)
      values ('o1', 'u1', 'paddle', 'sub_new', 'ctm_1', 'active', 'pri_1', now())`;
    const [row] =
      await db`select plan from billing_subscriptions where provider_subscription_id = 'sub_new'`;
    expect(row?.plan).toBe("pro");
  });
});
