from __future__ import annotations

import asyncio
import base64
import json
import mimetypes
import os
import re
import socket
import subprocess
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import httpx
import psutil

from ..config import IS_WINDOWS, Settings
from ..errors import EngineUnavailableError, ModelMissingError
from ..schemas import EngineStatus, ModelFile, ModelStatus
from ..utils import iso_now

DeltaCallback = Callable[[str], Awaitable[None] | None]


class GenerationResult:
    def __init__(
        self,
        text: str,
        *,
        finish_reason: str | None,
        prompt_tokens: int | None,
        completion_tokens: int | None,
        duration_ms: int,
        canceled: bool = False,
    ) -> None:
        self.text = text
        self.finish_reason = finish_reason
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.duration_ms = duration_ms
        self.canceled = canceled


class LlamaEngine:
    engine_type = "llama_cpp"

    def __init__(self, config: Settings) -> None:
        self.config = config
        self.status: str = "stopped"
        self.port: int | None = None
        self.pid: int | None = None
        self.model_id: str = "unlimited-ocr"
        self.started_at: str | None = None
        self.last_error: str | None = None
        self.command: list[str] | None = None
        self._process: asyncio.subprocess.Process | None = None
        self._client: httpx.AsyncClient | None = None
        self._lock = asyncio.Lock()
        self._monitor_task: asyncio.Task | None = None
        self._version: str | None = None
        self.log_path = config.logs_dir / "llama-server.log"
        self._failure_count = 0

    # ------------------------------------------------------------------ status
    def model_status(self) -> ModelStatus:
        model_path = self.config.resolved_model_path
        mmproj_path = self.config.resolved_mmproj_path
        model = _model_file(model_path, self.config.models_dir)
        mmproj = _model_file(mmproj_path, self.config.models_dir)
        ready = bool(model and model.exists and mmproj and mmproj.exists)
        if ready:
            message = "Model ready · local GGUF"
        elif not model or not model.exists:
            message = "The OCR model is missing from ./models."
        elif not mmproj or not mmproj.exists:
            message = "The vision projector (mmproj) is missing from ./models."
        else:
            message = "The OCR model is not ready."
        download = self.config.download_models_command if not ready else None
        return ModelStatus(
            ready=ready,
            model=model,
            mmproj=mmproj,
            message=message,
            download_command=download,
            engine="llama_cpp",
        )

    def status_model(self) -> EngineStatus:
        return EngineStatus(
            status=self.status,  # type: ignore[arg-type]
            port=self.port,
            pid=self.pid,
            model=self.config.resolved_model_path.name
            if self.config.resolved_model_path
            else None,
            backend=self.config.llama_label,
            started_at=self.started_at,
            last_error=self.last_error,
            log_tail=self.log_tail(30),
            engine_type="llama_cpp",
            device=self.config.accelerator,
            ready=self.model_status().ready,
        )

    def log_tail(self, lines: int = 80) -> list[str]:
        if not self.log_path.exists():
            return []
        try:
            with self.log_path.open("rb") as handle:
                handle.seek(0, os.SEEK_END)
                size = handle.tell()
                handle.seek(max(0, size - 48_000))
                data = handle.read().decode("utf-8", "replace")
            return [line for line in data.splitlines() if line.strip()][-lines:]
        except OSError:
            return []

    def version(self) -> str | None:
        if self._version is not None:
            return self._version
        binary = self.config.resolved_llama_server
        if not binary:
            return None
        try:
            completed = subprocess.run(
                [binary, "--version"], capture_output=True, text=True, timeout=8, check=False
            )
            text = (completed.stdout or completed.stderr or "").strip()
            self._version = _parse_version(text)
        except Exception:
            self._version = None
        return self._version

    # ------------------------------------------------------------------ lifecycle
    async def ensure_started(self) -> None:
        if self.status == "ready" and self._process and self._process.returncode is None:
            return
        await self.start()

    async def start(self) -> None:
        async with self._lock:
            if self._process and self._process.returncode is None:
                if self.status == "ready":
                    return
                # A start is already in flight.
                return

            self.model_status_verified()
            binary = self.config.resolved_llama_server
            model_path = self.config.resolved_model_path
            mmproj_path = self.config.resolved_mmproj_path
            if not binary:
                self.status = "error"
                self.last_error = (
                    "llama-server was not found. " + self.config.install_llama_hint
                )
                raise EngineUnavailableError(
                    self.last_error,
                    hint=f"Download the model with `{self.config.download_models_command}`.",
                )
            if not model_path or not model_path.exists():
                self.status = "error"
                self.last_error = "The OCR model is missing."
                raise ModelMissingError(
                    self.last_error, hint=f"Run `{self.config.download_models_command}`."
                )
            if not mmproj_path or not mmproj_path.exists():
                self.status = "error"
                self.last_error = "The vision projector (mmproj) is missing."
                raise ModelMissingError(
                    self.last_error, hint=f"Run `{self.config.download_models_command}`."
                )

            await self._stop_previous_process()
            self.status = "starting"
            self.last_error = None
            self._failure_count = 0
            port = self._find_port()
            self.port = port
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            log_handle = self.log_path.open("a", encoding="utf-8")
            log_handle.write(
                f"\n===== starting engine {iso_now()} =====\n"
                f"model: {model_path}\nmmproj: {mmproj_path}\nport: {port}\n"
            )
            log_handle.flush()

            command = [
                binary,
                "-m",
                str(model_path),
                "--mmproj",
                str(mmproj_path),
                "--jinja",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "-c",
                str(self.config.ctx_size),
                "-ngl",
                str(self.config.gpu_layers),
                "--flash-attn",
                self.config.flash_attn,
                "--temp",
                "0",
                "--parallel",
                "1",
                "--no-warmup",
            ]
            if self.config.llama_threads > 0:
                command.extend(["--threads", str(self.config.llama_threads)])
            command.extend(self.config.llama_extra_arg_list)
            self.command = command
            try:
                process = await asyncio.create_subprocess_exec(
                    *command,
                    stdout=log_handle,
                    stderr=asyncio.subprocess.STDOUT,
                    **self._spawn_options(),
                )
            except Exception as exc:
                log_handle.close()
                self.status = "error"
                self.last_error = f"Could not launch llama-server: {exc}"
                raise EngineUnavailableError(self.last_error, hint=self.config.install_llama_hint) from exc

            self._process = process
            self.pid = process.pid
            self._write_pid(process.pid)
            try:
                await self._wait_for_health(process)
            except Exception as exc:
                self.status = "error"
                self.last_error = str(exc)
                await self._kill_process()
                log_handle.close()
                raise EngineUnavailableError(
                    str(exc),
                    hint="Open Settings → Engine logs for the full llama.cpp output.",
                ) from exc
            finally:
                log_handle.close()

            if process.returncode is not None:
                self.status = "error"
                self.last_error = "llama-server exited during startup."
                raise EngineUnavailableError(self.last_error, hint="Check the engine log.")

            self.status = "ready"
            self.started_at = iso_now()
            self._client = httpx.AsyncClient(
                base_url=f"http://127.0.0.1:{port}",
                timeout=httpx.Timeout(
                    connect=10.0,
                    read=self.config.request_timeout,
                    write=120.0,
                    pool=10.0,
                ),
                limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
            )
            await self._read_model_id()

    def model_status_verified(self) -> None:
        status = self.model_status()
        if not status.ready:
            self.status = "error"
            self.last_error = status.message

    async def _wait_for_health(self, process: asyncio.subprocess.Process) -> None:
        deadline = asyncio.get_running_loop().time() + self.config.engine_start_timeout
        url = f"http://127.0.0.1:{self.port}/health"
        async with httpx.AsyncClient(timeout=2.0) as client:
            while asyncio.get_running_loop().time() < deadline:
                if process.returncode is not None:
                    tail = "\n".join(self.log_tail(20))
                    raise RuntimeError(
                        "llama-server exited before it became ready.\n"
                        + (tail or "No engine log was produced.")
                    )
                try:
                    response = await client.get(url)
                    if response.status_code == 200:
                        return
                except Exception:
                    pass
                await asyncio.sleep(0.5)
        tail = "\n".join(self.log_tail(30))
        raise RuntimeError(
            f"llama-server did not become ready within {int(self.config.engine_start_timeout)}s.\n"
            + (tail or "No engine log was produced.")
        )

    async def _read_model_id(self) -> None:
        if not self._client:
            return
        try:
            response = await self._client.get("/v1/models")
            if response.status_code == 200:
                data = response.json()
                items = data.get("data") or []
                if items and items[0].get("id"):
                    self.model_id = items[0]["id"]
        except Exception:
            self.model_id = "unlimited-ocr"

    async def stop(self) -> None:
        async with self._lock:
            await self._kill_process()
            self.status = "stopped"
            self.started_at = None
            self.port = None

    async def restart(self) -> None:
        await self.stop()
        await self.start()

    async def _kill_process(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None
        process = self._process
        self._process = None
        pid = self.pid
        self.pid = None
        if process and process.returncode is None:
            await asyncio.to_thread(_terminate_tree, process.pid, 10.0)
            try:
                await asyncio.wait_for(process.wait(), timeout=10)
            except TimeoutError:
                try:
                    process.kill()
                except (ProcessLookupError, PermissionError):
                    pass
        elif pid is None:
            # A stale PID file from a previous backend process (e.g. the API
            # crashed) should not leave an orphaned server behind.
            stale = self._read_pid()
            if stale and _looks_like_llama_server(stale):
                await asyncio.to_thread(_terminate_tree, stale, 5.0)
        self.config.engine_pid_path.unlink(missing_ok=True)

    async def _stop_previous_process(self) -> None:
        pid = self._read_pid()
        if not pid:
            return
        if await asyncio.to_thread(_looks_like_llama_server, pid):
            await asyncio.to_thread(_terminate_tree, pid, 10.0)
        self.config.engine_pid_path.unlink(missing_ok=True)

    @staticmethod
    def _spawn_options() -> dict[str, Any]:
        """Platform-safe subprocess options for a detached engine process."""
        if IS_WINDOWS:
            # CREATE_NEW_PROCESS_GROUP lets us send Ctrl-Break if needed and
            # CREATE_NO_WINDOW keeps a console window from flashing on launch.
            flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            flags |= getattr(subprocess, "CREATE_NO_WINDOW", 0)
            return {"creationflags": flags}
        return {"start_new_session": True}

    def _write_pid(self, pid: int) -> None:
        self.config.engine_pid_path.write_text(str(pid), encoding="ascii")

    def _read_pid(self) -> int | None:
        try:
            return int(self.config.engine_pid_path.read_text("ascii").strip())
        except (OSError, ValueError):
            return None

    def _find_port(self) -> int:
        for offset in range(self.config.llama_port_attempts):
            port = self.config.llama_port + offset
            if _port_free(port):
                return port
        raise EngineUnavailableError(
            f"No free port found between {self.config.llama_port} and "
            f"{self.config.llama_port + self.config.llama_port_attempts - 1}."
        )

    # ------------------------------------------------------------------ inference
    async def ocr(
        self,
        *,
        image_paths: list[str],
        prompt: str,
        max_tokens: int,
        temperature: float = 0.0,
        on_delta: DeltaCallback | None = None,
        cancel_check: Callable[[], bool] | None = None,
    ) -> GenerationResult:
        """Model-agnostic OCR entry point shared with the transformers engine.

        Unlimited-OCR-1 through llama.cpp expects one ``image_url`` content part
        per page followed by the prompt text.
        """
        await self.ensure_started()
        content: list[dict[str, Any]] = []
        for relative in image_paths:
            path = _data_path(self.config.data_dir, relative)
            data = base64.b64encode(path.read_bytes()).decode("ascii")
            mime = mimetypes.guess_type(path.name)[0] or "image/png"
            content.append(
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data}"}}
            )
        content.append({"type": "text", "text": prompt})
        return await self.generate(
            [{"role": "user", "content": content}],
            max_tokens=max_tokens,
            temperature=temperature,
            on_delta=on_delta,
            cancel_check=cancel_check,
        )

    async def generate(
        self,
        messages: list[dict[str, Any]],
        *,
        max_tokens: int,
        temperature: float = 0.0,
        top_p: float = 1.0,
        seed: int = -1,
        on_delta: DeltaCallback | None = None,
        cancel_check: Callable[[], bool] | None = None,
    ) -> GenerationResult:
        await self.ensure_started()
        if not self._client:
            raise EngineUnavailableError("The inference engine is not ready.")

        payload: dict[str, Any] = {
            "model": self.model_id,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "seed": seed,
            "stream": True,
            "stream_options": {"include_usage": True},
            "repeat_penalty": 1.0,
            "cache_prompt": False,
        }

        started = asyncio.get_running_loop().time()
        chunks: list[str] = []
        finish_reason: str | None = None
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        canceled = False

        try:
            async with self._client.stream(
                "POST", "/v1/chat/completions", json=payload
            ) as response:
                if response.status_code >= 400:
                    body = await response.aread()
                    message = _error_message(body, response.status_code)
                    raise EngineUnavailableError(
                        message,
                        hint="The engine rejected the request. Check the engine log for details.",
                    )
                async for line in response.aiter_lines():
                    if cancel_check and cancel_check():
                        canceled = True
                        break
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    usage = event.get("usage")
                    if usage:
                        prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                        completion_tokens = usage.get("completion_tokens", completion_tokens)
                    timings = event.get("timings")
                    if timings:
                        prompt_tokens = timings.get("prompt_n", prompt_tokens)
                        completion_tokens = timings.get("predicted_n", completion_tokens)
                    choices = event.get("choices") or []
                    if not choices:
                        continue
                    choice = choices[0]
                    if choice.get("finish_reason"):
                        finish_reason = choice["finish_reason"]
                    delta = (choice.get("delta") or {}).get("content") or ""
                    if delta:
                        chunks.append(delta)
                        if on_delta:
                            result = on_delta(delta)
                            if asyncio.iscoroutine(result):
                                await result
        except httpx.HTTPError as exc:
            self.status = "error"
            self.last_error = f"The engine connection failed: {exc}"
            raise EngineUnavailableError(
                self.last_error,
                hint="Restart the engine from Settings, then try again.",
            ) from exc

        elapsed_ms = int((asyncio.get_running_loop().time() - started) * 1000)
        text = "".join(chunks)
        if completion_tokens is None:
            completion_tokens = max(1, round(len(text) / 3.5)) if text else 0
        if prompt_tokens is None:
            prompt_tokens = 0
        return GenerationResult(
            text,
            finish_reason="canceled" if canceled else finish_reason,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            duration_ms=elapsed_ms,
            canceled=canceled,
        )

    async def monitor(self) -> None:
        while True:
            await asyncio.sleep(5)
            if self._process is None:
                if self.status == "ready":
                    self.status = "error"
                    self.last_error = "The inference engine is not running."
                continue
            if self._process.returncode is not None:
                self.status = "error"
                self.last_error = (
                    f"llama-server exited with code {self._process.returncode}. "
                    "Check the engine log."
                )
                self._process = None
                self.pid = None
                continue
            if self.status == "ready" and self._client:
                try:
                    response = await self._client.get("/health", timeout=3.0)
                    if response.status_code == 200:
                        self._failure_count = 0
                    else:
                        self._failure_count += 1
                except Exception:
                    self._failure_count += 1
                if self._failure_count >= 3:
                    self.status = "error"
                    self.last_error = "The inference engine stopped responding."


