#!/usr/bin/env bash
# Prints the commit of the newest Vercel Production Deployment run on main whose deploy-production
# job succeeded (a run whose gate skipped the deploy also ends "success", so the job is checked).
# Looks at the last 50 successful runs. Exits non-zero when there is none or the lookup fails, so
# callers fail closed. Needs GH_TOKEN with actions: read, and GITHUB_REPOSITORY.
set -euo pipefail
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
