from __future__ import annotations

import asyncio
import io
import json
import logging
import platform
import time
import zipfile
from pathlib import Path
from typing import Any

import psutil
from fastapi import APIRouter, File, Query, Request, UploadFile
from fastapi.responses import PlainTextResponse, Response, StreamingResponse

from .config import Settings
from .engine.selection import active_engine, engine_environment
from .errors import AppError, ConflictError, NotFoundError
from .schemas import (
    AppSettings,
    CreateJobRequest,
    DeleteResponse,
    Diagnostics,
    EngineStatus,
    Health,
    Job,
    JobList,
    JobOptions,
    ModelFile,
    ModelStatus,
    SettingsUpdate,
    SystemInfo,
    Upload,
    UploadBatchResponse,
    UploadError,
)
from .services.figures import (
    extract_figures,
    page_figure_json,
    page_markdown,
    remove_job_figures,
)
from .services.files import delete_upload_files, save_upload
from .services.jobs import public_job
from .utils import new_id, parse_page_selection, sanitize_filename, url_path

logger = logging.getLogger("ocr.api")
router = APIRouter(prefix="/api")


def _app(request: Request) -> Any:
    return request.app.state


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _public_upload(upload: dict[str, Any], config: Settings) -> dict[str, Any]:
    pages = []
    for page in upload.get("pages") or []:
        pages.append(
            {
                "id": page["id"],
                "page_number": page["page_number"],
                "thumb_url": f"/files/{url_path(page['thumb_path'])}",
                "image_url": (
                    f"/files/{url_path(page['image_path'])}" if page.get("image_path") else None
                ),
                "width": page.get("width"),
                "height": page.get("height"),
            }
        )
    return {
        "id": upload["id"],
        "original_name": upload["original_name"],
        "mime": upload["mime"],
        "size": upload["size"],
        "kind": upload["kind"],
        "page_count": upload["page_count"],
        "created_at": upload["created_at"],
        "pages": pages,
    }


def _system_info(request: Request) -> SystemInfo:
    config = _settings(request)
    app = _app(request)
    engine = active_engine(app)
    kind = app.active_engine_kind
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage(str(config.data_dir))
    return SystemInfo(
        platform=platform.system(),
        platform_label=config.platform_label,
        machine=platform.machine(),
        python=platform.python_version(),
        cpu_count=psutil.cpu_count(logical=True) or 0,
        total_ram=memory.total,
        available_ram=memory.available,
        disk_total=disk.total,
        disk_free=disk.free,
        llama_server=config.resolved_llama_server,
        llama_version=engine.version() if kind == "llama_cpp" else app.llama_engine.version(),
        torch_version=app.torch_engine.version(),
        accelerator=config.accelerator,
        engine_label=engine.status_model().backend,
    )


def _model_status(request: Request) -> ModelStatus:
    app = _app(request)
    kind = app.active_engine_kind
    if kind == "fake":
        return app.fake_engine.model_status()
    if kind == "transformers":
        weights = app.torch_engine.weights_status()
        return ModelStatus(
            ready=weights["ready"],
            model=ModelFile(
                name="Unlimited-OCR-2",
                path=weights["dir"],
                exists=weights["ready"],
                expected="models/uocr2",
            ),
            mmproj=None,
            message=weights["message"],
            download_command=weights["download_command"],
            engine="transformers",
            directory=weights["dir"],
            device=app.torch_engine.device_name,
            shards=weights["shards"],
        )
    model = app.llama_engine.model_status()
    return ModelStatus(**{**model.model_dump(), "engine": "llama_cpp"})


def _health(request: Request) -> Health:
    app = _app(request)
    engine = active_engine(app)
    model = _model_status(request)
    engine_status = engine.status_model()
    weights_ready = model.ready
    if not weights_ready:
        status = "error"
    elif engine_status.status == "ready":
        status = "ok"
    else:
        status = "degraded"
    return Health(
        status=status,
        version=app.settings.version,
        uptime_seconds=round(time.monotonic() - app.started_at, 1),
        engine=engine_status,
        model=model,
        system=_system_info(request),
        active_job=app.runner.current_job,
        queued_jobs=app.db.queued_count(),
    )


@router.get("/health", response_model=Health)
async def health(request: Request) -> Health:
    return _health(request)


@router.get("/system/status", response_model=Health)
async def system_status(request: Request) -> Health:
    return _health(request)


@router.get("/system/models", response_model=ModelStatus)
async def system_models(request: Request) -> ModelStatus:
    return _model_status(request)


