#!/usr/bin/env bash
# Cross-platform launcher wrapper (macOS/Linux). Windows: scripts\start.cmd
#
#   bash scripts/start.sh            # dev: FastAPI :8000, Vite :5173
#   MODE=prod bash scripts/start.sh  # build and serve the UI from FastAPI
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARGS=()
if [[ "${MODE:-dev}" == "prod" ]]; then
  ARGS+=(--prod)
fi
exec python3 "$ROOT/scripts/start.py" "${ARGS[@]}" "$@"
