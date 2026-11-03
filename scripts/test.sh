#!/usr/bin/env bash
# Whole test run: compose Postgres + RustFS, a fresh throwaway database, unit tests, then e2e
# against `next build && next start`.
#
#   scripts/test.sh            unit + e2e
#   scripts/test.sh --unit     unit only (no Docker)
#   scripts/test.sh --keep-db  leave the test database in place
#
# Env: PORT (default 3004), POSTGRES_PORT (5433), RUSTFS_PORT (9000).
set -euo pipefail
cd "$(dirname "$0")/.."

unit_only=0 keep_db=0
for arg in "$@"; do
  case "$arg" in
    --unit) unit_only=1 ;;
    --keep-db) keep_db=1 ;;
    -h | --help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "test.sh: unknown option $arg" >&2; exit 2 ;;
  esac
done

bun run test
[ "$unit_only" = 1 ] && exit 0

port="${PORT:-3004}"
pg_port="${POSTGRES_PORT:-5433}"
s3_port="${RUSTFS_PORT:-9000}"
db="receipt_ocr_test_$$"

docker compose up -d --wait postgres rustfs
docker compose run --rm rustfs-init
docker compose exec -T postgres psql -U postgres -c "create database $db" >/dev/null
cleanup() {
  [ "$keep_db" = 1 ] || docker compose exec -T postgres psql -U postgres -c "drop database if exists $db with (force)" >/dev/null || true
}
trap cleanup EXIT

export DATABASE_URL="postgres://postgres:postgres@localhost:$pg_port/$db"
export DIRECT_URL="$DATABASE_URL"
export BETTER_AUTH_URL="http://localhost:$port"
export BETTER_AUTH_SECRET="local-test-secret-not-for-production-000000"
export GOOGLE_GENERATIVE_AI_API_KEY="dummy-local"
export S3_ENDPOINT="http://localhost:$s3_port" S3_REGION=us-east-1 S3_BUCKET=receipt-ocr
export S3_ACCESS_KEY_ID=rustfsadmin S3_SECRET_ACCESS_KEY=rustfsadmin S3_FORCE_PATH_STYLE=true
export PORT="$port"

bun run db:migrate
bun run build
bun run test:e2e
