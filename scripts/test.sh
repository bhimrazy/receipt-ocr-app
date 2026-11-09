#!/usr/bin/env bash
# Whole test run: unit tests, then compose Postgres + RustFS, a fresh throwaway database, integration tests, then e2e
# against `next build && next start`.
#
#   scripts/test.sh            unit + integration + e2e
#   scripts/test.sh --unit     unit only (no Docker)
#   scripts/test.sh --keep-db  leave the test database in place
#   scripts/test.sh --turnstile  also rebuild with Cloudflare's test keys and run e2e/turnstile.spec.ts
#                                against a passing and a rejecting secret (needs internet)
#   scripts/test.sh --analytics  also rebuild with a test GA measurement id and run
#                                e2e/consent-ga.spec.ts (Google is stubbed; no internet needed)
#
# Env: PORT (default 3004), POSTGRES_PORT (5433), RUSTFS_PORT (9000).
set -euo pipefail
cd "$(dirname "$0")/.."

unit_only=0 keep_db=0 turnstile=0 analytics=0
for arg in "$@"; do
  case "$arg" in
    --unit) unit_only=1 ;;
    --keep-db) keep_db=1 ;;
    --turnstile) turnstile=1 ;;
    --analytics) analytics=1 ;;
    -h | --help) sed -n '2,14p' "$0"; exit 0 ;;
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
# Match CI's e2e env: no mailer locally, fixture OCR, per-client rate limits.
export AUTH_REQUIRE_EMAIL_VERIFICATION=false OCR_PROVIDER=fixture E2E_UPLOAD=1 TRUSTED_IP_HEADERS=x-forwarded-for
export PORT="$port"
# Playwright reads its target from here, not from PORT.
export E2E_BASE_URL="http://localhost:$port"

bun run db:migrate
bun run test:int
# Match CI's e2e: Paddle's sandbox public settings with no API key or webhook secret. Under
# `next start` that is the live site's state, checkout for platform admins only (upgrade.spec.ts).
export PADDLE_ENV=sandbox NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_e2e_not_a_real_token
export PADDLE_PRICE_PRO_MONTHLY=pri_e2e_month PADDLE_PRICE_PRO_YEARLY=pri_e2e_year
bun run build
bun run test:e2e

# `bun run start` forks next, so stop the server by its port rather than by PID.
stop_server() { lsof -tiTCP:"$port" -sTCP:LISTEN | xargs kill 2>/dev/null || true; }

if [ "$analytics" = 1 ]; then
  # The measurement id is inlined at build time, so this needs its own build.
  NEXT_PUBLIC_GA_MEASUREMENT_ID=G-E2ETEST01 bun run build
  (cd apps/web && E2E_GA=1 bunx playwright test e2e/consent-ga.spec.ts)
  stop_server
  sleep 1
fi

if [ "$turnstile" = 1 ]; then
  # The site key is inlined at build time, so this needs its own build; the secret is runtime.
  export NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
  # Shows the product-updates form; without a mailer nothing is sent.
  export RESEND_NEWSLETTER_SEGMENT_ID=e2e-segment
  bun run build
  trap 'stop_server; cleanup' EXIT
  # pass: Cloudflare's always-passing secret; fail: its always-rejecting one.
  for mode in pass fail; do
    case "$mode" in
      pass) secret=1x0000000000000000000000000000000AA ;;
      fail) secret=2x0000000000000000000000000000000AA ;;
    esac
    # Test secrets report the hostname example.com.
    (cd apps/web && TURNSTILE_SECRET_KEY="$secret" TURNSTILE_ALLOWED_HOSTNAMES=example.com exec bun run start) &
    up=0
    for _ in $(seq 60); do
      curl -fsS -o /dev/null "$E2E_BASE_URL/sign-in" && up=1 && break
      sleep 1
    done
    [ "$up" = 1 ] || { echo "test.sh: server did not answer on $E2E_BASE_URL within 60s ($mode secret)" >&2; exit 1; }
    (cd apps/web && E2E_TURNSTILE="$mode" E2E_REUSE_SERVER=1 bunx playwright test e2e/turnstile.spec.ts)
    stop_server
    sleep 1
  done
fi
