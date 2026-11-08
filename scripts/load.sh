#!/usr/bin/env bash
# Load test on a "small server": the production image limited to 1 vCPU / 1 GB with a fake-but-slow OCR
# model, driven by k6 (official image, pinned by digest) on the compose network. One command:
# build, start, seed, run, collect, report.
#
#   scripts/load.sh                     smoke + load + spike
#   scripts/load.sh capacity            step up the rate to find the breaking point (reads, then uploads)
#   scripts/load.sh soak                long run at a steady rate (SOAK_DURATION, default 30m)
#   scripts/load.sh smoke load spike    any combination, in order
#
# Output: packages/bench/results/load-<date>.json and .md (the raw per-run files stay in packages/bench/results/load-<date>/).
# Exit status is non-zero if a smoke, load, spike or soak scenario crossed a threshold. Capacity steps are expected
# to fail at the top, so they never set it. Also writes packages/bench/results/latest.md (gitignored) for CI.
#
# Env (defaults in brackets):
#   APP_CPUS [1] APP_MEM [1g] PG_CPUS [1] PG_MEM [512m] FIXTURE_LATENCY_MS [3000] DATABASE_POOL_MAX [5]
#   USERS [50] RECEIPTS [200] per user       RATE_READS [20] RATE_UPLOADS [2] DURATION [60s] UPLOAD_MODE [queued]
#   SPIKE_MULT [5]  SOAK_DURATION [30m]  STEP_DURATION [40s]  READ_STEPS / UPLOAD_STEPS (space-separated rates)
#   APP_PORT [3800] POSTGRES_PORT [5800] RUSTFS_PORT [9800] RUSTFS_CONSOLE_PORT [9801]  (host ports, for debugging)
#   KEEP=1 leaves the stack up afterwards; SKIP_BUILD=1 reuses the image.
# No -e on purpose: a k6 run that crosses a threshold exits non-zero, and the remaining scenarios, the
# report and the cleanup must still run. Steps that must not fail check their status explicitly.
set -uo pipefail
cd "$(dirname "$0")/.."

# Pinned by digest (multi-arch index of grafana/k6:2.3.0, built 2026-10-24).
K6_IMAGE="grafana/k6@sha256:3e4186aea62e11a45560bfc51e19eeafe82fc07ce069c78aff44b7ff893d9a5e"
PROJECT="receipt-ocr-load"

export APP_PORT="${APP_PORT:-3800}" POSTGRES_PORT="${POSTGRES_PORT:-5800}"
export RUSTFS_PORT="${RUSTFS_PORT:-9800}" RUSTFS_CONSOLE_PORT="${RUSTFS_CONSOLE_PORT:-9801}"
export APP_CPUS="${APP_CPUS:-1}" APP_MEM="${APP_MEM:-1g}" PG_CPUS="${PG_CPUS:-1}" PG_MEM="${PG_MEM:-512m}"
export FIXTURE_LATENCY_MS="${FIXTURE_LATENCY_MS:-3000}" DATABASE_POOL_MAX="${DATABASE_POOL_MAX:-5}"
USERS="${USERS:-50}" RECEIPTS="${RECEIPTS:-200}"
RATE_READS="${RATE_READS:-20}" RATE_UPLOADS="${RATE_UPLOADS:-2}" DURATION="${DURATION:-60s}"
SPIKE_MULT="${SPIKE_MULT:-5}" SOAK_DURATION="${SOAK_DURATION:-30m}" STEP_DURATION="${STEP_DURATION:-40s}"
READ_STEPS="${READ_STEPS:-20 40 80 120 160 200 240}"
UPLOAD_STEPS="${UPLOAD_STEPS:-2 6 12 24 48 64 80 96 128}"

scenarios=("$@")
[ ${#scenarios[@]} -eq 0 ] && scenarios=(smoke load spike)
for s in "${scenarios[@]}"; do
  case "$s" in smoke | load | spike | soak | capacity) ;; *) echo "load.sh: unknown scenario $s" >&2; exit 2 ;; esac
done

