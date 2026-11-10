from __future__ import annotations

import asyncio
import logging
import sys
import time
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .api import router
from .config import PROJECT_ROOT, Settings, settings
from .db import Database
from .engine import selection as engine_selection
from .engine.fake import FakeEngine
from .engine.llama_cpp import LlamaEngine
from .engine.transformers_engine import TransformersEngine
from .errors import AppError
from .services.event_bus import EventBus
from .services.jobs import JobRunner
from .services.settings_store import SettingsStore

logger = logging.getLogger("ocr")
_LOGGING_CONFIGURED = False


def active_engine(app: FastAPI) -> Any:
    """The engine the API should report and the worker should use."""
    return engine_selection.active_engine(app)


def _configure_logging(config: Settings) -> None:
    """Attach the console/file handlers once per process."""
    global _LOGGING_CONFIGURED
    config.ensure_dirs()
    level = getattr(logging, config.log_level.upper(), logging.INFO)
    root = logging.getLogger()
    if not _LOGGING_CONFIGURED and not any(
        getattr(handler, "_ocr_handler", False) for handler in root.handlers
    ):
        formatter = logging.Formatter(
            "%(asctime)s %(levelname)-7s %(name)s: %(message)s", "%Y-%m-%d %H:%M:%S"
        )
        stream = logging.StreamHandler(sys.stdout)
        stream.setFormatter(formatter)
        stream._ocr_handler = True  # type: ignore[attr-defined]
        file_handler = RotatingFileHandler(
            config.logs_dir / "backend.log",
            maxBytes=5 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        file_handler._ocr_handler = True  # type: ignore[attr-defined]
        root.addHandler(stream)
        root.addHandler(file_handler)
        root.setLevel(level)
        _LOGGING_CONFIGURED = True
    # Engine health checks are internal chatter, not diagnostics.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def create_app(
    config: Settings | None = None,
    *,
    serve_frontend: bool = True,
) -> FastAPI:
    """Build an isolated studio app.

    Tests pass their own ``Settings`` (temporary data directory, fake engine)
    so they never touch the real database, uploads, or model.
    """
    config = config or settings
    _configure_logging(config)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        config.ensure_dirs()
        db = Database(config.db_path)
        interrupted = db.recover_interrupted_jobs()
        if interrupted:
            logger.warning("Marked %s interrupted job(s) as failed.", interrupted)

        store = SettingsStore(config.settings_path, config)
        llama_engine = LlamaEngine(config)
        torch_engine = TransformersEngine(config)
        fake_engine = FakeEngine(config) if config.fake_engine else None
        bus = EventBus()
        runner = JobRunner(
            config,
            db,
            llama_engine,
            bus,
            torch_engine=torch_engine,
            engine_selector=lambda: active_engine(app),
        )

        app.state.settings = config
        app.state.db = db
        app.state.settings_store = store
        app.state.engine = llama_engine
        app.state.torch_engine = torch_engine
        app.state.llama_engine = llama_engine
        app.state.fake_engine = fake_engine
        app.state.bus = bus
        app.state.runner = runner
        app.state.started_at = time.monotonic()
        app.state.active_engine_kind = "llama_cpp"

        await runner.start()
        monitor_task = asyncio.create_task(llama_engine.monitor(), name="engine-monitor")

        async def autostart() -> None:
            engine = active_engine(app)
            try:
                await engine.start()
                if engine is torch_engine:
                    logger.info("Unlimited-OCR-2 ready on %s.", engine.device_name)
                elif getattr(engine, "engine_type", "") == "fake":
                    logger.info("Deterministic test engine ready.")
                else:
                    logger.info("Inference engine ready on port %s.", engine.port)
            except Exception as exc:
                logger.warning("Engine autostart failed: %s", getattr(exc, "message", exc))

        autostart_task: asyncio.Task | None = None
        if store.get().auto_start_engine:
            autostart_task = asyncio.create_task(autostart(), name="engine-autostart")

        logger.info(
            "Unlimited OCR backend ready (platform: %s, data: %s, engine: %s)",
            config.platform_label,
            config.data_dir,
            active_engine(app).engine_type,
        )
        try:
            yield
        finally:
            if autostart_task and not autostart_task.done():
                autostart_task.cancel()
                try:
                    await autostart_task
                except asyncio.CancelledError:
                    pass
            await runner.stop()
            monitor_task.cancel()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass
            # Stop every engine instance. If the user switched engines during
            # the session the previous one is not the active engine anymore,
            # and the llama-server child process must not outlive the backend.
            for engine in (llama_engine, torch_engine, fake_engine):
                if engine is None:
                    continue
                try:
                    await engine.stop()
                except Exception:
                    logger.exception("Could not stop an engine during shutdown.")
            db.close()
            logger.info("Unlimited OCR backend stopped.")

    app = FastAPI(
        title="Unlimited OCR Studio",
        version=__version__,
        description=(
            "Private, cross-platform OCR backend powered by Baidu Unlimited-OCR "
            "through llama.cpp or transformers."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origin_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        if request.url.path.startswith("/files/"):
            response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
        elif request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.exception_handler(AppError)
    async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.message, "code": exc.code, "hint": exc.hint},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = exc.errors()
        if errors:
            first = errors[0]
            location = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
            message = first.get("msg", "Invalid request.")
            detail = f"{location}: {message}" if location else message
        else:
            detail = "Invalid request."
        return JSONResponse(
            status_code=422,
            content={"detail": detail, "code": "validation_error", "hint": None},
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error for %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={
                "detail": "The backend hit an unexpected error.",
                "code": "internal_error",
                "hint": "Check data/logs/backend.log, or restart the backend.",
            },
        )

    app.include_router(router)

    # Uploaded page images and thumbnails only. Database, logs and settings
    # stay private.
    config.uploads_dir.mkdir(parents=True, exist_ok=True)
    app.mount(
        "/files/uploads",
        StaticFiles(directory=config.uploads_dir, html=False),
        name="uploads",
    )

    frontend_dist = PROJECT_ROOT / "frontend" / "dist"
    if serve_frontend and frontend_dist.exists():
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
    else:

        @app.get("/")
        async def root() -> dict[str, str]:
            return {
                "name": "Unlimited OCR Studio",
                "version": __version__,
                "platform": config.platform_label,
                "docs": "/docs",
                "frontend": "http://localhost:5173 (run `pnpm --dir frontend dev`)",
            }

    return app


app = create_app()


def main() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    main()
