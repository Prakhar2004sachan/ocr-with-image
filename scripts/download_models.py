#!/usr/bin/env python3
"""Download the Unlimited-OCR weights used by the studio (all platforms).

Examples
--------
    python scripts/download_models.py
    python scripts/download_models.py --model gguf --quant Q4_K_M
    python scripts/download_models.py --model uocr2

The GGUF build is served by llama.cpp. The ``uocr2`` option fetches Baidu's
original Safetensors checkpoint, which the transformers engine loads directly.
Files land in ``models/`` inside the project; nothing is read from a global
Hugging Face cache at runtime.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GGUF_REPO = "sahilchachra/Unlimited-OCR-GGUF"
UOCR2_REPO = "baidu/Unlimited-OCR-2"
GGUF_DIR = ROOT / "models" / "gguf"
UOCR2_DIR = ROOT / "models" / "uocr2"


def _hub():
    try:
        from huggingface_hub import hf_hub_download, snapshot_download
    except Exception as exc:
        raise SystemExit(
            "huggingface_hub is missing. Install it with:\n"
            f"  {sys.executable} -m pip install --upgrade huggingface_hub"
        ) from exc
    return hf_hub_download, snapshot_download


def download_gguf(quant: str) -> None:
    hf_hub_download, _ = _hub()
    model_file = f"Unlimited-OCR-{quant}.gguf"
    mmproj_file = "mmproj-Unlimited-OCR-F16.gguf"
    GGUF_DIR.mkdir(parents=True, exist_ok=True)
    for name in (model_file, mmproj_file):
        print(f"==> {name}")
        path = hf_hub_download(
            repo_id=GGUF_REPO,
            filename=name,
            local_dir=str(GGUF_DIR),
        )
        # hf_hub_download may place files in a nested cache layout on some
        # versions; normalise them next to each other for the backend.
        target = GGUF_DIR / name
        source = Path(path)
        if source.resolve() != target.resolve():
            if target.exists():
                target.unlink()
            shutil.copy2(source, target)
    for name in (model_file, mmproj_file):
        if not (GGUF_DIR / name).exists():
            raise SystemExit(f"Expected {GGUF_DIR / name}; the download was incomplete.")
    print("\nReady:")
    for name in (model_file, mmproj_file):
        path = GGUF_DIR / name
        print(f"  {path} ({path.stat().st_size / 1e9:.2f} GB)")


def download_uocr2() -> None:
    _, snapshot_download = _hub()
    UOCR2_DIR.mkdir(parents=True, exist_ok=True)
    print(f"==> {UOCR2_REPO} -> {UOCR2_DIR}")
    snapshot_download(repo_id=UOCR2_REPO, local_dir=str(UOCR2_DIR))
    required = ("config.json", "tokenizer_config.json", "tokenizer.json")
    missing = [name for name in required if not (UOCR2_DIR / name).exists()]
    shards = sorted(UOCR2_DIR.glob("model-*.safetensors"))
    if missing or not shards:
        raise SystemExit(
            "The Unlimited-OCR-2 download is incomplete: "
            f"missing={missing or 'none'} shards={len(shards)}"
        )
    print(f"\nReady: {UOCR2_DIR} ({len(shards)} safetensors shards)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model",
        choices=("gguf", "uocr2", "all"),
        default="gguf",
        help="which weights to download (default: gguf)",
    )
    parser.add_argument("--quant", default="Q8_0", help="GGUF quantization (default: Q8_0)")
    args = parser.parse_args()

    if args.model in {"gguf", "all"}:
        download_gguf(args.quant)
    if args.model in {"uocr2", "all"}:
        download_uocr2()
    print("\nStart the studio with: python scripts/start.py")


if __name__ == "__main__":
    main()
