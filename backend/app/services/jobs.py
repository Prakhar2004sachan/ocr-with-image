from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from typing import Any

from ..config import Settings
from ..db import Database
from ..engine.llama_cpp import EngineUnavailableError, LlamaEngine
from ..schemas import JobOptions, OcrBlock
from ..utils import iso_now, url_path, utc_now
from .event_bus import EventBus
from .files import ensure_page_image
from .ocr_text import (
    parse_ocr_output,
    render_blocks,
    split_page_output,
    strip_repeated_margins,
)


class JobRunner:
    def __init__(
        self,
        config: Settings,
        db: Database,
        engine: LlamaEngine,
        bus: EventBus,
        torch_engine: Any | None = None,
        engine_selector: Callable[[], Any] | None = None,
    ) -> None:
        self.config = config
        self.db = db
        self.llama_engine = engine
        self.torch_engine = torch_engine
        self.bus = bus
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._current_job: str | None = None
        self._engine_selector = engine_selector
        self._engine: Any = engine

    @property
    def engine(self) -> Any:
        """The engine the worker will use for the next job."""
        return self._engine

    def select_engine(self) -> Any:
        if self._engine_selector is not None:
            try:
                self._engine = self._engine_selector() or self.llama_engine
            except Exception:
                self._engine = self.llama_engine
        return self._engine

    @property
    def current_job(self) -> str | None:
        return self._current_job

    async def start(self) -> None:
        self._task = asyncio.create_task(self._loop(), name="ocr-job-worker")
        for job_id in self.db.queued_job_ids():
            await self.enqueue(job_id)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def enqueue(self, job_id: str) -> None:
        self._cancel_events.setdefault(job_id, asyncio.Event())
        await self._queue.put(job_id)

    async def cancel(self, job_id: str) -> None:
        event = self._cancel_events.setdefault(job_id, asyncio.Event())
        event.set()
        self.db.request_cancel(job_id)
        job = self.db.get_job(job_id)
        if job:
            await self.bus.publish(job_id, {"type": "snapshot", "job": public_job(job, self.config)})

    async def _loop(self) -> None:
        while True:
            job_id = await self._queue.get()
            try:
                job = self.db.get_job(job_id)
                if not job or job["status"] != "queued":
                    continue
                self._current_job = job_id
                self.select_engine()
                engine_kind = getattr(self.engine, "engine_type", "llama_cpp")
                await self._run_job(job_id, engine_kind=engine_kind)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pragma: no cover - last-resort guard
                self.db.update_job(
                    job_id,
                    status="failed",
                    error=f"Unexpected worker error: {exc}",
                    finished_at=iso_now(),
                )
                job = self.db.get_job(job_id)
                if job:
                    await self.bus.publish(
                        job_id, {"type": "snapshot", "job": public_job(job, self.config)}
                    )
            finally:
                self._current_job = None
                self._queue.task_done()

    async def _run_job(self, job_id: str, *, engine_kind: str = "llama_cpp") -> None:
        job = self.db.get_job(job_id)
        if not job:
            return
        if job["status"] == "canceled" or self.db.cancel_requested(job_id):
            await self._finalize(job_id, "canceled")
            return

        options = JobOptions.model_validate(job["options"])
        pages = job["pages"]
        started = utc_now()
        engine_label = self._engine_label(engine_kind)
        self.db.update_job(
            job_id,
            status="preparing",
            started_at=iso_now(),
            engine=engine_label,
            model=self._engine_model(engine_kind),
        )
        job = self.db.get_job(job_id)
        if job:
            await self.bus.publish(job_id, {"type": "snapshot", "job": public_job(job, self.config)})

        try:
            await self.engine.ensure_started()
        except Exception as exc:
            message = getattr(exc, "message", str(exc))
            hint = getattr(exc, "hint", None)
            error = f"{message}" + (f" {hint}" if hint else "")
            # Settle every page so the UI never shows a failed job with pages
            # stuck on "pending": the first page carries the reason, the rest
            # are skipped.
            if pages:
                self.db.update_job_page(
                    job_id, pages[0]["position"], status="failed", error=error
                )
                self.db.skip_pending_pages(
                    job_id, error="Skipped after the inference engine failed."
                )
                self.db.update_job(job_id, failed_pages=1)
            self.db.update_job(job_id, status="failed", error=error, finished_at=iso_now())
            job = self.db.get_job(job_id)
            if job:
                await self.bus.publish(
                    job_id, {"type": "snapshot", "job": public_job(job, self.config)}
                )
            return

        self.db.update_job(job_id, status="running")
        job = self.db.get_job(job_id)
        if job:
            await self.bus.publish(job_id, {"type": "snapshot", "job": public_job(job, self.config)})

        canceled = False
        engine_failed = False
        if options.batch_mode and 1 < len(pages) <= 4:
            await self._run_batch(job_id, options, pages, started=started)
            return

        for page in pages:
            cancel_event = self._cancel_events.setdefault(job_id, asyncio.Event())
            if cancel_event.is_set() or self.db.cancel_requested(job_id):
                canceled = True
                if self.db.skip_pending_pages(job_id, error="Canceled"):
                    await self._publish_all_pages(job_id)
                break
            if engine_failed:
                skipped = self.db.skip_pending_pages(
                    job_id, error="Skipped after the inference engine failed."
                )
                if skipped:
                    await self._publish_all_pages(job_id)
                break

            await self.bus.publish(
                job_id,
                {
                    "type": "page_start",
                    "position": page["position"],
                    "page_number": page["page_number"],
                    "upload_name": page["upload_name"],
                },
            )
            self.db.update_job_page(job_id, page["position"], status="running")
            await self._publish_page(job_id, page["position"])

            try:
                image_rel, width, height = await asyncio.to_thread(
                    ensure_page_image,
                    self.db,
                    self.config,
                    page["upload_id"],
                    page["page_number"],
                    options.dpi,
                )
                self.db.set_job_page_image(
                    job_id, page["position"], image_path=image_rel, width=width, height=height
                )
                cancelled = lambda: (
                    self._cancel_events[job_id].is_set()
                    or self.db.cancel_requested(job_id)
                )
                stream = _PageStream(self.bus, job_id, page["position"])
                retried = False
                result = await self.engine.ocr(
                    image_paths=[image_rel],
                    prompt=options.prompt,
                    max_tokens=options.max_tokens,
                    temperature=options.temperature,
                    on_delta=stream.push,
                    cancel_check=cancelled,
                )
                await stream.flush()
                if (
                    result.finish_reason == "length"
                    and options.auto_retry_truncated
                    and not result.canceled
                    and (options.max_tokens * 2) <= self.config.max_max_tokens
                ):
                    retried = True
                    retry = await self.engine.ocr(
                        image_paths=[image_rel],
                        prompt=options.prompt,
                        max_tokens=min(
                            options.max_tokens * 2, self.config.max_max_tokens
                        ),
                        temperature=options.temperature,
                        on_delta=stream.push,
                        cancel_check=cancelled,
                    )
                    await stream.flush()
                    if not retry.canceled and len(retry.text.strip()) >= len(result.text.strip()):
                        result = retry
                if result.canceled or self._cancel_events[job_id].is_set():
                    canceled = True
                    parsed = parse_ocr_output(result.text, prompt_mode=options.prompt_mode)
                    self.db.update_job_page(
                        job_id,
                        page["position"],
                        status="skipped",
                        output_raw=result.text,
                        output_clean=parsed.clean,
                        blocks=[b.model_dump() for b in parsed.blocks],
                        warning="Canceled while this page was being generated.",
                        duration_ms=result.duration_ms,
                        prompt_tokens=result.prompt_tokens,
                        completion_tokens=result.completion_tokens,
                        finish_reason=result.finish_reason,
                        error="Canceled",
                    )
                    await self._publish_page(job_id, page["position"])
                    continue

                parsed = parse_ocr_output(result.text, prompt_mode=options.prompt_mode)
                warning = parsed.warning
                if result.finish_reason == "length":
                    warning = _join_warning(
                        warning,
                        "Output reached the token limit. Increase Max tokens and rerun "
                        "for dense pages.",
                    )
                if retried:
                    warning = _join_warning(
                        warning,
                        "This page was automatically retried with double the token budget.",
                    )
                if not parsed.clean:
                    raise ValueError(
                        "The model returned no readable text for this page. "
                        "Try a higher DPI or the custom prompt."
                    )
                self.db.update_job_page(
                    job_id,
                    page["position"],
                    status="completed",
                    image_path=image_rel,
                    width=width,
                    height=height,
                    output_raw=result.text,
                    output_clean=parsed.clean,
                    blocks=[b.model_dump() for b in parsed.blocks],
                    warning=warning,
                    prompt_tokens=result.prompt_tokens,
                    completion_tokens=result.completion_tokens,
                    duration_ms=result.duration_ms,
                    finish_reason=result.finish_reason,
                    error=None,
                )
                await self._bump(job_id, completed=1)
                await self._publish_page(job_id, page["position"])
            except EngineUnavailableError as exc:
                engine_failed = True
                self.db.update_job_page(
                    job_id,
                    page["position"],
                    status="failed",
                    error=exc.message,
                )
                await self._bump(job_id, failed=1)
                await self._publish_page(job_id, page["position"])
                self.db.update_job(job_id, error=exc.message)
            except Exception as exc:
                self.db.update_job_page(
                    job_id,
                    page["position"],
                    status="failed",
                    error=str(exc) or exc.__class__.__name__,
                )
                await self._bump(job_id, failed=1)
                await self._publish_page(job_id, page["position"])

        if canceled or self.db.cancel_requested(job_id):
            skipped = self.db.skip_pending_pages(job_id, error="Canceled")
            if skipped:
                await self._publish_all_pages(job_id)

        if options.strip_repeated_margins:
            await self._strip_margins(job_id)

        final = self.db.get_job(job_id)
        if not final:
            return
        if canceled or self.db.cancel_requested(job_id):
            status = "canceled"
        elif engine_failed or final["failed_pages"] >= final["total_pages"]:
            status = "failed"
        elif final["failed_pages"] > 0:
            status = "partial"
        else:
            status = "completed"
        await self._finalize(job_id, status, started=started)

    def _engine_model(self, engine_kind: str) -> str:
        """The weights actually in use, so history never mislabels a job."""
        if engine_kind == "transformers":
            return "Unlimited-OCR-2 · original BF16"
        if engine_kind == "fake":
            return "fake-ocr-model"
        model = getattr(self.engine, "model_id", None)
        return str(model or "Unlimited-OCR-Q8_0.gguf")

    def _engine_label(self, engine_kind: str) -> str:
        if engine_kind == "transformers":
            device = getattr(self.engine, "device_name", None) or "starting"
            return f"Transformers · {device}"
        if engine_kind == "fake":
            return "Fake engine · offline test"
        config = getattr(self.engine, "config", None)
        return str(getattr(config, "llama_label", "llama.cpp"))

    async def _run_batch(
        self,
        job_id: str,
        options: JobOptions,
        pages: list[dict[str, Any]],
        *,
        started: Any | None = None,
    ) -> None:
        cancel_event = self._cancel_events.setdefault(job_id, asyncio.Event())
        prepared: list[dict[str, Any]] = []
        if cancel_event.is_set() or self.db.cancel_requested(job_id):
            self.db.skip_pending_pages(job_id, error="Canceled")
            await self._publish_all_pages(job_id)
            await self._finalize(job_id, "canceled", started=started)
            return
        try:
            for page in pages:
                image_rel, width, height = await asyncio.to_thread(
                    ensure_page_image,
                    self.db,
                    self.config,
                    page["upload_id"],
                    page["page_number"],
                    options.dpi,
                )
                self.db.set_job_page_image(
                    job_id, page["position"], image_path=image_rel, width=width, height=height
                )
                prepared.append({**page, "image_path": image_rel, "width": width, "height": height})
            for page in pages:
                self.db.update_job_page(job_id, page["position"], status="running")
                await self.bus.publish(
                    job_id,
                    {
                        "type": "page_start",
                        "position": page["position"],
                        "page_number": page["page_number"],
                        "upload_name": page["upload_name"],
                    },
                )
                await self._publish_page(job_id, page["position"])

            stream = _BatchStream(self.bus, job_id)
            image_paths = [entry["image_path"] for entry in prepared]
            batch_cancelled = lambda: (
                cancel_event.is_set() or self.db.cancel_requested(job_id)
            )
            result = await self.engine.ocr(
                image_paths=image_paths,
                prompt="Multi page parsing." if options.prompt_mode != "custom" else options.prompt,
                max_tokens=min(options.max_tokens * len(pages), self.config.max_max_tokens),
                temperature=options.temperature,
                on_delta=stream.push,
                cancel_check=batch_cancelled,
            )
            await stream.flush()
            batch_retried = False
            if (
                result.finish_reason == "length"
                and options.auto_retry_truncated
                and not result.canceled
                and (options.max_tokens * len(pages) * 2) <= self.config.max_max_tokens
            ):
                batch_retried = True
                retry = await self.engine.ocr(
                    image_paths=image_paths,
                    prompt=(
                        "Multi page parsing."
                        if options.prompt_mode != "custom"
                        else options.prompt
                    ),
                    max_tokens=min(
                        options.max_tokens * len(pages) * 2, self.config.max_max_tokens
                    ),
                    temperature=options.temperature,
                    on_delta=stream.push,
                    cancel_check=batch_cancelled,
                )
                await stream.flush()
                if not retry.canceled and len(retry.text.strip()) >= len(result.text.strip()):
                    result = retry
            if result.canceled or cancel_event.is_set():
                for page in pages:
                    self.db.update_job_page(
                        job_id,
                        page["position"],
                        status="skipped",
                        output_clean="",
                        error="Canceled",
                    )
                    await self._publish_page(job_id, page["position"])
                await self._finalize(job_id, "canceled", started=started)
                return

            parts = split_page_output(result.text)
            warning = None
            if result.finish_reason == "length":
                warning = _join_warning(
                    "Output reached the token limit. Increase Max tokens and rerun for dense pages."
                )
            if batch_retried:
                warning = _join_warning(
                    warning,
                    "This batch was automatically retried with double the token budget.",
                )
            if len(parts) != len(pages):
                warning = _join_warning(
                    warning,
                    "The batch response did not contain one page marker per page; "
                    "text was assigned in order. Use per-page mode for exact pagination.",
                )
            for index, page in enumerate(pages):
                raw = parts[index] if index < len(parts) else ""
                parsed = parse_ocr_output(raw, prompt_mode=options.prompt_mode)
                page_warning = _join_warning(parsed.warning, warning)
                if not parsed.clean:
                    self.db.update_job_page(
                        job_id,
                        page["position"],
                        status="failed",
                        output_raw=raw,
                        output_clean="",
                        error="No text was returned for this page.",
                        warning=page_warning,
                        prompt_tokens=result.prompt_tokens,
                        completion_tokens=result.completion_tokens,
                        duration_ms=result.duration_ms,
                        finish_reason=result.finish_reason,
                    )
                    await self._bump(job_id, failed=1)
                else:
                    self.db.update_job_page(
                        job_id,
                        page["position"],
                        status="completed",
                        output_raw=raw,
                        output_clean=parsed.clean,
                        blocks=[b.model_dump() for b in parsed.blocks],
                        warning=page_warning,
                        prompt_tokens=result.prompt_tokens,
                        completion_tokens=result.completion_tokens,
                        duration_ms=result.duration_ms,
                        finish_reason=result.finish_reason,
                    )
                    await self._bump(job_id, completed=1)
                await self._publish_page(job_id, page["position"])
        except Exception as exc:
            message = getattr(exc, "message", str(exc))
            for page in pages:
                current = self.db.get_job(job_id)
                if not current:
                    break
                row = next(
                    (p for p in current["pages"] if p["position"] == page["position"]), None
                )
                if row and row["status"] in {"pending", "running"}:
                    self.db.update_job_page(
                        job_id, page["position"], status="failed", error=message
                    )
                    await self._bump(job_id, failed=1)
                    await self._publish_page(job_id, page["position"])
            self.db.update_job(job_id, error=message)

        final = self.db.get_job(job_id)
        if not final:
            return
        if self.db.cancel_requested(job_id):
            self.db.skip_pending_pages(job_id, error="Canceled")
            status = "canceled"
        elif final["failed_pages"] >= final["total_pages"]:
            status = "failed"
        elif final["failed_pages"] > 0:
            status = "partial"
        else:
            status = "completed"
        if options.strip_repeated_margins and status != "canceled":
            await self._strip_margins(job_id)
        await self._finalize(job_id, status, started=started)

    async def _bump(self, job_id: str, *, completed: int = 0, failed: int = 0) -> None:
        job = self.db.get_job(job_id)
        if not job:
            return
        counters = self.db.increment_job_pages(job_id, completed=completed, failed=failed)
        await self.bus.publish(
            job_id,
            {
                "type": "job_update",
                "job": {
                    "completed_pages": counters["completed_pages"],
                    "failed_pages": counters["failed_pages"],
                },
            },
        )

    async def _publish_page(self, job_id: str, position: int) -> None:
        job = self.db.get_job(job_id)
        if not job:
            return
        page = next((p for p in job["pages"] if p["position"] == position), None)
        if page:
            await self.bus.publish(
                job_id, {"type": "page_update", "page": public_page(page, self.config)}
            )

    async def _publish_all_pages(self, job_id: str) -> None:
        job = self.db.get_job(job_id)
        if not job:
            return
        for page in job["pages"]:
            await self._publish_page(job_id, page["position"])

    async def _strip_margins(self, job_id: str) -> None:
        job = self.db.get_job(job_id)
        if not job:
            return
        per_page: list[list[OcrBlock]] = []
        for page in job["pages"]:
            blocks = [OcrBlock.model_validate(block) for block in page.get("blocks") or []]
            per_page.append(blocks)
        stripped = strip_repeated_margins(per_page)
        for page, blocks in zip(job["pages"], stripped, strict=False):
            self.db.update_job_page(
                job_id,
                page["position"],
                blocks=[b.model_dump() for b in blocks],
                output_clean=render_blocks(blocks),
            )

    async def _finalize(self, job_id: str, status: str, started: Any | None = None) -> None:
        job = self.db.get_job(job_id)
        if not job:
            return
        if started is None:
            duration_ms = job.get("duration_ms")
        else:
            duration_ms = int((utc_now() - started).total_seconds() * 1000)
        combined = _combine(job["pages"])
        warnings = [p["warning"] for p in job["pages"] if p.get("warning")]
        warning = _join_warning(*warnings)
        self.db.update_job(
            job_id,
            status=status,
            finished_at=iso_now(),
            duration_ms=duration_ms,
            output_markdown=combined,
            warning=warning,
        )
        job = self.db.get_job(job_id)
        if job:
            await self.bus.publish(
                job_id, {"type": "job_done", "job": public_job(job, self.config)}
            )


