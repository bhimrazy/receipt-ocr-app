/**
 * Migration 0009 (clear stored provider tokens) on a scratch database next to DATABASE_URL's: every token column is null afterwards, while account ids, scopes and passwords stay. Skipped unless
 * INTEGRATION=1.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.INTEGRATION === "1";
const dir = path.join(import.meta.dirname, "..", "..", "drizzle");
const scratch = `migration_0009_probe_${process.pid}`;
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const target = files.find((f) => f.startsWith("0009_"))!;
const sqlOf = (file: string) => readFileSync(path.join(dir, file), "utf8");

describe.skipIf(!enabled)("migration 0009 on existing rows", () => {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://localhost/x");
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const scratchUrl = new URL(url);
  scratchUrl.pathname = `/${scratch}`;
  const db = postgres(scratchUrl.toString(), { max: 1, onnotice: () => {} });
  const expiry = new Date("2026-12-01T00:00:00Z");

  beforeAll(async () => {
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.unsafe(`create database ${scratch}`);
    for (const file of files.filter((f) => f < target)) await db.unsafe(sqlOf(file));

    await db`insert into "user" (id, name, email) values ('u1', 'Test', 'test@example.com')`;
    await db`insert into account (id, account_id, provider_id, user_id, access_token, refresh_token, id_token,
      access_token_expires_at, refresh_token_expires_at, scope)
      values ('a-google', 'g-1', 'google', 'u1', 'sealed-access', 'sealed-refresh', 'eyJ.id.token',
        ${expiry}, ${expiry}, 'openid,email')`;
    await db`insert into account (id, account_id, provider_id, user_id, access_token_expires_at)
      values ('a-github', 'gh-1', 'github', 'u1', ${expiry})`;
    await db`insert into account (id, account_id, provider_id, user_id, password)
      values ('a-credential', 'u1', 'credential', 'u1', 'salt:hash')`;

    await db.begin((tx) => tx.unsafe(sqlOf(target)));
  });

  afterAll(async () => {
    await db.end();
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.end();
  });

  it("clears every provider token and expiry, keeping the rest of each row", async () => {
    const rows =
      await db`select id, account_id, scope, password, access_token, refresh_token, id_token,
      access_token_expires_at, refresh_token_expires_at from account order by id`;
    const cleared = {
      access_token: null,
      refresh_token: null,
      id_token: null,
      access_token_expires_at: null,
      refresh_token_expires_at: null,
    };
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { id: "a-credential", account_id: "u1", scope: null, password: "salt:hash", ...cleared },
      { id: "a-github", account_id: "gh-1", scope: null, password: null, ...cleared },
      { id: "a-google", account_id: "g-1", scope: "openid,email", password: null, ...cleared },
    ]);
  });
});
