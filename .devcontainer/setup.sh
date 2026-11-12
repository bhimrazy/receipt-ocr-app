#!/usr/bin/env bash
# Installs the pinned Bun, dependencies and headless Chromium (with its system libraries) for screenshots and e2e.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"

want=$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' package.json)
if [ "$(bun --version 2>/dev/null)" != "$want" ]; then
  # Checksum from the release's SHASUMS256.txt; update both when packageManager changes.
  [ "$want" = 1.4.4 ] || { echo "setup.sh: update the checksum for bun $want" >&2; exit 1; }
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/bun.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$want/bun-linux-x64.zip"
  echo "bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c  $tmp/bun.zip" | sha256sum -c -
  unzip -q "$tmp/bun.zip" -d "$tmp"
  install -Dm755 "$tmp/bun-linux-x64/bun" "$HOME/.local/bin/bun"
  rm -rf "$tmp"
fi

bun install --frozen-lockfile
bun --no-install playwright install --with-deps chromium
