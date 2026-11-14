/**
 * The Data API grants migration on a scratch database next to DATABASE_URL's, with Supabase's three API roles and the
 * grants Supabase gives them: afterwards none of them holds a privilege on a `public` table, sequence or function,
 * including ones created later, while the owner still reads and writes. migrations.int.test.ts covers the plain
 * Postgres case, where the roles don't exist and it changes nothing. Skipped unless INTEGRATION=1.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.INTEGRATION === "1";
const dir = path.join(import.meta.dirname, "..", "..", "drizzle");
const scratch = `migration_grants_probe_${process.pid}`;
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const target = files.find((f) => f.endsWith("_data_api_grants.sql"))!;
const sqlOf = (file: string) => readFileSync(path.join(dir, file), "utf8");
const API_ROLES = ["anon", "authenticated", "service_role"];

describe.skipIf(!enabled)("Data API grants migration", () => {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://localhost/x");
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const scratchUrl = new URL(url);
  scratchUrl.pathname = `/${scratch}`;
  const db = postgres(scratchUrl.toString(), { max: 1, onnotice: () => {} });
  const createdRoles: string[] = [];

  const apiGrants = async () =>
    (
      await db`select c.relname, c.relkind, r.rolname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        cross join pg_roles r
        where n.nspname = 'public' and r.rolname in ${db(API_ROLES)} and c.relkind in ('r', 'S')
          and case c.relkind
            when 'S' then has_sequence_privilege(r.oid, c.oid, 'USAGE, SELECT, UPDATE')
            else has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
          end`
    ).map((r) => `${r.rolname}:${r.relname}`);

  beforeAll(async () => {
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    await admin.unsafe(`create database ${scratch}`);
    for (const role of API_ROLES) {
      const [exists] = await admin`select 1 from pg_roles where rolname = ${role}`;
      if (exists) continue;
      await admin.unsafe(`create role ${role} nologin`);
      createdRoles.push(role);
    }
    for (const file of files.filter((f) => f < target)) await db.unsafe(sqlOf(file));
    // What a Supabase project has: everything in `public` granted to the API roles, now and by default.
    await db.unsafe(`
      grant usage on schema public to anon, authenticated, service_role;
      grant all on all tables in schema public to anon, authenticated, service_role;
      grant all on all sequences in schema public to anon, authenticated, service_role;
      create function public.probe() returns int language sql as 'select 1';
      grant execute on function public.probe() to anon, authenticated, service_role;
      alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
    `);
    expect(await apiGrants()).toContain("anon:receipts");
    await db.begin((tx) => tx.unsafe(sqlOf(target)));
  });

  afterAll(async () => {
    await db.end();
    await admin.unsafe(`drop database if exists ${scratch} with (force)`);
    for (const role of createdRoles) await admin.unsafe(`drop role if exists ${role}`);
    await admin.end();
  });

  it("leaves the API roles no privilege on any table or sequence", async () => {
    expect(await apiGrants()).toEqual([]);
  });

  it("removes their execute grants on functions in public", async () => {
    const [fn] = await db`select proacl::text as acl from pg_proc where proname = 'probe'`;
    for (const role of API_ROLES) expect(fn?.acl).not.toContain(`${role}=`);
  });

  it("grants nothing on tables and sequences created afterwards", async () => {
    await db.unsafe(`create table public.later (id serial primary key)`);
    expect(await apiGrants()).toEqual([]);
    const defaults = await db`select defaclobjtype, defaclacl::text as acl from pg_default_acl
      where defaclnamespace = 'public'::regnamespace`;
    for (const row of defaults) {
      for (const role of API_ROLES) expect(row.acl).not.toContain(`${role}=`);
    }
    await db.unsafe(`drop table public.later`);
  });

  it("keeps the owner's access", async () => {
    await db`insert into "user" (id, name, email) values ('u1', 'Test', 'test@example.com')`;
    expect(await db`select id from "user"`).toEqual([{ id: "u1" }]);
  });
});
