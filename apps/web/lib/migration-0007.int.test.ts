/**
 * Migration 0007 (no default on billing_subscriptions.plan) on a scratch database next to DATABASE_URL's: no table
 * rewrite, existing rows keep their plan, and a row inserted without one is refused. Skipped unless INTEGRATION=1.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.INTEGRATION === "1";
const dir = path.join(import.meta.dirname, "..", "drizzle");
const scratch = `migration_0007_probe_${process.pid}`;
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const target = files.find((f) => f.startsWith("0007_"))!;
const sqlOf = (file: string) => readFileSync(path.join(dir, file), "utf8");

describe.skipIf(!enabled)("migration 0007 on existing rows", () => {
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
  const insertWithoutPlan = (id: string) =>
    db`insert into billing_subscriptions (organization_id, user_id, provider,
      provider_subscription_id, provider_customer_id, status, price_id, provider_updated_at)
      values ('o1', 'u1', 'paddle', ${id}, 'ctm_1', 'active', 'pri_1', now())`;

  beforeAll(async () => {
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.unsafe(`create database ${scratch}`);
    for (const file of files.filter((f) => f < target)) await db.unsafe(sqlOf(file));

    await db`insert into "user" (id, name, email) values ('u1', 'Test', 'test@example.com')`;
    await db`insert into organization (id, name, slug) values ('o1', 'Test', 'test')`;
    await insertWithoutPlan("sub_before");
    fileNode = await relfilenode();

    await db.begin((tx) => tx.unsafe(sqlOf(target)));
  });

  afterAll(async () => {
    await db.end();
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.end();
  });

  it("drops the default without rewriting the table or touching existing rows", async () => {
    expect(await relfilenode()).toBe(fileNode);
    const [row] =
      await db`select plan from billing_subscriptions where provider_subscription_id = 'sub_before'`;
    expect(row?.plan).toBe("pro");
  });

  it("refuses a row that doesn't set its plan", async () => {
    await expect(insertWithoutPlan("sub_after")).rejects.toMatchObject({ code: "23502" });
  });
});