date_tag="$(date -u +%Y-%m-%d)"
run_dir="packages/bench/results/load-$date_tag"
rm -rf "$run_dir"
rm -f packages/bench/results/latest.md
mkdir -p "$run_dir"

dc() { docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.load.yml --profile app "$@"; }
psql_app() { dc exec -T postgres psql -U postgres -d receipt_ocr -v ON_ERROR_STOP=1 "$@"; }

sampler_pid=""
cleanup() {
  [ -n "$sampler_pid" ] && kill "$sampler_pid" 2>/dev/null
  if [ "${KEEP:-0}" != 1 ]; then dc down -v --remove-orphans >/dev/null 2>&1; fi
}
trap cleanup EXIT

echo "==> starting the stack (app ${APP_CPUS} vCPU / ${APP_MEM}, postgres ${PG_CPUS} vCPU / ${PG_MEM}, model latency ${FIXTURE_LATENCY_MS} ms)"
dc down -v --remove-orphans >/dev/null 2>&1
if [ "${SKIP_BUILD:-0}" = 1 ]; then dc up -d >"$run_dir/compose.log" 2>&1; else dc up -d --build >"$run_dir/compose.log" 2>&1; fi || { echo "load.sh: stack failed to start" >&2; exit 1; }
for _ in $(seq 1 60); do
  curl -fs -o /dev/null "http://localhost:$APP_PORT/" 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null "http://localhost:$APP_PORT/" || { echo "load.sh: app did not come up" >&2; dc logs app | tail -20 >&2; exit 1; }

k6() { # k6 <extra docker args...> -- <k6 args...>
  docker run --rm --name "${PROJECT}-k6-1" --network "${PROJECT}_default" -v "$PWD/packages/bench:/bench:ro" -v "$PWD/$run_dir:/out" \
    -e BASE_URL=http://app:3000 -e USERS="$USERS" -e RECEIPTS="$RECEIPTS" \
    -e UPLOAD_MODE="${UPLOAD_MODE:-queued}" "$@"
}

echo "==> seeding $USERS users with $RECEIPTS receipts each"
k6 "$K6_IMAGE" run --quiet /packages/bench/load/seed.js >"$run_dir/seed.log" 2>&1 || { tail -20 "$run_dir/seed.log" >&2; exit 1; }
psql_app -q -v n_receipts="$RECEIPTS" <packages/bench/load/seed.sql >/dev/null || exit 1

# Resource sampler: one line per container per tick ("<epoch>\t<docker stats json>") and Postgres connections.
sample() {
  while :; do
    now=$(date +%s)
    docker stats --no-stream --format '{{json .}}' $(docker ps -q --filter "name=^${PROJECT}-") 2>/dev/null | while IFS= read -r line; do
      printf '%s\t%s\n' "$now" "$line"
    done
    pg=$(psql_app -Atc "select count(*) || ' ' || count(*) filter (where state = 'active') from pg_stat_activity where datname = 'receipt_ocr' and backend_type = 'client backend' and pid <> pg_backend_pid()" 2>/dev/null)
    printf '%s\tpg\t%s\n' "$now" "$pg"
    printf '%s\tload\t%s\n' "$now" "$(uptime | sed -E 's/.*load averages?: *//' | awk '{print $1}' | tr -d ',')"
    sleep 1
  done
}
sample >"$run_dir/samples.tsv" 2>/dev/null &
sampler_pid=$!

failed=0
run_seq=0
# run <name> <scenario> [VAR=value ...]: one k6 run with its pg_stat_statements and time window recorded.
run() {
  local name="$1" scenario="$2"
  shift 2
  run_seq=$((run_seq + 1))
  local envs=(-e "SCENARIO=$scenario" -e "LATENCY_MS=$FIXTURE_LATENCY_MS" -e "RUN=$run_seq")
  for kv in "$@"; do envs+=(-e "$kv"); done
  echo "==> $name"
  psql_app -Atc "select pg_stat_statements_reset()" >/dev/null
  local start end
  start=$(date +%s)
  k6 "${envs[@]}" "$K6_IMAGE" run \
    --summary-export="/out/$name.summary.json" /packages/bench/load/load.js >"$run_dir/$name.k6.log" 2>&1
  local status=$?
  end=$(date +%s)
  printf '%s %s %s\n' "$start" "$end" "$status" >"$run_dir/$name.window"
  psql_app -Atc "select coalesce(json_agg(t), '[]') from (select calls, round(total_exec_time::numeric, 1) as total_ms, round(mean_exec_time::numeric, 3) as mean_ms, left(regexp_replace(query, '\s+', ' ', 'g'), 150) as query from pg_stat_statements where dbid = (select oid from pg_database where datname = 'receipt_ocr') order by total_exec_time desc limit 15) t" >"$run_dir/$name.pgss.json"
  [ "$status" -ne 0 ] && echo "    thresholds crossed (k6 exit $status)"
  return "$status"
}

