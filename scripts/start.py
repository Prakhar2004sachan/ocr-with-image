#!/usr/bin/env python3
"""Start the Unlimited OCR Studio on macOS, Linux, or Windows.

    python scripts/start.py            # dev: FastAPI :8000 + Vite :5173
    python scripts/start.py --prod     # build the UI and serve it from FastAPI

The script creates the backend virtualenv and installs frontend dependencies on
first run. Logs and PID files live under ``.run/``. Stop everything with
``python scripts/stop.py``.
"""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
RUN = ROOT / ".run"
IS_WINDOWS = os.name == "nt"


def _use_backend_venv_modules() -> None:
    """Make `psutil` available to the launcher before the venv is created."""
    venv = BACKEND / ".venv"
    if IS_WINDOWS:
        candidates = [venv / "Lib" / "site-packages"]
    else:
        candidates = sorted((venv / "lib").glob("python*/site-packages"))
    for candidate in candidates:
        if candidate.exists() and str(candidate) not in sys.path:
            sys.path.insert(0, str(candidate))


_use_backend_venv_modules()
HOST = os.environ.get("OCR_HOST", "127.0.0.1")
PORT = int(os.environ.get("OCR_PORT", "8000"))
VITE_PORT = int(os.environ.get("VITE_PORT", "5173"))


def venv_python() -> Path:
    if IS_WINDOWS:
        return BACKEND / ".venv" / "Scripts" / "python.exe"
    return BACKEND / ".venv" / "bin" / "python"


