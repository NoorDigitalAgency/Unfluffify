#!/usr/bin/env bash
set -euo pipefail

if ! command -v npx >/dev/null 2>&1; then
  echo "P14 requires npx to run pinned @playwright/cli@0.1.17." >&2
  exit 127
fi

exec npx --yes --package @playwright/cli@0.1.17 playwright-cli "$@"