class _PageStream:
    def __init__(self, bus: EventBus, job_id: str, position: int) -> None:
        self.bus = bus
        self.job_id = job_id
        self.position = position
        self._buffer: list[str] = []
        self._last_flush = time.monotonic()

    async def push(self, delta: str) -> None:
        self._buffer.append(delta)
        now = time.monotonic()
        if now - self._last_flush >= 0.12:
            await self.flush()

    async def flush(self) -> None:
        if not self._buffer:
            self._last_flush = time.monotonic()
            return
        text = "".join(self._buffer)
        self._buffer.clear()
        self._last_flush = time.monotonic()
        await self.bus.publish(
            self.job_id,
            {"type": "page_delta", "position": self.position, "text": text},
        )


class _BatchStream:
    def __init__(self, bus: EventBus, job_id: str) -> None:
        self.bus = bus
        self.job_id = job_id
        self._buffer: list[str] = []
        self._last_flush = time.monotonic()

    async def push(self, delta: str) -> None:
        self._buffer.append(delta)
        now = time.monotonic()
        if now - self._last_flush >= 0.12:
            await self.flush()

    async def flush(self) -> None:
        if not self._buffer:
            return
        text = "".join(self._buffer)
        self._buffer.clear()
        self._last_flush = time.monotonic()
        await self.bus.publish(self.job_id, {"type": "job_delta", "text": text})


