#!/usr/bin/env python3
"""Run the offline test suites on macOS, Linux, or Windows.

    python scripts/test_all.py            # backend + frontend unit tests + build
    python scripts/test_all.py --e2e      # also run the Playwright browser suite

The backend tests use a temporary data directory and never touch the model.
The browser suite runs against the deterministic fake engine
(``OCR_FAKE_ENGINE=1``), so it works on any machine without GPU weights.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
IS_WINDOWS = os.name == "nt"


def venv_python() -> Path:
    if IS_WINDOWS:
        return BACKEND / ".venv" / "Scripts" / "python.exe"
    return BACKEND / ".venv" / "bin" / "python"


def run(command: list[str], *, cwd: Path | None = None) -> None:
    printable = " ".join(command)
    print(f"\n==> {printable}")
    subprocess.run(command, cwd=str(cwd or ROOT), check=True)


def has_module(python: Path, module: str) -> bool:
    return (
        subprocess.run(
            [str(python), "-c", f"import {module}"],
            capture_output=True,
            check=False,
        ).returncode
        == 0
    )


def package_prefix() -> list[str]:
    pnpm = shutil.which("pnpm")
    if pnpm:
        return _executable_prefix([pnpm, "--dir", str(FRONTEND)])
    npm = shutil.which("npm")
    if npm:
        return _executable_prefix([npm, "--prefix", str(FRONTEND)])
    raise SystemExit("Node.js with pnpm or npm is required for the frontend tests.")


def _executable_prefix(prefix: list[str]) -> list[str]:
    """Windows resolves npm/pnpm to .cmd shims, which need cmd.exe."""
    if IS_WINDOWS and prefix and prefix[0].lower().endswith((".cmd", ".bat")):
        return ["cmd", "/c", *prefix]
    return prefix


def backend_tests(python: Path) -> None:
    if has_module(python, "pytest"):
        run([str(python), "-m", "pytest", "-q"], cwd=BACKEND)
    else:
        run([str(python), "-m", "unittest", "discover", "-s", "tests", "-v"], cwd=BACKEND)


def frontend_checks() -> None:
    prefix = package_prefix()
    run([*prefix, "run", "test"])
    run([*prefix, "run", "typecheck"])
    run([*prefix, "run", "build"])


def e2e() -> None:
    prefix = package_prefix()
    run([*prefix, "run", "test:e2e"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--e2e", action="store_true", help="run the Playwright E2E suite")
    parser.add_argument("--backend-only", action="store_true")
    parser.add_argument("--frontend-only", action="store_true")
    args = parser.parse_args()

    python = venv_python()
    if not python.exists():
        raise SystemExit("backend/.venv is missing; run `python scripts/start.py` once first.")

    if not args.frontend_only:
        backend_tests(python)
    if not args.backend_only:
        frontend_checks()
        if args.e2e:
            e2e()

    print("\nAll checks passed.")


if __name__ == "__main__":
    main()
