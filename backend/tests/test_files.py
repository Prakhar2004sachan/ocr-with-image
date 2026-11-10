from __future__ import annotations

import asyncio
import io
from pathlib import Path

import pytest

from app.config import Settings
from app.db import Database
from app.errors import AppError
from app.services.files import delete_upload_files, ensure_page_image, save_upload
from tests.helpers import gif_bytes, make_settings, pdf_bytes, png_bytes


class UploadFileStub:
    def __init__(self, filename: str, data: bytes, content_type: str = "application/octet-stream"):
        self.filename = filename
        self._buffer = io.BytesIO(data)
        self.content_type = content_type

    async def read(self, size: int = -1) -> bytes:
        return self._buffer.read(size)

    async def close(self) -> None:
        self._buffer.close()


def run_upload(settings: Settings, db: Database, name: str, data: bytes, mime: str = ""):
    return asyncio.run(save_upload(UploadFileStub(name, data, mime), settings, db))


def test_pdf_upload_creates_thumbnails_and_page_count(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    settings.ensure_dirs()
    db = Database(settings.db_path)
    saved = run_upload(settings, db, "report.pdf", pdf_bytes(3), "application/pdf")
    upload = saved.upload
    assert upload["kind"] == "pdf"
    assert upload["page_count"] == 3
    assert len(upload["pages"]) == 3
    assert upload["stored_path"] == f"uploads/{upload['id']}/source.pdf"
    for page in upload["pages"]:
        assert (settings.data_dir / page["thumb_path"]).exists()
        assert page["thumb_path"].startswith("uploads/")
        assert "\\" not in page["thumb_path"]
    db.close()


def test_pdf_render_at_dpi_is_cached_and_resolved(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    settings.ensure_dirs()
    db = Database(settings.db_path)
    upload = run_upload(settings, db, "report.pdf", pdf_bytes(1), "application/pdf").upload
    path, width, height = ensure_page_image(db, settings, upload["id"], 1, 150)
    assert path.endswith("@150dpi.png")
    assert width > 0 and height > 0
    assert (settings.data_dir / path).exists()
    again = ensure_page_image(db, settings, upload["id"], 1, 150)
    assert again == (path, width, height)
    db.close()


def test_image_upload_and_animated_frames(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    settings.ensure_dirs()
    db = Database(settings.db_path)
    upload = run_upload(settings, db, "shot.png", png_bytes(), "image/png").upload
    assert upload["kind"] == "image"
    assert upload["page_count"] == 1
    path, width, height = ensure_page_image(db, settings, upload["id"], 1, 200)
    assert path.startswith("uploads/")
    assert (width, height) == (320, 420)

    animation = run_upload(settings, db, "anim.gif", gif_bytes(3), "image/gif")
    assert animation.upload["page_count"] == 3
    assert animation.warnings
    db.close()


def test_upload_rejects_unsupported_empty_and_corrupt(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    settings.ensure_dirs()
    db = Database(settings.db_path)
    with pytest.raises(AppError) as unsupported:
        run_upload(settings, db, "notes.txt", b"plain", "text/plain")
    assert unsupported.value.code == "unsupported_file"
    with pytest.raises(AppError) as empty:
        run_upload(settings, db, "empty.png", b"", "image/png")
    assert empty.value.code == "unsupported_file"
    with pytest.raises(AppError) as corrupt:
        run_upload(settings, db, "broken.pdf", b"%PDF-1.4 nope", "application/pdf")
    assert corrupt.value.code == "unsupported_file"
    db.close()


def test_password_protected_pdf_is_rejected(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    settings.ensure_dirs()
    db = Database(settings.db_path)
    with pytest.raises(AppError) as error:
        run_upload(settings, db, "locked.pdf", pdf_bytes(1, password="secret"), "application/pdf")
    assert error.value.code == "pdf_password"
    assert error.value.hint
    db.close()


def test_upload_page_limit(tmp_path: Path) -> None:
    settings = make_settings(tmp_path, max_upload_pages=2)
    settings.ensure_dirs()
    db = Database(settings.db_path)
    with pytest.raises(AppError) as error:
        run_upload(settings, db, "big.pdf", pdf_bytes(3), "application/pdf")
    assert error.value.code == "too_many_pages"
    db.close()


def test_upload_size_limit_leaves_no_partial_files(tmp_path: Path) -> None:
    settings = make_settings(tmp_path, max_upload_mb=1)
    settings.ensure_dirs()
    db = Database(settings.db_path)
    with pytest.raises(AppError) as error:
        run_upload(settings, db, "huge.png", b"x" * (2 * 1024 * 1024), "image/png")
    assert error.value.code == "payload_too_large"
    assert list(settings.tmp_dir.glob("*")) == []
    assert list(settings.uploads_dir.glob("*")) == []
    db.close()


def test_missing_source_reports_upload_missing(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    settings.ensure_dirs()
    db = Database(settings.db_path)
    with pytest.raises(AppError) as error:
        ensure_page_image(db, settings, "up_missing", 1, 100)
    assert error.value.code == "upload_missing"
    db.close()


def test_delete_upload_files_removes_folder(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    settings.ensure_dirs()
    db = Database(settings.db_path)
    upload = run_upload(settings, db, "shot.png", png_bytes(), "image/png").upload
    folder = settings.uploads_dir / upload["id"]
    assert folder.exists()
    delete_upload_files(settings, upload)
    assert not folder.exists()
    db.close()
