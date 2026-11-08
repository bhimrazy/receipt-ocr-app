-- Read-only login for the nightly backup (docs/runbook.md, Backups). Run once per database as `postgres`, with the
-- password replaced by a fresh random one (openssl rand -hex 32).
--
-- bypassrls: every app table has RLS on and no policies, so without it pg_dump (row_security off) stops with an
-- error. Supabase's postgres role has bypassrls and so can grant it. The grants cover only the two schemas the
-- backup dumps, and default privileges keep tables added by later migrations (run as postgres) covered.
create role backup_reader with login password 'REPLACE_WITH_PASSWORD' bypassrls connection limit 3;
alter role backup_reader set default_transaction_read_only = on;
grant usage on schema public, drizzle to backup_reader;
grant select on all tables in schema public, drizzle to backup_reader;
grant select on all sequences in schema public, drizzle to backup_reader;
alter default privileges for role postgres in schema public, drizzle grant select on tables to backup_reader;
alter default privileges for role postgres in schema public, drizzle grant select on sequences to backup_reader;