@router.get("/system/diagnostics", response_model=Diagnostics)
async def diagnostics(request: Request) -> Diagnostics:
    app = _app(request)
    engine = active_engine(app)
    return Diagnostics(
        health=_health(request),
        data_dir=str(app.settings.data_dir),
        models_dir=str(app.settings.models_dir),
        db_path=str(app.settings.db_path),
        log_path=str(engine.log_path),
        engine_command=engine.command,
        engine_log_tail=engine.log_tail(120),
        settings=app.settings_store.get(),
        active_engine=app.active_engine_kind,  # type: ignore[arg-type]
        engines=engine_environment(app),
    )


@router.get("/system/engines", response_model=dict)
async def engines(request: Request) -> dict:
    """Facts about both engines (for the Settings model picker)."""
    app = _app(request)
    return engine_environment(app)


@router.post("/system/engine/start", response_model=EngineStatus)
async def engine_start(request: Request) -> EngineStatus:
    engine = active_engine(_app(request))
    await engine.start()
    return engine.status_model()


@router.post("/system/engine/stop", response_model=EngineStatus)
async def engine_stop(request: Request) -> EngineStatus:
    engine = active_engine(_app(request))
    await engine.stop()
    return engine.status_model()


@router.post("/system/engine/restart", response_model=EngineStatus)
async def engine_restart(request: Request) -> EngineStatus:
    engine = active_engine(_app(request))
    await engine.restart()
    return engine.status_model()


@router.get("/system/logs", response_class=PlainTextResponse)
async def system_logs(
    request: Request,
    target: str = Query(default="engine", pattern="^(engine|backend)$"),
    lines: int = Query(default=200, ge=10, le=2000),
) -> PlainTextResponse:
    config = _settings(request)
    path = (
        active_engine(_app(request)).log_path
        if target == "engine"
        else config.logs_dir / "backend.log"
    )
    if not path.exists():
        return PlainTextResponse(f"No {target} log exists yet.\n")
    return PlainTextResponse(_tail(path, lines))


@router.post("/system/clear-history", response_model=DeleteResponse)
async def clear_history(request: Request) -> DeleteResponse:
    app = _app(request)
    if app.runner.current_job:
        raise ConflictError(
            "A job is currently running.",
            hint="Cancel it before clearing history.",
        )
    uploads = app.db.list_uploads(limit=10000)
    jobs = app.db.list_jobs(limit=100000)[0]
    app.db.clear_history()
    for upload in uploads:
        delete_upload_files(app.settings, upload)
    for job in jobs:
        remove_job_figures(app.settings, job["id"])
    return DeleteResponse(deleted=True, message="History cleared.")


# --------------------------------------------------------------------------- uploads
@router.post("/uploads", response_model=UploadBatchResponse)
async def upload_files(
    request: Request, files: list[UploadFile] = File(...)
) -> UploadBatchResponse:
    if not files:
        raise AppError("Choose at least one file.", code="no_files")
    app = _app(request)
    if len(files) > app.settings.max_upload_files:
        raise AppError(
            f"You can upload at most {app.settings.max_upload_files} files at once.",
            code="too_many_files",
        )
    uploads: list[dict[str, Any]] = []
    errors: list[UploadError] = []
    for file in files:
        try:
            saved = await save_upload(file, app.settings, app.db)
            uploads.append(_public_upload(saved.upload, app.settings))
        except AppError as exc:
            errors.append(
                UploadError(
                    filename=sanitize_filename(file.filename or "file"),
                    message=exc.message,
                    code=exc.code,
                    hint=exc.hint,
                )
            )
        except Exception as exc:  # pragma: no cover - defensive
            errors.append(
                UploadError(
                    filename=sanitize_filename(file.filename or "file"),
                    message=f"Could not process this file: {exc}",
                    code="upload_failed",
                )
            )
        finally:
            try:
                await file.close()
            except Exception:
                pass
    return UploadBatchResponse(
        uploads=[Upload.model_validate(upload) for upload in uploads], errors=errors
    )


@router.get("/uploads/{upload_id}", response_model=Upload)
async def get_upload(request: Request, upload_id: str) -> Upload:
    app = _app(request)
    upload = app.db.get_upload(upload_id)
    if not upload:
        raise NotFoundError("That upload no longer exists.", code="upload_missing")
    return Upload.model_validate(_public_upload(upload, app.settings))


