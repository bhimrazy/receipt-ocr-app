#!/usr/bin/env bash
# End-to-end check of scripts/db-backup.sh against throwaway containers: a source Postgres with the app's
# migrations, a Supabase-like auth schema, seeded rows and the backup_reader role from db-backup-role.sql.
# Proves dump, encrypt, (upload, download,) decrypt, restore and row counts, plus that the owner's key decrypts
# the stored file. Then checks that a role without bypassrls and a mismatched pg_dump version both fail.
#
#   scripts/db-backup-test.sh        without upload
#   scripts/db-backup-test.sh --s3   also uploads to a throwaway RustFS container (published on 127.0.0.1)
#
# Needs docker, jq, age and bun. Touches no other container or volume.
set -euo pipefail
cd "$(dirname "$0")/.."

s3=0
[ "${1:-}" = --s3 ] && s3=1

pg_image="${BACKUP_PG_IMAGE:-postgres:17.10-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193}"
# Same digests as docker-compose.yml.
other_image="postgres:18.6-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5"
rustfs_image="rustfs/rustfs:1.0.4@sha256:ed9210d6411d77ffceb70d94b964a3cb7d225983368bc25bebe01e995293dcc2"

id="$$"
net="db-backup-test-$id"
src="db-backup-test-src-$id"
s3c="db-backup-test-s3-$id"
work="$(mktemp -d)"
cleanup() {
  docker rm -f "$src" "$s3c" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

ok() { echo "ok - $1"; }
die() {
  echo "not ok - $1" >&2
  exit 1
}

docker network create "$net" >/dev/null
docker run -d --rm --name "$src" --network "$net" -e POSTGRES_PASSWORD=source "$pg_image" >/dev/null
for _ in $(seq 60); do
  docker exec "$src" pg_isready -q -h 127.0.0.1 -U postgres && break
  sleep 1
done
psql_src() { docker exec -i "$src" psql -X -q -U postgres -v ON_ERROR_STOP=1 "$@"; }

for file in apps/web/drizzle/*.sql; do psql_src <"$file" >/dev/null; done
journal=$(jq '.entries | length' apps/web/drizzle/meta/_journal.json)
psql_src <<SQL
create schema drizzle;
create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint);
insert into drizzle.__drizzle_migrations (hash, created_at) select md5(i::text), i from generate_series(1, $journal) i;
-- Stands in for Supabase's managed schemas, which the backup must leave out.
create schema auth;
create table auth.users (id int);
insert into auth.users values (1), (2);
insert into "user" (id, name, email) select 'u' || i, 'User ' || i, 'u' || i || '@example.test' from generate_series(1, 3) i;
insert into organization (id, name, slug) values ('o1', 'One', 'one'), ('o2', 'Two', 'two');
insert into app_settings (key, value) values ('k', '{}');
SQL
sed "s/REPLACE_WITH_PASSWORD/reader/" scripts/db-backup-role.sql | psql_src
ok "source database ready ($journal migrations)"

age-keygen -o "$work/owner.key" 2>/dev/null
export BACKUP_AGE_RECIPIENT="$(age-keygen -y "$work/owner.key")"
export BACKUP_DATABASE_URL="postgres://backup_reader:reader@$src:5432/postgres"
export BACKUP_DOCKER_NETWORK="$net" BACKUP_OUT="$work" BACKUP_PG_IMAGE="$pg_image" BACKUP_COMMIT=test
unset GITHUB_ACTIONS GITHUB_STEP_SUMMARY

if [ "$s3" = 1 ]; then
  docker run -d --rm --name "$s3c" -p 127.0.0.1::9000 \
    -e RUSTFS_ACCESS_KEY=backup -e RUSTFS_SECRET_KEY=backupsecret "$rustfs_image" >/dev/null
  port=$(docker port "$s3c" 9000/tcp | head -1 | sed 's/.*://')
  export BACKUP_R2_ENDPOINT="http://127.0.0.1:$port" BACKUP_R2_BUCKET=backups BACKUP_R2_REGION=us-east-1 \
    BACKUP_R2_ACCESS_KEY_ID=backup BACKUP_R2_SECRET_ACCESS_KEY=backupsecret
  for _ in $(seq 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --aws-sigv4 aws:amz:us-east-1:s3 --user backup:backupsecret \
      -X PUT "$BACKUP_R2_ENDPOINT/backups" || true)
    case "$code" in 200 | 409) break ;; esac
    sleep 1
  done
  ok "RustFS bucket ready"
fi

scripts/db-backup.sh || die "backup and restore drill"
ok "backup and restore drill"

m="$work/manifest.json"
jq -e '.tables["public.user"] == 3 and .tables["public.organization"] == 2 and .tables["public.app_settings"] == 1' "$m" >/dev/null ||
  die "manifest row counts"
jq -e --argjson n "$journal" '.migrations == $n' "$m" >/dev/null || die "manifest migration count"
jq -e '[.tables | keys[] | select(startswith("public.") or startswith("drizzle.") | not)] == []' "$m" >/dev/null ||
  die "only public and drizzle tables are backed up"
ok "manifest: counts, migrations, schemas"

if [ "$s3" = 1 ]; then
  bun scripts/backup-object.ts get "$(jq -r .object "$m")" "$work/stored.age"
  age -d -i "$work/owner.key" -o "$work/stored.dump" "$work/stored.age"
  [ "$(sha256sum "$work/stored.dump" | cut -d' ' -f1)" = "$(jq -r .dump.sha256 "$m")" ] ||
    die "owner key decrypts the stored backup"
  if docker run --rm --user "$(id -u):$(id -g)" -v "$work:/w" "$pg_image" pg_restore -l /w/stored.dump |
    grep -q 'SCHEMA - auth'; then
    die "auth schema left out of the dump"
  fi
  ok "owner key decrypts the stored backup; no auth schema in it"
fi

psql_src -c "alter role backup_reader nobypassrls"
if scripts/db-backup.sh >"$work/rls.log" 2>&1; then die "a role without bypassrls must fail"; fi
grep -q "row-level security" "$work/rls.log" || die "a role without bypassrls fails on row-level security"
psql_src -c "alter role backup_reader bypassrls"
ok "a role without bypassrls fails instead of dumping fewer rows"

if BACKUP_PG_IMAGE="$other_image" scripts/db-backup.sh >"$work/version.log" 2>&1; then
  die "a pg_dump of another major version must fail"
fi
grep -q "pin BACKUP_PG_IMAGE" "$work/version.log" || die "version mismatch message"
ok "a pg_dump of another major version is refused"
