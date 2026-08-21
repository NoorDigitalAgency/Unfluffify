#!/usr/bin/env sh
set -eu

if ! command -v npx >/dev/null 2>&1; then
  echo "P18 requires npx to run pinned @playwright/cli@0.1.17." >&2
  exit 1
fi

exec npx --yes --package @playwright/cli@0.1.17 playwright-cli "$@"
