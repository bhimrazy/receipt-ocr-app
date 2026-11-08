#!/usr/bin/env bash
# Prints the files changed between two commits that change what Vercel deploys. Docs, Markdown,
# tests, benchmarks, repo scripts and CI config don't; the Vercel CLI lockfile does.
# Usage: shipped-files.sh <base> <head>. Prints nothing when no shipped file changed.
set -euo pipefail
# grep exits 1 when every file is filtered out; that's the "nothing shipped" answer, not an error.
git diff --name-only --no-renames "$1" "$2" |
  { grep -vE '^(docs|packages/bench|scripts)/|\.md$|\.test\.tsx?$|^apps/web/e2e/|^\.github/|^(knip\.json|\.prettier[a-z]*|\.gitignore)$' || true; }
git diff --name-only --no-renames "$1" "$2" -- .github/vercel-cli/
