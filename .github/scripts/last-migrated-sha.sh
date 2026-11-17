#!/usr/bin/env bash
# Prints the commit of the newest successful Database Migration run on main for one environment
# (staging-db or production-db). Exits non-zero when there is none or the lookup fails, so callers
# fail closed. Needs GH_TOKEN with actions: read, and GITHUB_REPOSITORY.
set -euo pipefail
target=${1:?environment}
# No `status` filter: GitHub serves status-filtered run lists from a search index that can miss a
# run for many minutes after it finishes, so the conclusion is checked here instead.
sha=$(gh api -X GET "repos/$GITHUB_REPOSITORY/actions/workflows/db-migrate.yml/runs" \
  -f branch=main -f per_page=100 \
  --jq "[.workflow_runs[] | select(.display_title == \"Migrate $target\" and .conclusion == \"success\")][0].head_sha // empty")
if [ -z "$sha" ]; then
  echo "No successful Database Migration run for $target on main." >&2
  exit 1
fi
echo "$sha"
