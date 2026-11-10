"""Engine selection helpers shared by the API and the job worker.

Two interchangeable engines are available:

``llama_cpp``
    Baidu/Unlimited-OCR-1 served by a local ``llama-server`` process. Weights
    are a community GGUF quantization (Q8_0) plus a separately exported
    vision projector (``mmproj``), because llama.cpp cannot read the original
    combined Safetensors checkpoint.

``transformers``
    The *original* ``baidu/Unlimited-OCR-2`` safetensors weights, run through
    ``transformers`` on Metal. No separate projector exists: this release is
    an ``image-text-to-text`` model that packs encoder, decoder and the
    sparse-attention stack into one checkpoint.

The setting chooses explicitly, or ``auto`` prefers Unlimited-OCR-2 whenever
its weights and torch are available locally.

A third, deterministic in-process engine (``fake``) is available only when
``OCR_FAKE_ENGINE=1``; it exists for offline tests and the Playwright suite.
"""

from __future__ import annotations

from typing import Any

from .llama_cpp import LlamaEngine


def resolve_engine_kind(
    preferred: str,
    llama: LlamaEngine,
    torch_engine: Any,
    fake_engine: Any | None = None,
) -> str:
    # The deterministic engine is a test-only override and always wins.
    if fake_engine is not None:
        return "fake"
    if preferred == "transformers":
        return "transformers"
    if preferred == "llama_cpp":
        return "llama_cpp"
    try:
        available = getattr(torch_engine, "available", None)
        if callable(available):
            if available():
                return "transformers"
        elif torch_engine.weights_status().get("ready"):
            return "transformers"
    except Exception:
        pass
    return "llama_cpp"


def active_engine(app: Any) -> Any:
    """Resolve and remember which engine the app is currently using.

    Accepts a FastAPI app or its ``.state`` namespace, because the API layer
    passes ``request.app.state`` while the lifespan passes the app itself.
    """
    state = _state(app)
    store = state.settings_store
    preferred = getattr(store.get(), "active_engine", "auto")
    fake_engine = getattr(state, "fake_engine", None)
    kind = resolve_engine_kind(preferred, state.llama_engine, state.torch_engine, fake_engine)
    state.active_engine_kind = kind
    if kind == "fake":
        return fake_engine
    return state.torch_engine if kind == "transformers" else state.llama_engine


def _state(app: Any) -> Any:
    """Accept either a FastAPI app or its ``.state`` namespace."""
    return getattr(app, "state", app)


def engine_environment(app: Any) -> dict[str, Any]:
    """Bundle of engine facts for the diagnostics endpoint."""
    state = _state(app)
    torch_engine = state.torch_engine
    llama = state.llama_engine
    kind = getattr(state, "active_engine_kind", "llama_cpp")
    try:
        torch_env = torch_engine.environment()
    except Exception as exc:
        torch_env = {"error": str(exc)}
    fake = getattr(state, "fake_engine", None)
    return {
        "active": kind,
        "platform": {
            "label": state.settings.platform_label,
            "accelerator": getattr(state.settings, "accelerator", "CPU"),
            "fake_engine": fake is not None,
        },
        "llama_cpp": {
            "ready": bool(llama.model_status().ready),
            "binary": llama.config.resolved_llama_server,
            "version": llama.version(),
            "status": llama.status,
            "label": getattr(llama.config, "llama_label", "llama.cpp"),
        },
        "transformers": torch_env,
        "fake": fake.model_status().model_dump() if fake is not None else None,
    }