def _combine(pages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for page in pages:
        if page.get("output_clean"):
            parts.append(
                f"## {page['upload_name']} — page {page['page_number']}\n\n"
                f"{page['output_clean']}"
            )
    return "\n\n---\n\n".join(parts)


def _join_warning(*items: str | None) -> str | None:
    values = [item for item in items if item]
    return " ".join(values) if values else None


def public_page(
    page: dict[str, Any], config: Settings, *, include_output: bool = True
) -> dict[str, Any]:
    image_url = (
        f"/files/{url_path(page['image_path'])}" if page.get("image_path") else None
    )
    thumb_url = f"/files/{url_path(page['thumb_path'])}"
    return {
        "position": page["position"],
        "upload_id": page["upload_id"],
        "upload_name": page["upload_name"],
        "page_number": page["page_number"],
        "status": page["status"],
        "image_url": image_url,
        "thumb_url": thumb_url,
        "width": page.get("width"),
        "height": page.get("height"),
        "output_clean": page.get("output_clean") if include_output else None,
        "output_raw": page.get("output_raw") if include_output else None,
        "blocks": (page.get("blocks") or []) if include_output else [],
        "error": page.get("error"),
        "warning": page.get("warning"),
        "prompt_tokens": page.get("prompt_tokens") if include_output else None,
        "completion_tokens": page.get("completion_tokens") if include_output else None,
        "duration_ms": page.get("duration_ms") if include_output else None,
        "finish_reason": page.get("finish_reason") if include_output else None,
    }


def public_job(
    job: dict[str, Any], config: Settings, *, include_output: bool = True
) -> dict[str, Any]:
    return {
        "id": job["id"],
        "status": job["status"],
        "options": job["options"],
        "total_pages": job["total_pages"],
        "completed_pages": job["completed_pages"],
        "failed_pages": job["failed_pages"],
        "created_at": job["created_at"],
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
        "duration_ms": job.get("duration_ms"),
        "error": job.get("error"),
        "warning": job.get("warning"),
        "engine": job.get("engine"),
        "model": job.get("model"),
        "uploads": job.get("uploads") or [],
        "pages": [
            public_page(page, config, include_output=include_output)
            for page in job.get("pages") or []
        ],
        "queue_position": job.get("queue_position"),
    }
