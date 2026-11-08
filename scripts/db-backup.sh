#!/usr/bin/env bash
# Backs up the app's Postgres data and proves the backup restores. Used nightly by
# .github/workflows/db-backup.yml; runs the same way locally (scripts/db-backup-test.sh).
#
#   1. pg_dump schemas public and drizzle (custom format), with per-table row counts taken in the same snapshot
#   2. encrypt with age to BACKUP_AGE_RECIPIENT and to a one-off drill key made for this run
#   3. upload to the bucket, then download it again
#   4. decrypt the download with the drill key, pg_restore it into a throwaway Postgres container, and fail unless
#      every table's row count matches the source
#   5. upload the manifest last: a manifest next to a dump means that dump passed the drill
#
# The drill key's private half never leaves this run's temp directory. Only the owner's offline key can decrypt
# the stored backup after the run ends.
#
# Env:
#   BACKUP_DATABASE_URL    source database (the read-only backup_reader role); required
#   BACKUP_AGE_RECIPIENT   age public keys (age1...), one per line; required
#   BACKUP_PG_IMAGE        Postgres image for psql, pg_dump, pg_restore and the throwaway server; its major version
#                          must equal the source server's (default below: 17.10, Supabase's major)
#   BACKUP_R2_ENDPOINT, BACKUP_R2_BUCKET, BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY
#                          S3 API target (R2, S3 or RustFS); BACKUP_R2_REGION defaults to auto. Without the
#                          endpoint, upload and download are skipped (local runs).
#   BACKUP_DOCKER_NETWORK  an existing Docker network to run in (default: a new one, removed at the end)
#   BACKUP_COMMIT          commit recorded in the object name (default: GITHUB_SHA, else git HEAD)
#   BACKUP_OUT             directory to copy the manifest into, for callers that check it
#
# Prints sizes and table totals only: logs of this public repo are public, and row counts are business data.
set -euo pipefail
umask 077

# postgres:17.10-alpine, multi-arch index (pushed 2026-07-08).
pg_image="${BACKUP_PG_IMAGE:-postgres:17.10-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193}"
repo="$(cd "$(dirname "$0")/.." && pwd)"

fail() {
  if [ "${GITHUB_ACTIONS:-}" = true ]; then echo "::error::$1"; else echo "db-backup: $1" >&2; fi
  exit 1
}
step() { echo "db-backup: $1"; }

[ -n "${BACKUP_DATABASE_URL:-}" ] || fail "BACKUP_DATABASE_URL is not set."
[ -n "${BACKUP_AGE_RECIPIENT:-}" ] || fail "BACKUP_AGE_RECIPIENT is not set."
for tool in docker jq age age-keygen sha256sum; do
  command -v "$tool" >/dev/null || fail "$tool is not installed."
done
upload=0
if [ -n "${BACKUP_R2_ENDPOINT:-}" ]; then
  upload=1
  for name in BACKUP_R2_BUCKET BACKUP_R2_ACCESS_KEY_ID BACKUP_R2_SECRET_ACCESS_KEY; do
    [ -n "${!name:-}" ] || fail "$name is not set."
  done
  command -v bun >/dev/null || fail "bun is not installed (needed for the upload)."
fi

work="$(mktemp -d)"
suffix="$(basename "$work" | tr -cd 'a-zA-Z0-9' | tr 'A-Z' 'a-z')"
net="${BACKUP_DOCKER_NETWORK:-}"
own_net=0
restore="db-backup-restore-$suffix"
cleanup() {
  docker rm -f "$restore" >/dev/null 2>&1 || true
  [ "$own_net" = 1 ] && docker network rm "$net" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
if [ -z "$net" ]; then
  net="db-backup-$suffix"
  docker network create "$net" >/dev/null
  own_net=1
fi

printf '%s\n' "$BACKUP_AGE_RECIPIENT" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g' | { grep -v '^$' || true; } >"$work/recipients"
if [ ! -s "$work/recipients" ] || grep -qvE '^age1[0-9a-z]+$' "$work/recipients"; then
  fail "BACKUP_AGE_RECIPIENT must be age public keys (age1...), one per line."
fi

# Tools run as the calling user so every file in $work stays removable without root.
pg() {
  docker run --rm -i --network "$net" --user "$(id -u):$(id -g)" -v "$work:/work" \
    -e BACKUP_DATABASE_URL -e RESTORE_URL "$pg_image" "$@"
}

# One query that counts every table in the two schemas: {"schema.table": rows}.
count_sql="select coalesce(json_object_agg(name, n order by name), '{}') from (:count_sql) c"
gen_count_sql="select coalesce(string_agg(format('select %L as name, count(*) as n from %I.%I',
  schemaname || '.' || tablename, schemaname, tablename), ' union all '),
  'select null::text as name, 0::bigint as n where false') as count_sql
  from pg_tables where schemaname in ('public', 'drizzle')"