def python_ok() -> bool:
    python = venv_python()
    if not python.exists():
        return False
    check = subprocess.run(
        [
            str(python),
            "-c",
            "import fastapi, uvicorn, httpx, pymupdf, PIL, pillow_heif, psutil, multipart, pydantic_settings, huggingface_hub",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return check.returncode == 0


def ensure_backend() -> Path:
    RUN.mkdir(parents=True, exist_ok=True)
    if not venv_python().exists():
        print("==> Creating backend/.venv")
        subprocess.run([sys.executable, "-m", "venv", str(BACKEND / ".venv")], check=True)
    if not python_ok():
        print("==> Installing backend dependencies")
        python = str(venv_python())
        uv = shutil.which("uv")
        if uv:
            subprocess.run(
                [uv, "pip", "install", "--python", python, "-r", str(BACKEND / "requirements.txt")],
                check=True,
            )
        else:
            # uv-created virtualenvs do not always ship pip.
            subprocess.run(
                [python, "-m", "ensurepip", "--upgrade"],
                check=False,
                stdout=subprocess.DEVNULL,
            )
            subprocess.run(
                [python, "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt")],
                check=True,
            )
    return venv_python()


def package_runner() -> tuple[list[str], str]:
    """Return the frontend command prefix and a human-readable manager name."""
    pnpm = shutil.which("pnpm")
    if pnpm:
        return _executable_prefix([pnpm, "--dir", str(FRONTEND)]), "pnpm"
    npm = shutil.which("npm")
    if npm:
        return _executable_prefix([npm, "--prefix", str(FRONTEND)]), "npm"
    raise SystemExit(
        "Node.js 20+ is required for the frontend. Install Node, then rerun this script."
    )


def _executable_prefix(prefix: list[str]) -> list[str]:
    """Windows resolves npm/pnpm to .cmd shims, which need cmd.exe."""
    if IS_WINDOWS and prefix and prefix[0].lower().endswith((".cmd", ".bat")):
        return ["cmd", "/c", *prefix]
    return prefix


def ensure_frontend(prod: bool) -> list[str] | None:
    if not (FRONTEND / "package.json").exists():
        return None
    prefix, manager = package_runner()
    if not (FRONTEND / "node_modules").exists():
        print(f"==> Installing frontend dependencies ({manager})")
        subprocess.run([*prefix, "install"], check=True)
    if prod:
        print("==> Building frontend/dist")
        build = "build"
        subprocess.run([*prefix, "run", build], check=True)
        return None
    return prefix


def popen(command: list[str], *, cwd: Path, log_name: str) -> subprocess.Popen[bytes]:
    RUN.mkdir(parents=True, exist_ok=True)
    log_path = RUN / log_name
    handle = log_path.open("ab")
    kwargs: dict[str, object] = {
        "cwd": str(cwd),
        "stdout": handle,
        "stderr": subprocess.STDOUT,
        "stdin": subprocess.DEVNULL,
    }
    if IS_WINDOWS:
        kwargs["creationflags"] = (
            getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        )
    else:
        kwargs["start_new_session"] = True
    process = subprocess.Popen(command, **kwargs)  # type: ignore[arg-type]
    return process


def write_pid(name: str, pid: int) -> None:
    (RUN / f"{name}.pid").write_text(str(pid), encoding="ascii")


def _pid_belongs_to_studio(pid: int, name: str) -> bool:
    """Verify a PID file still points at our process, not a reused PID."""
    try:
        import psutil

        process = psutil.Process(pid)
        args = " ".join(process.cmdline()).lower()
    except Exception:
        if IS_WINDOWS:
            return False
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        # Without psutil we cannot inspect the command line; trust the PID file
        # only on POSIX where the process still exists.
        return True
    if name == "backend":
        return "uvicorn" in args and "app.main" in args
    if name == "frontend":
        return "vite" in args
    return False


def pid_alive(name: str) -> bool:
    path = RUN / f"{name}.pid"
    if not path.exists():
        return False
    try:
        pid = int(path.read_text("ascii").strip())
    except (OSError, ValueError):
        return False
    return _pid_belongs_to_studio(pid, name)


def wait_for_http(url: str, timeout: float = 90.0, label: str = "backend") -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(0.5)
    print(f"!! The {label} did not answer at {url} within {int(timeout)}s.")
    return False


def wait_for_port(port: int, timeout: float = 60.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            try:
                sock.connect(("127.0.0.1", port))
                return True
            except OSError:
                pass
        time.sleep(0.3)
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prod", action="store_true", help="build and serve the UI from FastAPI")
    parser.add_argument("--no-frontend", action="store_true", help="start only the backend")
    parser.add_argument(
        "--restart",
        action="store_true",
        help="stop any running studio processes first (apply backend code changes)",
    )
    args = parser.parse_args()

    if args.restart:
        print("==> Restarting: stopping the running studio first")
        stop_script = ROOT / "scripts" / "stop.py"
        # Prefer the backend venv's Python; it definitely has psutil, which the
        # stop script uses to verify process identities before terminating.
        stop_python = venv_python()
        runner = stop_python if stop_python.exists() else Path(sys.executable)
        subprocess.run([str(runner), str(stop_script)], check=False)
        time.sleep(1)

    if pid_alive("backend"):
        print(f"Backend already running (pid {(RUN / 'backend.pid').read_text().strip()})")
    else:
        python = ensure_backend()
        log = RUN / "backend.log"
        log.write_text("", encoding="utf-8")
        print(f"==> Backend on http://{HOST}:{PORT}")
        process = popen(
            [
                str(python),
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                HOST,
                "--port",
                str(PORT),
            ],
            cwd=BACKEND,
            log_name="backend.log",
        )
        write_pid("backend", process.pid)
        if not wait_for_http(f"http://{HOST}:{PORT}/api/health", label="backend"):
            print(f"   Check {log} for the startup error.")
            return

    frontend_prefix = None if args.no_frontend else ensure_frontend(args.prod)
    if frontend_prefix is not None:
        if pid_alive("frontend"):
            print("Frontend already running")
        else:
            node = shutil.which("node")
            if not node:
                raise SystemExit("Node.js 20+ is required for the frontend.")
            vite_bin = FRONTEND / "node_modules" / "vite" / "bin" / "vite.js"
            print(f"==> Frontend on http://127.0.0.1:{VITE_PORT}")
            process = popen(
                [
                    node,
                    str(vite_bin),
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(VITE_PORT),
                    "--strictPort",
                ],
                cwd=FRONTEND,
                log_name="frontend.log",
            )
            write_pid("frontend", process.pid)
            wait_for_port(VITE_PORT, timeout=45)

    url = f"http://{HOST}:{PORT}" if args.prod or args.no_frontend else f"http://localhost:{VITE_PORT}"
    print()
    print(f"Studio ready at {url}")
    print(f"Logs: {RUN}")
    print(f"Stop with: {sys.executable} scripts/stop.py")


if __name__ == "__main__":
    main()
