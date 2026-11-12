#!/usr/bin/env bash
# Installs dependencies and headless Chromium (with its system libraries) for screenshots and e2e.
set -euo pipefail

if ! command -v bun >/dev/null; then
  echo "bun is not installed; install the version in package.json's packageManager, then rerun this script." >&2
  exit 1
fi

bun install --frozen-lockfile
bun --no-install playwright install chromium
sudo "$(command -v bun)" --no-install playwright install-deps chromium
