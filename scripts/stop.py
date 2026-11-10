#!/usr/bin/env python3
"""Stop the studio processes started by ``scripts/start.py`` on any platform."""

from __future__ import annotations

import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / ".run"
IS_WINDOWS = os.name == "nt"


def _ensure_venv_python() -> None:
    """Re-exec using backend/.venv python if invoked via system python to avoid ABI mismatch with psutil."""
    venv_py = ROOT / "backend" / ".venv" / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")
    if venv_py.exists():
        try:
            if Path(sys.executable).resolve() != venv_py.resolve():
                os.execv(str(venv_py), [str(venv_py), *sys.argv])
        except Exception:
            pass


_ensure_venv_python()


def _use_backend_venv_modules() -> None:
    """`psutil` lives in backend/.venv, not in the system Python.

    Without this, the process-identity checks below cannot import psutil and
    every PID is treated as stale, so `stop.py` silently refuses to stop the
    backend. That made `start.py --restart` a no-op on machines whose system
    Python is bare.
    """
    venv = ROOT / "backend" / ".venv"
    if IS_WINDOWS:
        candidates = [venv / "Lib" / "site-packages"]
    else:
        candidates = sorted((venv / "lib").glob("python*/site-packages"))
    for candidate in candidates:
        if candidate.exists() and str(candidate) not in sys.path:
            sys.path.insert(0, str(candidate))


_use_backend_venv_modules()


def terminate_tree(pid: int) -> None:
    try:
        import psutil
    except Exception:
        if IS_WINDOWS:
            os.system(f"taskkill /PID {pid} /T /F >NUL 2>&1")
        else:
            try:
                os.kill(pid, 15)
            except OSError:
                pass
        return
    try:
        process = psutil.Process(pid)
    except psutil.Error:
        return
    children = []
    try:
        children = process.children(recursive=True)
    except psutil.Error:
        pass
    for item in [*children, process]:
        try:
            item.terminate()
        except psutil.Error:
            pass
    _, alive = psutil.wait_procs([*children, process], timeout=10)
    for item in alive:
        try:
            item.kill()
        except psutil.Error:
            pass


def _belongs_to_studio(pid: int, name: str) -> bool:
    """Never kill a PID that was reused by an unrelated process."""
    try:
        import psutil

        args = " ".join(psutil.Process(pid).cmdline()).lower()
    except Exception:
        if IS_WINDOWS:
            return False
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True
    if name == "backend":
        return "uvicorn" in args and "app.main" in args
    if name == "frontend":
        return "vite" in args
    return False


def stop_pid(name: str) -> None:
    path = RUN / f"{name}.pid"
    if not path.exists():
        return
    try:
        pid = int(path.read_text("ascii").strip())
    except (OSError, ValueError):
        path.unlink(missing_ok=True)
        return
    if _belongs_to_studio(pid, name):
        print(f"Stopping {name} (pid {pid})")
        terminate_tree(pid)
    else:
        print(f"Skipping stale {name} PID file (pid {pid})")
    path.unlink(missing_ok=True)


def request_engine_stop() -> None:
    host = os.environ.get("OCR_HOST", "127.0.0.1")
    port = os.environ.get("OCR_PORT", "8000")
    request = urllib.request.Request(
        f"http://{host}:{port}/api/system/engine/stop", method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=8):
            pass
    except Exception:
        pass


def stop_engine_pid() -> None:
    pid_path = ROOT / "data" / "engine.pid"
    if not pid_path.exists():
        return
    try:
        pid = int(pid_path.read_text("ascii").strip())
    except (OSError, ValueError):
        pid_path.unlink(missing_ok=True)
        return
    try:
        import psutil

        args = " ".join(psutil.Process(pid).cmdline()).lower()
    except Exception:
        args = ""
    if "llama-server" in args:
        print(f"Stopping llama-server (pid {pid})")
        terminate_tree(pid)
    pid_path.unlink(missing_ok=True)


def main() -> None:
    # Ask the backend to unload the engine first, while its API is still up.
    request_engine_stop()
    stop_pid("frontend")
    stop_pid("backend")
    stop_engine_pid()
    print("Stopped.")


if __name__ == "__main__":
    main()