step "checking versions"
client_major="$(pg pg_dump --version | sed -E 's/.* ([0-9]+)\..*/\1/')"
server_num="$(pg sh -c 'exec psql "$BACKUP_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "show server_version_num"')" ||
  fail "Can't connect to the source database."
server_major=$((server_num / 10000))
[ "$client_major" = "$server_major" ] ||
  fail "The source runs Postgres $server_major but $pg_image has pg_dump $client_major: pin BACKUP_PG_IMAGE to Postgres $server_major."

# Row counts and the dump read the same exported snapshot, so they agree even while the app writes. row_security
# off makes a role that RLS would filter fail loudly instead of counting (and dumping) fewer rows.
step "dumping schemas public and drizzle"
pg sh -c 'exec psql "$BACKUP_DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 -f -' <<SQL
set row_security = off;
set statement_timeout = 0;
set idle_in_transaction_session_timeout = 0;
begin isolation level repeatable read read only;
select pg_export_snapshot() as snapshot \gset
\setenv BACKUP_SNAPSHOT :snapshot
$gen_count_sql \gset
\o /work/source-counts.json
$count_sql;
\o
\! pg_dump --dbname="\$BACKUP_DATABASE_URL" --snapshot="\$BACKUP_SNAPSHOT" --format=custom --compress=zstd --schema=public --schema=drizzle --file=/work/receipt-ocr.dump && touch /work/dump.ok
commit;
SQL
[ -f "$work/dump.ok" ] || fail "pg_dump failed (see its error above)."
jq -e 'type == "object" and length > 0' "$work/source-counts.json" >/dev/null ||
  fail "The source has no tables in public or drizzle."

step "encrypting"
age-keygen -o "$work/drill.key" 2>/dev/null
age-keygen -y "$work/drill.key" >>"$work/recipients"
age -R "$work/recipients" -o "$work/receipt-ocr.dump.age" "$work/receipt-ocr.dump"

sha() { sha256sum "$1" | cut -d' ' -f1; }
size() { wc -c <"$1" | tr -d ' '; }
dump_sha="$(sha "$work/receipt-ocr.dump")"
enc_sha="$(sha "$work/receipt-ocr.dump.age")"

commit="${BACKUP_COMMIT:-${GITHUB_SHA:-$(git -C "$repo" rev-parse HEAD 2>/dev/null || echo local)}}"
day="$(date -u +%Y-%m-%d)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="receipt-ocr-$stamp-${commit:0:12}"
key="daily/$day/$name.dump.age"

drill_input="$work/receipt-ocr.dump.age"
if [ "$upload" = 1 ]; then
  step "uploading $key"
  bun "$repo/scripts/backup-object.ts" put "$key" "$work/receipt-ocr.dump.age"
  bun "$repo/scripts/backup-object.ts" get "$key" "$work/downloaded.dump.age"
  [ "$(sha "$work/downloaded.dump.age")" = "$enc_sha" ] || fail "The downloaded backup differs from the one uploaded."
  drill_input="$work/downloaded.dump.age"
fi

step "restore drill"
age -d -i "$work/drill.key" -o "$work/restored.dump" "$drill_input"
rm -f "$work/drill.key"
[ "$(sha "$work/restored.dump")" = "$dump_sha" ] || fail "The decrypted backup differs from the dump."

docker run -d --rm --name "$restore" --network "$net" -e POSTGRES_PASSWORD=drill "$pg_image" >/dev/null
# TCP, not the socket: during first-start init the server listens only on the socket.
for _ in $(seq 60); do
  docker exec "$restore" pg_isready -q -h 127.0.0.1 -U postgres && break
  sleep 1