@router.delete("/uploads/{upload_id}", response_model=DeleteResponse)
async def delete_upload(request: Request, upload_id: str) -> DeleteResponse:
    app = _app(request)
    upload = app.db.get_upload(upload_id)
    if not upload:
        return DeleteResponse(deleted=True)
    if app.db.upload_is_used(upload_id):
        raise ConflictError(
            "This upload belongs to a job in your history.",
            hint="Delete the job first, or keep the upload for reruns.",
        )
    delete_upload_files(app.settings, upload)
    app.db.delete_upload(upload_id)
    return DeleteResponse(deleted=True)


# --------------------------------------------------------------------------- jobs
@router.post("/jobs", response_model=Job, status_code=201)
async def create_job(request: Request, body: CreateJobRequest) -> Job:
    app = _app(request)
    config: Settings = app.settings
    uploads: list[tuple[dict[str, Any], list[int]]] = []
    seen: set[str] = set()
    total = 0

    for upload_id in body.upload_ids:
        if upload_id in seen:
            continue
        seen.add(upload_id)
        upload = app.db.get_upload(upload_id)
        if not upload:
            raise NotFoundError(
                "One of the selected uploads no longer exists.",
                code="upload_missing",
                hint="Upload the file again.",
            )
        spec = body.options.page_selection.get(upload_id)
        pages = parse_page_selection(spec, upload["page_count"], max_pages=config.max_job_pages)
        total += len(pages)
        if total > config.max_job_pages:
            raise AppError(
                f"This job contains more than {config.max_job_pages} pages.",
                code="too_many_pages",
                hint="Split it into smaller jobs.",
            )
        uploads.append((upload, pages))

    if not uploads:
        raise AppError("Choose at least one file.", code="no_files")
    if body.options.batch_mode and total > 4:
        raise AppError(
            "One-request batch mode supports up to 4 pages per job.",
            code="batch_too_large",
            hint="Use per-page mode for longer documents.",
        )

    engine = active_engine(app)
    engine_kind = app.active_engine_kind
    job_id = new_id("job")
    options = body.options.model_dump()
    job = app.db.create_job(
        job_id=job_id,
        options=options,
        uploads=uploads,
        engine=_engine_label(engine, engine_kind),
        model=_engine_model(engine, engine_kind),
    )
    await app.runner.enqueue(job_id)
    await app.bus.publish(job_id, {"type": "snapshot", "job": public_job(job, config)})
    return Job.model_validate(public_job(job, config))


