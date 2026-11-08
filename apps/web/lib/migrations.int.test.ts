/**
 * The baseline migration on a scratch database next to DATABASE_URL's: apply it
 * to an empty database, then check what drizzle cannot guarantee by itself
 * (hand-written storage parameters) and the constraints and indexes the code
 * relies on. Skipped unless INTEGRATION=1.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.INTEGRATION === "1";
const dir = path.join(import.meta.dirname, "..", "drizzle");
const scratch = `migrations_probe_${process.pid}`;

describe.skipIf(!enabled)("baseline migration on an empty database", () => {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://localhost/x");
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const scratchUrl = new URL(url);
  scratchUrl.pathname = `/${scratch}`;
  const db = postgres(scratchUrl.toString(), { max: 1, onnotice: () => {} });

  beforeAll(async () => {
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.unsafe(`create database ${scratch}`);
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      await db.unsafe(readFileSync(path.join(dir, file), "utf8"));
    }
  });

  afterAll(async () => {
    await db.end();
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.end();
  });

  it("creates every table with row-level security", async () => {
    const rows = await db`select c.relname, c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`;
    expect(rows.length).toBeGreaterThanOrEqual(19);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("keeps the jobs storage parameters", async () => {
    const [table] = await db`select reloptions from pg_class where relname = 'jobs'`;
    expect(table?.reloptions).toContain("fillfactor=80");
    expect(table?.reloptions).toContain("autovacuum_vacuum_scale_factor=0.02");
  });

  it("keeps the check constraints", async () => {
    const rows =
      await db`select conname from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace`;
    expect(rows.map((r) => r.conname).sort()).toEqual([
      "jobs_attempts_check",
      "jobs_last_error_kind_check",
      "ocr_calls_status_check",
      "step_up_events_method_check",
      "step_up_events_outcome_check",
    ]);
  });

  it("keeps the partial and expression unique indexes the queue and groups rely on", async () => {
    const rows = await db`select indexname, indexdef from pg_indexes where schemaname = 'public'`;
    const def = (name: string) => rows.find((r) => r.indexname === name)?.indexdef ?? "";
    expect(def("jobs_idempotency_idx")).toMatch(/UNIQUE.*WHERE/);
    expect(def("jobs_receipt_live_idx")).toMatch(/UNIQUE.*WHERE/);
    expect(def("jobs_runnable_idx")).toMatch(/WHERE/);
    expect(def("jobs_running_idx")).toMatch(/WHERE/);
    expect(def("receipt_groups_org_name_idx")).toMatch(/UNIQUE.*lower/);
    expect(def("ocr_calls_receipt_round_attempt_step_idx")).toMatch(/UNIQUE/);
    expect(def("ocr_calls_receipt_round_step_idx")).toBe("");
  });
});
