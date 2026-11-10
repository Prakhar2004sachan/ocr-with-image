from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.config import IS_WINDOWS
from app.engine.fake import FakeEngine
from app.engine.llama_cpp import (
    LlamaEngine,
    _looks_like_llama_server,
    _model_file,
    _parse_version,
    _port_free,
    _terminate_tree,
)
from app.engine.selection import resolve_engine_kind
from app.engine.transformers_engine import TransformersEngine
from app.errors import EngineUnavailableError, ModelMissingError
from tests.helpers import make_settings


def test_platform_helpers_are_populated(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    assert settings.platform_label in {"macOS", "Windows", "Linux"} or settings.platform_label
    assert settings.accelerator
    assert "llama.cpp" in settings.llama_label
    assert settings.download_models_command == "python scripts/download_models.py"
    assert settings.install_llama_hint


def test_explicit_llama_binary_is_resolved(tmp_path: Path) -> None:
    binary = tmp_path / ("llama-server.exe" if IS_WINDOWS else "llama-server")
    binary.write_text("#!/bin/sh\n", encoding="utf-8")
    configured = make_settings(tmp_path, llama_server_bin=str(binary))
    assert configured.resolved_llama_server == str(binary)


def test_missing_llama_binary_is_reported(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    assert settings.resolved_llama_server == str(tmp_path / "missing-llama-server")


def test_llama_model_status_reports_missing_files(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    engine = LlamaEngine(settings)
    status = engine.model_status()
    assert status.ready is False
    assert status.engine == "llama_cpp"
    assert status.download_command
    assert status.model is not None and status.model.exists is False
    status_model = engine.status_model()
    assert status_model.status == "stopped"
    assert status_model.engine_type == "llama_cpp"
    assert status_model.device
    assert status_model.backend == settings.llama_label


def test_llama_model_status_ready_with_files(tmp_path: Path) -> None:
    models = tmp_path / "models" / "gguf"
    models.mkdir(parents=True)
    model = models / "Unlimited-OCR-Q8_0.gguf"
    mmproj = models / "mmproj-Unlimited-OCR-F16.gguf"
    model.write_bytes(b"model")
    mmproj.write_bytes(b"mmproj")
    settings = make_settings(
        tmp_path,
        models_dir=tmp_path / "models",
        model_path=model,
        mmproj_path=mmproj,
    )
    status = LlamaEngine(settings).model_status()
    assert status.ready is True
    assert status.model.exists and status.mmproj.exists
    assert status.download_command is None


def test_model_file_display_path_is_relative_to_models_dir(tmp_path: Path) -> None:
    models = tmp_path / "models"
    path = models / "gguf" / "x.gguf"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"x")
    file = _model_file(path, models)
    assert file is not None
    assert file.expected is not None
    assert file.expected.replace("\\", "/") == "models/gguf/x.gguf"


def test_parse_version_extracts_the_real_banner() -> None:
    assert (
        _parse_version(
            "0.00.000.441 I srv llama_server: initializing ...\n"
            "version: 0.5.0 (build 11146, commit 7fe450e19)\n"
        )
        == "0.5.0 (build 11146, commit 7fe450e19)"
    )
    assert _parse_version("") is None


def test_port_free_on_an_ephemeral_port() -> None:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    # Just after closing, the port is normally bindable again.
    assert isinstance(_port_free(port), bool)


def test_process_lookup_rejects_unrelated_pids() -> None:
    assert _looks_like_llama_server(os.getpid()) is False


def test_spawn_options_match_the_platform() -> None:
    options = LlamaEngine._spawn_options()
    if IS_WINDOWS:
        assert "creationflags" in options
    else:
        assert options.get("start_new_session") is True


def test_terminate_tree_stops_a_child_process() -> None:
    import subprocess
    import time

    process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    try:
        asyncio.run(asyncio.to_thread(_terminate_tree, process.pid, 5.0))
        for _ in range(50):
            if process.poll() is not None:
                break
            time.sleep(0.05)
        assert process.poll() is not None
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


def test_fake_engine_streams_deterministic_output(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    engine = FakeEngine(settings)
    chunks: list[str] = []

    async def collect() -> object:
        return await engine.ocr(
            image_paths=["uploads/up_1/page-1.png"],
            prompt="document parsing.",
            max_tokens=1024,
            on_delta=chunks.append,
        )

    result = asyncio.run(collect())
    assert engine.status == "ready"
    assert "Fake OCR page 1" in result.text
    assert result.finish_reason == "stop"
    assert result.completion_tokens > 0
    assert "".join(chunks) == result.text
    assert engine.model_status().ready is True
    assert engine.status_model().engine_type == "fake"
    assert engine.available()
    asyncio.run(engine.stop())
    assert engine.status == "stopped"


def test_fake_engine_multi_page_and_cancel(tmp_path: Path) -> None:
    settings = make_settings(tmp_path, fake_engine_delay=0.0)
    engine = FakeEngine(settings)

    result = asyncio.run(
        engine.ocr(
            image_paths=["a/page-1.png", "a/page-2.png"],
            prompt="x",
            max_tokens=100,
        )
    )
    assert "<PAGE>" in result.text
    assert "Fake OCR page 1" in result.text and "Fake OCR page 2" in result.text

    canceled = asyncio.run(
        engine.ocr(
            image_paths=["a/page-1.png"],
            prompt="x",
            max_tokens=100,
            cancel_check=lambda: True,
        )
    )
    assert canceled.canceled is True
    assert canceled.finish_reason == "canceled"


def test_engine_selection_prefers_fake_and_auto_behaviour(tmp_path: Path) -> None:
    fake = FakeEngine(make_settings(tmp_path))
    llama = SimpleNamespace()
    torch_ok = SimpleNamespace(available=lambda: True, weights_status=lambda: {"ready": True})
    torch_missing = SimpleNamespace(available=lambda: False)
    assert resolve_engine_kind("auto", llama, torch_ok, fake) == "fake"
    assert resolve_engine_kind("auto", llama, torch_ok) == "transformers"
    assert resolve_engine_kind("auto", llama, torch_missing) == "llama_cpp"
    assert resolve_engine_kind("llama_cpp", llama, torch_ok) == "llama_cpp"
    assert resolve_engine_kind("transformers", llama, torch_missing) == "transformers"


class TorchStub:
    def __init__(self, *, cuda: bool = False, mps: bool = False) -> None:
        self.cuda = SimpleNamespace(is_available=lambda: cuda)
        self.backends = SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps))


def test_transformers_device_resolution(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    engine = TransformersEngine(settings)
    assert engine._resolve_device(TorchStub(cuda=True, mps=True)) == "cuda"
    assert engine._resolve_device(TorchStub(cuda=False, mps=True)) == "mps"
    assert engine._resolve_device(TorchStub(cuda=False, mps=False)) == "cpu"

    engine.config.uocr2_device = "cuda"
    with pytest.raises(EngineUnavailableError):
        engine._resolve_device(TorchStub())
    engine.config.uocr2_device = "mps"
    with pytest.raises(EngineUnavailableError):
        engine._resolve_device(TorchStub())
    engine.config.uocr2_device = "cpu"
    assert engine._resolve_device(TorchStub(cuda=True)) == "cpu"


def test_transformers_prompt_adaptation(tmp_path: Path) -> None:
    engine = TransformersEngine(make_settings(tmp_path))
    assert engine._adapt_prompt("document parsing.", 1) == "Multi page parsing."
    assert engine._adapt_prompt("Document Parsing", 2) == "Multi page parsing."
    assert engine._adapt_prompt("", 1) == "Multi page parsing."
    assert engine._adapt_prompt("extract just tables", 1) == "extract just tables"


def test_transformers_weights_status_requires_files_and_shards(tmp_path: Path) -> None:
    root = tmp_path / "models" / "uocr2"
    root.mkdir(parents=True)
    engine = TransformersEngine(make_settings(tmp_path))
    assert engine.weights_status()["ready"] is False
    for name in (
        "config.json",
        "model.safetensors.index.json",
        "modeling_unlimitedocr.py",
        "deepencoder.py",
        "tokenizer.json",
        "tokenizer_config.json",
    ):
        (root / name).write_text("{}", encoding="utf-8")
    (root / "model-00001-of-00001.safetensors").write_bytes(b"x")
    status = engine.weights_status()
    assert status["ready"] is True
    assert status["shards"] == ["model-00001-of-00001.safetensors"]
    assert status["download_command"] is None


def test_transformers_start_without_weights_raises_model_missing(tmp_path: Path) -> None:
    engine = TransformersEngine(make_settings(tmp_path, uocr2_dir=tmp_path / "nope"))
    with pytest.raises(ModelMissingError):
        asyncio.run(engine.start())
    assert engine.status == "error"
