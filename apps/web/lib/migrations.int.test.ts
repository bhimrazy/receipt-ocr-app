/**
 * Migration 0008's backfill, on a scratch database next to DATABASE_URL's:
 * apply 0000-0007, seed receipts in every state, apply 0008, check what each
 * became. Skipped unless INTEGRATION=1.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.INTEGRATION === "1";
const dir = path.join(import.meta.dirname, "..", "drizzle");
const scratch = `migrations_probe_${process.pid}`;

const ids = {
  fresh: "00000000-0000-4000-8000-000000000001",
  old: "00000000-0000-4000-8000-000000000002",
  orphan: "00000000-0000-4000-8000-000000000003",
  done: "00000000-0000-4000-8000-000000000004",
  uploaded: "00000000-0000-4000-8000-000000000005",
};

describe.skipIf(!enabled)("migration 0008 backfill", () => {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://localhost/x");
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const scratchUrl = new URL(url);
  scratchUrl.pathname = `/${scratch}`;
  const db = postgres(scratchUrl.toString(), { max: 1, onnotice: () => {} });
  const apply = async (prefix: (name: string) => boolean) => {
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && prefix(f))
      .sort()) {
      await db.unsafe(readFileSync(path.join(dir, file), "utf8"));
    }
  };

  beforeAll(async () => {
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.unsafe(`create database ${scratch}`);
  });

  afterAll(async () => {
    await db.end();
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.end();
  });

  it("settles old or orphaned work as failed and gives recent work a job", async () => {
    await apply((f) => f < "0008");
    await db`insert into "user" (id, name, email, email_verified) values ('u1', 'U', 'u1@x.test', true)`;
    await db`insert into organization (id, name, slug, created_at) values ('o1', 'O', 'o1', now())`;
    await db`insert into receipts (id, organization_id, user_id, status, attempts, updated_at) values
      (${ids.fresh}, 'o1', 'u1', 'processing', 2, now()),
      (${ids.old}, 'o1', 'u1', 'processing', 1, now() - interval '2 hours'),
      (${ids.orphan}, 'o1', null, 'processing', 1, now()),
      (${ids.done}, 'o1', 'u1', 'completed', 1, now()),
      (${ids.uploaded}, 'o1', 'u1', 'uploaded', 1, now())`;
    await db`insert into ocr_calls (receipt_id, organization_id, user_id, round, step, status, latency_ms)
      values (${ids.done}, 'o1', 'u1', 1, 0, 'ok', 5)`;
    await apply((f) => f.startsWith("0008"));

    const statuses = await db`select id, status from receipts order by id`;
    expect(Object.fromEntries(statuses.map((r) => [r.id, r.status]))).toEqual({
      [ids.fresh]: "processing",
      [ids.old]: "failed",
      [ids.orphan]: "failed",
      [ids.done]: "completed",
      [ids.uploaded]: "failed",
    });
    const jobs =
      await db`select kind, state, receipt_id, user_id, payload, idempotency_key, max_attempts from jobs`;
    expect(jobs).toEqual([
      {
        kind: "receipt.extract",
        state: "queued",
        receipt_id: ids.fresh,
        user_id: "u1",
        payload: { receiptId: ids.fresh, organizationId: "o1", userId: "u1", round: 2 },
        idempotency_key: `receipt:${ids.fresh}:round:2`,
        max_attempts: 4,
      },
    ]);
    const [call] = await db`select job_attempt from ocr_calls`;
    expect(call?.job_attempt).toBe(1);
    const [table] = await db`select reloptions from pg_class where relname = 'jobs'`;
    expect(table?.reloptions).toContain("fillfactor=80");
    const indexes = await db`select indexname from pg_indexes where tablename = 'ocr_calls'`;
    expect(indexes.map((i) => i.indexname)).toContain("ocr_calls_receipt_round_attempt_step_idx");
    expect(indexes.map((i) => i.indexname)).not.toContain("ocr_calls_receipt_round_step_idx");
  });
});
