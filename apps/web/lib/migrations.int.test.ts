/**
 * The baseline migration on a scratch database next to DATABASE_URL's: apply it
 * to an empty database, then check what drizzle cannot guarantee by itself
 * (hand-written storage parameters) and the tables, constraints and indexes the
 * code and the reset SQL rely on. Skipped unless INTEGRATION=1.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.INTEGRATION === "1";
const dir = path.join(import.meta.dirname, "..", "drizzle");
const scratch = `migrations_probe_${process.pid}`;
// The reset SQL in docs/deployment.md drops exactly these tables: update both together.
const tables = [
  "account",
  "admin_audit_log",
  "app_settings",
  "billing_checkouts",
  "billing_events",
  "billing_subscriptions",
  "invitation",
  "job_controls",
  "jobs",
  "member",
  "ocr_calls",
  "ocr_rounds",
  "organization",
  "passkey",
  "rate_limit",
  "receipt_group_members",
  "receipt_groups",
  "receipt_items",
  "receipts",
  "session",
  "step_up_codes",
  "step_up_events",
  "two_factor",
  "user",
  "user_credentials",
  "verification",
];

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

  it("is the baseline, billing, receipt review, receipt fields, billing checkouts and billing plan", () => {
    const journal = JSON.parse(readFileSync(path.join(dir, "meta", "_journal.json"), "utf8"));
    expect(journal.entries.map((e: { tag: string }) => e.tag)).toEqual([
      "0000_baseline",
      "0001_billing",
      "0002_receipt_review",
      "0003_receipt_fields",
      "0004_billing_checkouts",
      "0005_billing_plan",
    ]);
  });

  it("creates every table with row-level security, and the two enum types", async () => {
    const rows = await db`select c.relname, c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by c.relname`;
    expect(rows.map((r) => r.relname)).toEqual(tables);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
    const types =
      await db`select typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typtype = 'e' order by typname`;
    expect(types.map((t) => t.typname)).toEqual(["job_state", "receipt_status"]);
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
      "billing_events_outcome_check",
      "billing_subscriptions_interval_check",
      "billing_subscriptions_status_check",
      "jobs_attempts_check",
      "jobs_last_error_kind_check",
      "ocr_calls_status_check",
      "ocr_rounds_plan_check",
      "receipt_items_position_check",
      "receipt_items_quantity_check",
      "receipts_attempts_check",
      "receipts_currency_check",
      "receipts_discount_check",
      "receipts_invoice_number_check",
      "receipts_merchant_tax_id_check",
      "receipts_receipt_date_calendar_check",
      "receipts_receipt_date_check",
      "receipts_service_charge_check",
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
    // One stored row per provider event and per provider subscription.
    expect(def("billing_events_provider_event_idx")).toMatch(
      /UNIQUE.*\(provider, provider_event_id\)/,
    );
    expect(def("billing_subscriptions_provider_id_idx")).toMatch(
      /UNIQUE.*\(provider, provider_subscription_id\)/,
    );
    expect(def("billing_checkouts_provider_transaction_idx")).toMatch(
      /UNIQUE.*\(provider, provider_transaction_id\)/,
    );
  });

  it("types receipt_date as a date with a workspace index, and indexes the foreign keys deletes walk", async () => {
    const [column] =
      await db`select data_type from information_schema.columns where table_name = 'receipts' and column_name = 'receipt_date'`;
    expect(column?.data_type).toBe("date");
    const rows = await db`select indexname, indexdef from pg_indexes where schemaname = 'public'`;
    const def = (name: string) => rows.find((r) => r.indexname === name)?.indexdef ?? "";
    expect(def("receipts_org_receipt_date_idx")).toContain("(organization_id, receipt_date)");
    for (const [index, column] of [
      ["ocr_calls_user_id_idx", "user_id"],
      ["jobs_user_id_idx", "user_id"],
      ["invitation_inviter_id_idx", "inviter_id"],
      ["admin_audit_log_actor_id_idx", "actor_id"],
    ]) {
      expect(def(index!)).toMatch(new RegExp(`\\(${column}\\)$`));
    }
    // The workspace quota index leads with organization_id, so it serves the set-null too.
    expect(def("ocr_rounds_org_created_at_idx")).toContain("(organization_id, created_at)");
    expect(def("ocr_rounds_organization_id_idx")).toBe("");
    expect(def("receipts_reviewed_by_idx")).toMatch(
      /\(reviewed_by\) WHERE \(reviewed_by IS NOT NULL\)$/,
    );
    expect(def("receipts_last_attempt_at_idx")).toBe("");
    expect(def("member_organization_id_idx")).toBe("");
  });
});