done
docker exec "$restore" pg_isready -q -h 127.0.0.1 -U postgres || fail "The throwaway Postgres did not start."
export RESTORE_URL="postgres://postgres:drill@$restore:5432/postgres"

# Every database already has a public schema, so the list skips creating it (as the runbook's restore does).
# One transaction, stop at the first error: a dump that restores only in part fails. Foreign keys are added after
# the data, so a dump with dangling references fails here too. Roles and grants are Supabase's, not the drill's.
pg sh -c 'pg_restore -l /work/restored.dump | grep -vE "^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public " >/work/restore.list'
pg pg_restore --dbname="$RESTORE_URL" --use-list=/work/restore.list --single-transaction --exit-on-error \
  --no-owner --no-privileges /work/restored.dump || fail "pg_restore failed (see its error above)."

pg sh -c 'exec psql "$RESTORE_URL" -X -q -A -t -v ON_ERROR_STOP=1 -f -' <<SQL
$gen_count_sql \gset
\o /work/restored-counts.json
$count_sql;
SQL

if ! jq -e --slurpfile r "$work/restored-counts.json" '. == $r[0]' "$work/source-counts.json" >/dev/null; then
  jq -r --slurpfile r "$work/restored-counts.json" \
    '(keys + ($r[0] | keys) | unique)[] as $t | select(.[$t] != $r[0][$t]) | "  \($t)"' \
    "$work/source-counts.json" >&2
  fail "Row counts after restore differ from the source for the tables above."
fi
migrations="$(jq '."drizzle.__drizzle_migrations" // 0' "$work/source-counts.json")"
[ "$migrations" -gt 0 ] || fail "The backup has no applied migrations (drizzle.__drizzle_migrations is empty or missing)."
tables="$(jq 'length' "$work/source-counts.json")"
rows="$(jq '[.[]] | add' "$work/source-counts.json")"
step "restore drill passed: $tables tables, row counts match"

jq -n \
  --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg commit "$commit" \
  --arg object "$key" \
  --arg pg_image "$pg_image" \
  --argjson server_version_num "$server_num" \
  --argjson migrations "$migrations" \
  --argjson dump_bytes "$(size "$work/receipt-ocr.dump")" \
  --arg dump_sha "$dump_sha" \
  --argjson enc_bytes "$(size "$work/receipt-ocr.dump.age")" \
  --arg enc_sha "$enc_sha" \
  --slurpfile counts "$work/source-counts.json" \
  '{
    format: 1,
    created_at: $created_at,
    commit: $commit,
    object: $object,
    postgres: { server_version_num: $server_version_num, client_image: $pg_image },
    schemas: ["public", "drizzle"],
    migrations: $migrations,
    tables: $counts[0],
    dump: { format: "custom", compress: "zstd", bytes: $dump_bytes, sha256: $dump_sha },
    encrypted: { tool: "age", bytes: $enc_bytes, sha256: $enc_sha },
    drill: { restored: true, row_counts_match: true }
  }' >"$work/manifest.json"

if [ "$upload" = 1 ]; then
  bun "$repo/scripts/backup-object.ts" put "daily/$day/$name.manifest.json" "$work/manifest.json"
  # Monthly copy, kept longer by its own lifecycle rule.
  if [ "$(date -u +%d)" = 01 ]; then
    month="$(date -u +%Y-%m)"
    step "monthly copy monthly/$month/"
    bun "$repo/scripts/backup-object.ts" put "monthly/$month/$name.dump.age" "$work/receipt-ocr.dump.age"
    bun "$repo/scripts/backup-object.ts" put "monthly/$month/$name.manifest.json" "$work/manifest.json"
  fi
fi
[ -n "${BACKUP_OUT:-}" ] && cp "$work/manifest.json" "$BACKUP_OUT/manifest.json"

summary="Backup \`$key\`: $(size "$work/receipt-ocr.dump.age") bytes encrypted, $tables tables, $migrations migrations, restore drill passed."
[ "$upload" = 1 ] || summary="$summary Not uploaded (no BACKUP_R2_ENDPOINT)."
step "$summary"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$summary" >>"$GITHUB_STEP_SUMMARY"
# Total rows go to the local log only, never to Actions.
[ "${GITHUB_ACTIONS:-}" = true ] || step "$rows rows in total"
exit 0
