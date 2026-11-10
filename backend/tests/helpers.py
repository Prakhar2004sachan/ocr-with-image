from __future__ import annotations

import io
import time
from typing import Any

import pymupdf
from PIL import Image

from app.config import Settings


def pdf_bytes(pages: int = 1, *, password: str | None = None, text: str = "Self test") -> bytes:
    document = pymupdf.open()
    for index in range(pages):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 100), f"{text} page {index + 1} of {pages}.", fontsize=14)
    buffer = io.BytesIO()
    if password:
        document.save(
            buffer,
            encryption=pymupdf.PDF_ENCRYPT_AES_256,
            user_pw=password,
            owner_pw=password,
        )
    else:
        document.save(buffer)
    document.close()
    return buffer.getvalue()


def png_bytes(width: int = 320, height: int = 420, color: str = "white") -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, "PNG")
    return buffer.getvalue()


def gif_bytes(frames: int = 3) -> bytes:
    images = []
    for index in range(frames):
        image = Image.new("RGB", (80, 100), (index * 60 % 255, 120, 180))
        images.append(image)
    buffer = io.BytesIO()
    images[0].save(
        buffer,
        "GIF",
        save_all=True,
        append_images=images[1:],
        duration=80,
        loop=0,
    )
    return buffer.getvalue()


def upload(
    client: Any,
    filename: str,
    data: bytes,
    content_type: str = "application/octet-stream",
) -> dict[str, Any]:
    response = client.post(
        "/api/uploads",
        files={"files": (filename, io.BytesIO(data), content_type)},
    )
    assert response.status_code == 200, response.text
    return response.json()


def first_upload(client: Any, *, pages: int = 1, name: str = "sample.pdf") -> dict[str, Any]:
    payload = upload(client, name, pdf_bytes(pages), "application/pdf")
    assert payload["errors"] == [], payload
    return payload["uploads"][0]


def make_job(
    client: Any,
    upload_ids: list[str],
    *,
    selection: dict[str, str] | None = None,
    **options: Any,
) -> Any:
    body = {
        "upload_ids": upload_ids,
        "options": {
            "prompt": "document parsing.",
            "dpi": 150,
            "page_selection": selection or {upload_id: "all" for upload_id in upload_ids},
            **options,
        },
    }
    return client.post("/api/jobs", json=body)


def wait_job(client: Any, job_id: str, timeout: float = 15.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        response = client.get(f"/api/jobs/{job_id}")
        assert response.status_code == 200, response.text
        last = response.json()
        if last["status"] in {"completed", "failed", "partial", "canceled"}:
            return last
        time.sleep(0.03)
    raise AssertionError(f"Job {job_id} did not settle: {last}")


def make_settings(tmp_path, **overrides):
    values = {
        "data_dir": tmp_path / "data",
        "models_dir": tmp_path / "models",
        "uocr2_dir": tmp_path / "models" / "uocr2",
        "llama_server_bin": str(tmp_path / "missing-llama-server"),
        "model_path": tmp_path / "missing-model.gguf",
        "mmproj_path": tmp_path / "missing-mmproj.gguf",
        "fake_engine": True,
        "engine_start_timeout": 5.0,
        "log_level": "WARNING",
    }
    values.update(overrides)
    return Settings(**values)