@router.get("/jobs", response_model=JobList)
async def list_jobs(
    request: Request,
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status: str = Query(default="all"),
    q: str | None = Query(default=None, max_length=200),
) -> JobList:
    app = _app(request)
    jobs, total = app.db.list_jobs(limit=limit, offset=offset, status=status, q=q)
    return JobList(
        items=[
            Job.model_validate(public_job(job, app.settings, include_output=False))
            for job in jobs
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/jobs/{job_id}", response_model=Job)
async def get_job(request: Request, job_id: str) -> Job:
    app = _app(request)
    job = app.db.get_job(job_id)
    if not job:
        raise NotFoundError("That job no longer exists.", code="job_missing")
    return Job.model_validate(public_job(job, app.settings))


@router.delete("/jobs/{job_id}", response_model=DeleteResponse)
async def delete_job(request: Request, job_id: str) -> DeleteResponse:
    app = _app(request)
    job = app.db.get_job(job_id)
    if not job:
        return DeleteResponse(deleted=True)
    if job["status"] in {"running", "preparing"}:
        raise ConflictError(
            "This job is still running.",
            hint="Cancel it first, then delete it.",
        )
    uploads = [app.db.get_upload(item["id"]) for item in job.get("uploads") or []]
    removed = app.db.delete_job(job_id)
    remove_job_figures(app.settings, job_id)
    for upload in uploads:
        if upload and upload["id"] in removed:
            delete_upload_files(app.settings, upload)
    return DeleteResponse(deleted=True)


@router.post("/jobs/{job_id}/cancel", response_model=Job)
async def cancel_job(request: Request, job_id: str) -> Job:
    app = _app(request)
    job = app.db.get_job(job_id)
    if not job:
        raise NotFoundError("That job no longer exists.", code="job_missing")
    if job["status"] in {"completed", "failed", "canceled", "partial"}:
        return Job.model_validate(public_job(job, app.settings))
    await app.runner.cancel(job_id)
    job = app.db.get_job(job_id)
    assert job is not None
    return Job.model_validate(public_job(job, app.settings))


@router.post("/jobs/{job_id}/rerun", response_model=Job, status_code=201)
async def rerun_job(request: Request, job_id: str) -> Job:
    app = _app(request)
    job = app.db.get_job(job_id)
    if not job:
        raise NotFoundError("That job no longer exists.", code="job_missing")
    grouped: dict[str, list[int]] = {}
    for page in job["pages"]:
        grouped.setdefault(page["upload_id"], []).append(int(page["page_number"]))
    selection = {
        upload_id: ",".join(str(number) for number in sorted(set(numbers)))
        for upload_id, numbers in grouped.items()
    }
    upload_ids = [item["id"] for item in job.get("uploads") or []]
    if not upload_ids:
        raise ConflictError("The source uploads for this job are gone.", code="upload_missing")
    options = JobOptions.model_validate({**job["options"], "page_selection": selection})
    body = CreateJobRequest(upload_ids=upload_ids, options=options)
    return await create_job(request, body)


@router.get("/jobs/{job_id}/events")
async def job_events(request: Request, job_id: str) -> StreamingResponse:
    app = _app(request)
    job = app.db.get_job(job_id)
    if not job:
        raise NotFoundError("That job no longer exists.", code="job_missing")

    async def event_stream():
        queue = await app.bus.subscribe(job_id)
        try:
            current = app.db.get_job(job_id)
            if not current:
                return
            payload = {"type": "snapshot", "job": public_job(current, app.settings)}
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            if current["status"] in {"completed", "failed", "canceled", "partial"}:
                yield f"data: {json.dumps({'type': 'job_done', 'job': payload['job']}, ensure_ascii=False)}\n\n"
                return
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                    if event.get("type") == "job_done":
                        break
                except TimeoutError:
                    yield ": ping\n\n"
        finally:
            await app.bus.unsubscribe(job_id, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/jobs/{job_id}/export")
async def export_job(
    request: Request,
    job_id: str,
    format: str = Query(default="md", pattern="^(md|txt|json|zip)$"),
    page: str = Query(default="all"),
) -> Response:
    app = _app(request)
    job = app.db.get_job(job_id)
    if not job:
        raise NotFoundError("That job no longer exists.", code="job_missing")
    pages = job["pages"]
    if page != "all":
        try:
            position = int(page)
        except ValueError as exc:
            raise AppError("Page must be a number or “all”.", code="invalid_page") from exc
        if position < 0 or position >= len(pages):
            raise AppError("That page does not exist in this job.", code="invalid_page")
        pages = [pages[position]]
    if not pages:
        raise AppError("This job has no pages.", code="empty_job")

    first_name = sanitize_filename(pages[0]["upload_name"], "ocr")
    stem = Path(first_name).stem[:60]
    # JSON is always a snapshot of the whole job, so include every figure it
    # contains even when a single page was requested for Markdown/text.
    figure_pages = job["pages"] if format == "json" else pages
    figures_by_position = {
        int(item["position"]): extract_figures(app.settings, job_id, item)
        for item in figure_pages
    }
    if format == "json":
        payload = public_job(job, app.settings)
        exported_positions = {int(item["position"]) for item in pages}
        for page_payload, source_page in zip(payload["pages"], job["pages"], strict=False):
            if int(source_page["position"]) not in exported_positions:
                continue
            page_payload["figures"] = page_figure_json(
                source_page, figures_by_position.get(int(source_page["position"]), [])
            )
        content = json.dumps(payload, ensure_ascii=False, indent=2)
        media = "application/json"
        extension = "json"
    elif format == "txt":
        parts = []
        for item in pages:
            text = item.get("output_clean") or ""
            figures = figures_by_position.get(int(item["position"]), [])
            if figures:
                captions = ", ".join(
                    str(figure.get("label") or "figure") for figure in figures
                )
                text = f"{text}\n\n[Figure: {captions} — use the Markdown export to see images]".strip()
            if text:
                parts.append(
                    f"{item['upload_name']} — page {item['page_number']}\n\n{text}"
                )
        content = ("\n\n" + ("-" * 60) + "\n\n").join(parts) + "\n"
        media = "text/plain; charset=utf-8"
        extension = "txt"
    else:
        figure_count = sum(len(items) for items in figures_by_position.values())
        figure_note = (
            f"Figures: {figure_count} embedded as inline PNG\n\n" if figure_count else ""
        )
        header = (
            f"# Unlimited OCR\n\n"
            f"Created {job['created_at']}\n\n"
            f"Model: {job.get('model') or 'Unlimited-OCR'} · {job.get('engine') or 'llama.cpp'}\n\n"
            f"{figure_note}"
        )
        if format == "zip":
            # A ZIP is for Markdown viewers that block data: URIs (GitHub,
            # some editors). It keeps the .md small and uses relative image
            # paths that work wherever the folder is unpacked.
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
                image_names: dict[int, str] = {}
                for position, figures in figures_by_position.items():
                    for figure in figures:
                        source = figure.get("path")
                        if not source:
                            continue
                        name = f"images/{Path(source).name}"
                        archive.write(source, name)
                        image_names[id(figure)] = name
                body = "\n\n---\n\n".join(
                    f"## {item['upload_name']} — page {item['page_number']}\n\n"
                    f"{page_markdown(item, figures_by_position.get(int(item['position']), []), lambda figure: image_names.get(id(figure)) or figure.get('data_url'))}"
                    for item in pages
                )
                archive.writestr(f"{stem}-ocr.md", header + body + "\n")
            content = buffer.getvalue()
            media = "application/zip"
            extension = "zip"
        else:
            body = "\n\n---\n\n".join(
                f"## {item['upload_name']} — page {item['page_number']}\n\n"
                f"{page_markdown(item, figures_by_position.get(int(item['position']), []))}"
                for item in pages
            )
            content = header + body + "\n"
            media = "text/markdown; charset=utf-8"
            extension = "md"

    filename = f"{stem}-ocr.{extension}"
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --------------------------------------------------------------------------- settings
@router.get("/settings", response_model=AppSettings)
async def get_settings(request: Request) -> AppSettings:
    return _app(request).settings_store.get()


@router.put("/settings", response_model=AppSettings)
async def update_settings(request: Request, body: SettingsUpdate) -> AppSettings:
    app = _app(request)
    previous_kind = getattr(app, "active_engine_kind", "llama_cpp")
    previous_device = app.settings_store.get().uocr2_device
    updated = app.settings_store.update(body)
    engine = active_engine(request.app)
    current_kind = app.active_engine_kind
    if current_kind != previous_kind:
        # Re-point the worker at the engine that will actually run the job and
        # release the engine that is being switched away from.
        app.runner.select_engine()
        logger.info("Active engine switched from %s to %s", previous_kind, current_kind)
        stale = {
            "llama_cpp": app.llama_engine,
            "transformers": app.torch_engine,
            "fake": app.fake_engine,
        }.get(previous_kind)
        # Never unload an engine that is mid-job; the worker holds a reference
        # to it and will finish before the next queued job switches over.
        if stale is not None and stale is not engine and not app.runner.current_job:
            asyncio.create_task(_stop_quietly(stale))
    elif (
        current_kind == "transformers"
        and updated.uocr2_device != previous_device
        and not app.runner.current_job
    ):
        # The loaded model lives on the old device; unload so the next start
        # honours the new preference.
        asyncio.create_task(_stop_quietly(engine))
        logger.info("Unloaded Unlimited-OCR-2 after device change to %s", updated.uocr2_device)
    return updated


@router.post("/settings/reset", response_model=AppSettings)
async def reset_settings(request: Request) -> AppSettings:
    app = _app(request)
    updated = app.settings_store.reset()
    active_engine(request.app)
    app.runner.select_engine()
    return updated


def _engine_label(engine: Any, kind: str) -> str:
    if kind == "transformers":
        return f"Transformers · {getattr(engine, 'device_name', None) or 'unloaded'}"
    if kind == "fake":
        return "Fake engine · offline test"
    return getattr(engine.config, "llama_label", "llama.cpp")


def _engine_model(engine: Any, kind: str) -> str:
    if kind == "transformers":
        return "Unlimited-OCR-2 · original BF16"
    if kind == "fake":
        return "fake-ocr-model"
    return str(getattr(engine, "model_id", None) or "Unlimited-OCR-Q8_0.gguf")


async def _stop_quietly(engine: Any) -> None:
    try:
        await engine.stop()
    except Exception as exc:
        logger.warning("Could not stop the previous engine: %s", exc)


def _tail(path: Path, lines: int) -> str:
    try:
        with path.open("rb") as handle:
            handle.seek(0, 2)
            size = handle.tell()
            handle.seek(max(0, size - 200_000))
            text = handle.read().decode("utf-8", "replace")
        return "\n".join(text.splitlines()[-lines:]) + "\n"
    except OSError as exc:
        return f"Could not read log: {exc}\n"