def _model_file(path: Path | None, models_dir: Path) -> ModelFile | None:
    if not path:
        return None
    try:
        relative = path.relative_to(models_dir)
        display = f"models/{relative}"
    except ValueError:
        display = str(path)
    return ModelFile(
        name=path.name,
        path=str(path),
        exists=path.exists(),
        size=path.stat().st_size if path.exists() else None,
        expected=display,
    )


def _parse_version(text: str) -> str | None:
    """Pull a version string out of llama.cpp's `--version` banner.

    The binary prints a leading log line such as
    ``0.00.000.441 I srv llama_server: initializing ...`` before the real
    ``version: 0.5.0 (build 11146 ...)`` line.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        match = re.match(r"^version[:=]\s*(.+)$", line, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    for line in lines:
        if re.search(r"\d+\.\d+", line):
            return line
    return lines[0] if lines else None


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        if not IS_WINDOWS:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _data_path(data_dir: Path, relative: str) -> Path:
    parts = [part for part in re.split(r"[\\/]+", relative) if part]
    return data_dir.joinpath(*parts)


def _looks_like_llama_server(pid: int) -> bool:
    """True when a live process with this PID is our llama-server.

    ``psutil`` reports the same command line on Linux, macOS, and Windows, so
    this replaces the POSIX-only ``ps -p`` probe and avoids killing a PID that
    the OS reused for an unrelated process.
    """
    try:
        process = psutil.Process(pid)
        args = [str(part) for part in process.cmdline()]
    except (psutil.Error, OSError):
        return False
    if not args:
        return False
    name = Path(args[0]).name.lower()
    return "llama-server" in name or any("llama-server" in part.lower() for part in args[:3])


def _terminate_tree(pid: int, timeout: float = 10.0) -> None:
    """Terminate a process and its children on every supported platform."""
    try:
        root = psutil.Process(pid)
    except (psutil.Error, OSError):
        return
    try:
        processes = root.children(recursive=True)
    except psutil.Error:
        processes = []
    processes.append(root)
    for process in processes:
        try:
            process.terminate()
        except psutil.Error:
            pass
    _, alive = psutil.wait_procs(processes, timeout=timeout)
    for process in alive:
        try:
            process.kill()
        except psutil.Error:
            pass
    if alive:
        psutil.wait_procs(alive, timeout=5.0)


def _error_message(body: bytes, status: int) -> str:
    try:
        data = json.loads(body)
        if isinstance(data, dict):
            error = data.get("error")
            if isinstance(error, dict):
                return str(error.get("message") or error)
            if error:
                return str(error)
            if data.get("message"):
                return str(data["message"])
    except Exception:
        pass
    text = body.decode("utf-8", "replace").strip()
    return text[:500] if text else f"Engine returned HTTP {status}."
