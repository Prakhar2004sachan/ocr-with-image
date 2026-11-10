#!/usr/bin/env bash
# Download model weights (macOS/Linux). Windows: scripts\download-models.cmd
#
#   bash scripts/download-models.sh                    # GGUF Q8_0
#   QUANT=Q4_K_M bash scripts/download-models.sh
#   bash scripts/download-models.sh --model uocr2      # original Safetensors
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARGS=()
if [[ -n "${QUANT:-}" ]]; then
  ARGS+=(--quant "$QUANT")
fi
exec python3 "$ROOT/scripts/download_models.py" "${ARGS[@]}" "$@"
