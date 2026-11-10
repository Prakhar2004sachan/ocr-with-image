#!/usr/bin/env bash
# Run the offline suites (backend + frontend). Add E2E=1 for Playwright.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARGS=()
if [[ "${E2E:-0}" == "1" ]]; then
  ARGS+=(--e2e)
fi
exec python3 "$ROOT/scripts/test_all.py" "${ARGS[@]}" "$@"
