from __future__ import annotations

import os
import platform
import shlex
import shutil
import sys
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]

IS_WINDOWS = os.name == "nt"
IS_MACOS = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")
PLATFORM_LABEL = {
    "darwin": "macOS",
    "win32": "Windows",
    "linux": "Linux",
}.get(sys.platform, platform.system() or "Unknown")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="OCR_",
        env_file=str(PROJECT_ROOT / ".env"),
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "Unlimited OCR Studio"
    version: str = "1.1.0"
    host: str = "127.0.0.1"
    port: int = 8000
    log_level: str = "INFO"

    data_dir: Path = PROJECT_ROOT / "data"
    models_dir: Path = PROJECT_ROOT / "models"
    uocr2_dir: Path = PROJECT_ROOT / "models" / "uocr2"
    llama_server_bin: str | None = None
    model_path: Path | None = None
    mmproj_path: Path | None = None

    llama_port: int = 18080
    llama_port_attempts: int = 20
    ctx_size: int = 32768
    gpu_layers: int = 99
    flash_attn: str = "off"
    llama_threads: int = 0
    llama_extra_args: str = ""
    engine_start_timeout: float = 180.0
    request_timeout: float = 1800.0
    engine_keep_alive: bool = True

    # Unlimited-OCR-2 (original Safetensors weights, run through transformers).
    # device: auto | mps | cuda | cpu (auto picks CUDA, then Metal, then CPU)
    uocr2_device: str = "auto"

    # Deterministic in-process engine used by the offline E2E suite.
    fake_engine: bool = False
    fake_engine_delay: float = 0.01

    max_upload_files: int = 20
    max_upload_mb: int = 80
    max_upload_pages: int = 100
    max_job_pages: int = 50
    default_dpi: int = 200
    min_dpi: int = 120
    max_dpi: int = 400
    default_max_tokens: int = 8192
    min_max_tokens: int = 512
    max_max_tokens: int = 32768

    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:4173,http://127.0.0.1:4173"
    )

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def outputs_dir(self) -> Path:
        return self.data_dir / "outputs"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "tmp"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"

    @property
    def settings_path(self) -> Path:
        return self.data_dir / "settings.json"

    @property
    def engine_pid_path(self) -> Path:
        return self.data_dir / "engine.pid"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def resolved_model_path(self) -> Path | None:
        if self.model_path:
            return self.model_path.expanduser().resolve()
        if not self.models_dir.exists():
            return None
        preferred = self.models_dir / "gguf" / "Unlimited-OCR-Q8_0.gguf"
        if preferred.exists():
            return preferred
        candidates = sorted(
            p
            for p in self.models_dir.rglob("*.gguf")
            if "mmproj" not in p.name.lower() and "projector" not in p.name.lower()
        )
        return candidates[0].resolve() if candidates else None

    @property
    def resolved_mmproj_path(self) -> Path | None:
        if self.mmproj_path:
            return self.mmproj_path.expanduser().resolve()
        if not self.models_dir.exists():
            return None
        preferred = self.models_dir / "gguf" / "mmproj-Unlimited-OCR-F16.gguf"
        if preferred.exists():
            return preferred
        candidates = sorted(
            p for p in self.models_dir.rglob("*.gguf") if "mmproj" in p.name.lower()
        )
        return candidates[0].resolve() if candidates else None

    @property
    def resolved_llama_server(self) -> str | None:
        if self.llama_server_bin:
            candidate = Path(self.llama_server_bin).expanduser()
            if candidate.exists():
                return str(candidate)
            # A user may configure `.../llama-server` on Windows where the
            # real binary is `llama-server.exe`.
            if IS_WINDOWS and candidate.suffix.lower() != ".exe":
                exe = candidate.with_suffix(".exe")
                if exe.exists():
                    return str(exe)
            return self.llama_server_bin
        configured = os.environ.get("LLAMA_SERVER_BIN")
        if configured:
            return configured
        names = ("llama-server.exe", "llama-server") if IS_WINDOWS else ("llama-server",)
        for name in names:
            found = _which(name)
            if found:
                return found
        return None

    # ------------------------------------------------------------------ platform
    @property
    def platform_label(self) -> str:
        return PLATFORM_LABEL

    @property
    def accelerator(self) -> str:
        """Best-effort label for the GPU backend llama.cpp will use."""
        configured = (os.environ.get("OCR_ACCELERATOR") or "").strip()
        if configured:
            return configured
        if IS_MACOS:
            return "Metal"
        if _has_nvidia():
            return "CUDA"
        if shutil.which("vulkaninfo") or (IS_LINUX and Path("/usr/share/vulkan/icd.d").exists()):
            return "Vulkan"
        return "CPU"

    @property
    def llama_label(self) -> str:
        return f"llama.cpp · {self.accelerator}"

    @property
    def download_models_command(self) -> str:
        return "python scripts/download_models.py"

    @property
    def install_llama_hint(self) -> str:
        if IS_MACOS:
            return "Install it with `brew install llama.cpp`, then restart the backend."
        if IS_WINDOWS:
            return (
                "Download a llama.cpp release with llama-server.exe and put it on PATH "
                "(or set OCR_LLAMA_SERVER_BIN), then restart the backend."
            )
        return (
            "Install llama.cpp from your package manager or a release build, put "
            "llama-server on PATH, then restart the backend."
        )

    @property
    def llama_extra_arg_list(self) -> list[str]:
        raw = (self.llama_extra_args or "").strip()
        if not raw:
            return []
        if IS_WINDOWS:
            return shlex.split(raw, posix=False)
        return shlex.split(raw)

    def ensure_dirs(self) -> None:
        for path in (
            self.data_dir,
            self.uploads_dir,
            self.outputs_dir,
            self.logs_dir,
            self.tmp_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)


def _which(binary: str) -> str | None:
    return shutil.which(binary)


def _has_nvidia() -> bool:
    if shutil.which("nvidia-smi"):
        return True
    return IS_LINUX and Path("/proc/driver/nvidia/version").exists()


settings = Settings()
