#!/usr/bin/env python3
"""Install the optional PyTorch stack used by the Unlimited-OCR-2 engine.

    python scripts/install_inference.py

The GGUF + llama.cpp path needs none of this. Run this only if you want the
original BF16 Safetensors engine. The wheels are large (~2-4 GB) and the
correct build depends on the platform:

* macOS:      pip's default wheel uses Metal (MPS).
* Linux:      pip's default wheel includes CUDA; add `--cpu` for CPU-only.
* Windows:    pip's default wheel includes CUDA; add `--cpu` for CPU-only.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IS_WINDOWS = os.name == "nt"


def venv_python() -> Path:
    if IS_WINDOWS:
        return ROOT / "backend" / ".venv" / "Scripts" / "python.exe"
    return ROOT / "backend" / ".venv" / "bin" / "python"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cpu", action="store_true", help="install CPU-only PyTorch on Linux/Windows")
    parser.add_argument("--upgrade", action="store_true", help="upgrade existing packages")
    args = parser.parse_args()

    python = venv_python()
    if not python.exists():
        raise SystemExit("backend/.venv is missing; run `python scripts/start.py` once first.")

    common = [str(python), "-m", "pip", "install"]
    if args.upgrade:
        common.append("--upgrade")

    if args.cpu and sys.platform != "darwin":
        torch_command = [
            *common,
            "--index-url",
            "https://download.pytorch.org/whl/cpu",
            "torch",
            "torchvision",
        ]
        print("==> " + " ".join(torch_command))
        subprocess.run(torch_command, check=True)
        rest = ["transformers", "accelerate", "einops", "addict", "easydict"]
    else:
        rest = ["torch", "torchvision", "transformers", "accelerate", "einops", "addict", "easydict"]

    command = [*common, *rest]
    print("==> " + " ".join(command))
    subprocess.run(command, check=True)
    print("\nDone. Restart the backend, then choose Unlimited-OCR-2 in Settings.")


if __name__ == "__main__":
    main()
