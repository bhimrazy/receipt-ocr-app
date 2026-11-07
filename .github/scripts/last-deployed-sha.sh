#!/usr/bin/env bash
# Prints the full SHA of the commit production runs. First asks the live site (PRODUCTION_HEALTH_URL,
# whose `commit` is the deployed build's short SHA) and resolves it in this checkout, which needs
# full history. A run's own head_sha is not enough: a run started by a CI run (workflow_run) carries
# main's newest commit at start, while its deploy job checks out the CI run's commit, so a newer
# merge would be recorded as deployed and then skipped. Falls back to the newest run of this
# workflow whose deploy-production job succeeded (last 50 runs), which is exact for manual runs.
# Exits non-zero when both fail, so callers fail closed. Needs GH_TOKEN with actions: read, and
# GITHUB_REPOSITORY.
set -euo pipefail
if [ -n "${PRODUCTION_HEALTH_URL:-}" ] &&
  short=$(curl -fsS --max-time 10 "$PRODUCTION_HEALTH_URL" | jq -er '.commit | select(type == "string" and length >= 7)') &&
  full=$(git rev-parse --verify --quiet "$short^{commit}"); then
  echo "$full"
  exit 0
fi
echo "Couldn't read the live commit; using the last successful deploy run." >&2
runs=$(gh api -X GET "repos/$GITHUB_REPOSITORY/actions/workflows/production.yml/runs" \
  -f branch=main -f status=success -f per_page=50 \
  --jq '.workflow_runs[] | "\(.id) \(.head_sha)"')
while read -r id sha; do
  [ -n "$id" ] || continue
  deployed=$(gh api -X GET "repos/$GITHUB_REPOSITORY/actions/runs/$id/jobs" -f per_page=100 \
    --jq '[.jobs[] | select(.name == "deploy-production" and .conclusion == "success")] | length')
  if [ "$deployed" -gt 0 ]; then
    echo "$sha"
    exit 0
  fi
done <<< "$runs"
echo "No successful production deploy on main in the last 50 runs." >&2
exit 1
