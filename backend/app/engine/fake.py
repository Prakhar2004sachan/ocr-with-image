"""Deterministic in-process engine for offline tests and E2E runs.

The real studio loads a multi-gigabyte model and runs on GPU hardware. That is
the right default for users, but it makes automated tests slow and
machine-dependent. Setting ``OCR_FAKE_ENGINE=1`` swaps in this engine so the
API, the job worker, SSE streaming, exports, cancellation, and the entire
frontend can be exercised without a model. It is never selected unless the
environment flag is explicitly enabled.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from ..config import Settings
from ..schemas import EngineStatus, ModelFile, ModelStatus
from ..utils import iso_now

DeltaCallback = Callable[[str], Awaitable[None] | None]
CancelCheck = Callable[[], bool]


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


class FakeEngine:
    engine_type = "fake"
    label = "Fake engine · offline test"

    def __init__(self, config: Settings) -> None:
        self.config = config
        self.status = "stopped"
        self.device_name = "cpu"
        self.started_at: str | None = None
        self.last_error: str | None = None
        self.command: list[str] | None = ["fake-engine"]
        self.model_id = "fake-ocr"
        self.log_path = config.logs_dir / "fake-engine.log"
        self._calls = 0

    # ------------------------------------------------------------------ status
    def model_status(self) -> ModelStatus:
        return ModelStatus(
            ready=True,
            model=ModelFile(
                name="fake-ocr-model",
                path=str(self.config.models_dir),
                exists=True,
                expected="built-in",
            ),
            message="Deterministic test engine ready",
            engine="fake",
        )

    def status_model(self) -> EngineStatus:
        return EngineStatus(
            status=self.status,  # type: ignore[arg-type]
            port=None,
            pid=None,
            model="fake-ocr-model",
            backend=self.label,
            started_at=self.started_at,
            last_error=self.last_error,
            log_tail=self.log_tail(30),
            engine_type="fake",
            device="cpu",
            ready=True,
        )

    def weights_status(self) -> dict[str, Any]:
        return {
            "ready": True,
            "dir": str(self.config.models_dir),
            "files": [],
            "missing": [],
            "shards": [],
            "message": "Fake engine is always ready.",
            "download_command": None,
        }

    def available(self) -> bool:
        return True

    def version(self) -> str:
        return "fake 1.0"

    def log_tail(self, lines: int = 80) -> list[str]:
        return [f"fake-engine: deterministic test engine ({self._calls} calls)"]

    # --------------------------------------------------------------- lifecycle
    async def ensure_started(self) -> None:
        if self.status != "ready":
            await self.start()

    async def start(self) -> None:
        if self.status != "ready":
            self.status = "ready"
            self.started_at = self.started_at or iso_now()
            self.last_error = None

    async def stop(self) -> None:
        self.status = "stopped"
        self.started_at = None

    async def restart(self) -> None:
        await self.stop()
        await self.start()

    # --------------------------------------------------------------- inference
    async def ocr(
        self,
        *,
        image_paths: list[str],
        prompt: str,
        max_tokens: int,
        temperature: float = 0.0,
        on_delta: DeltaCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> GenerationResult:
        await self.ensure_started()
        self._calls += 1
        started = asyncio.get_running_loop().time()
        pages = [self._page_text(path, index + 1) for index, path in enumerate(image_paths)]
        text = "<PAGE>".join(pages)
        chunks = _chunks(text)
        emitted: list[str] = []
        canceled = False
        for chunk in chunks:
            if cancel_check and cancel_check():
                canceled = True
                break
            emitted.append(chunk)
            if on_delta:
                outcome = on_delta(chunk)
                if asyncio.iscoroutine(outcome):
                    await outcome
            await asyncio.sleep(max(0.0, self.config.fake_engine_delay))
        result = "".join(emitted)
        return GenerationResult(
            result,
            finish_reason="canceled" if canceled else "stop",
            prompt_tokens=max(1, len(prompt) // 4) + 850 * len(image_paths),
            completion_tokens=max(1, len(result) // 4),
            duration_ms=int((asyncio.get_running_loop().time() - started) * 1000),
            canceled=canceled,
        )

    def _page_text(self, image_path: str, index: int) -> str:
        stem = Path(re.split(r"[\\/]+", image_path)[-1]).stem
        return (
            f"title [80, 60, 920, 140]Fake OCR page {index}\n"
            f"text [80, 170, 920, 360]This is deterministic OCR output for {stem}.\n"
            f"table [80, 390, 920, 620]| Column | Value |\n| --- | --- |\n| Page | {index} |\n"
            f"image [120, 640, 880, 820]\n"
            f"image_caption [120, 830, 880, 870]Figure {index} from {stem}\n"
            f"page_number [470, 930, 530, 960]{index}\n"
        )


def _chunks(text: str, size: int = 48) -> list[str]:
    return [text[index : index + size] for index in range(0, len(text), size)] or [""]