# step <reads|uploads> <rate var> <rate>: a step that fails is rerun once after a pause, so a noisy
# neighbour on the Docker host doesn't end the ramp early. The second result is the one reported.
step() {
  local kind="$1" var="$2" rate="$3"
  run "capacity-$kind-$rate" "$kind" "$var=$rate" DURATION="$STEP_DURATION" && { sleep 10; return 0; }
  echo "    retrying $kind at $rate/s once"
  sleep 20
  run "capacity-$kind-$rate" "$kind" "$var=$rate" DURATION="$STEP_DURATION" || return 1
  sleep 10
}

echo "==> warm-up"
# Next compiles routes and the JIT warms up on first use; the first minute would otherwise count against the SLOs.
k6 -e SCENARIO=load -e RATE_READS=15 -e RATE_UPLOADS=2 -e DURATION=20s -e RUN=0 -e LATENCY_MS="$FIXTURE_LATENCY_MS" \
  "$K6_IMAGE" run --quiet /packages/bench/load/load.js >"$run_dir/warmup.log" 2>&1

for scenario in "${scenarios[@]}"; do
  case "$scenario" in
    smoke) run smoke smoke || failed=1 ;;
    load) run load load RATE_READS="$RATE_READS" RATE_UPLOADS="$RATE_UPLOADS" DURATION="$DURATION" || failed=1 ;;
    spike) run spike spike RATE_READS="$RATE_READS" RATE_UPLOADS="$RATE_UPLOADS" SPIKE_MULT="$SPIKE_MULT" || failed=1 ;;
    soak) run soak soak RATE_READS="$RATE_READS" RATE_UPLOADS="$RATE_UPLOADS" DURATION="$SOAK_DURATION" || failed=1 ;;
    capacity)
      for rate in $READ_STEPS; do
        step reads RATE_READS "$rate" || break
      done
      for rate in $UPLOAD_STEPS; do
        step uploads RATE_UPLOADS "$rate" || break
      done
      ;;
  esac
done

echo "==> collecting"
kill "$sampler_pid" 2>/dev/null
sampler_pid=""
dc logs --no-log-prefix --no-color app >"$run_dir/app.log" 2>&1
docker inspect -f '{{.State.OOMKilled}} {{.RestartCount}}' "$(dc ps -aq app)" >"$run_dir/app.state"
cat >"$run_dir/meta.json" <<JSON
{
  "date": "$date_tag",
  "commit": "$(git rev-parse --short HEAD)",
  "scenarios": "${scenarios[*]}",
  "appCpus": "$APP_CPUS", "appMem": "$APP_MEM", "pgCpus": "$PG_CPUS", "pgMem": "$PG_MEM",
  "fixtureLatencyMs": $FIXTURE_LATENCY_MS, "poolMax": $DATABASE_POOL_MAX,
  "users": $USERS, "receiptsPerUser": $RECEIPTS,
  "dockerCpus": $(docker info --format '{{.NCPU}}'), "dockerMemBytes": $(docker info --format '{{.MemTotal}}'),
  "k6": "$K6_IMAGE"
}
JSON
bun packages/bench/load/report.mjs "$run_dir" "packages/bench/results/load-$date_tag" || exit 1
cp "packages/bench/results/load-$date_tag.md" packages/bench/results/latest.md
echo "==> packages/bench/results/load-$date_tag.md"
exit "$failed"
