#!/usr/bin/env bash
# Cross-platform stop wrapper (macOS/Linux). Windows: scripts\stop.cmd
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$ROOT/scripts/stop.py" "$@"
