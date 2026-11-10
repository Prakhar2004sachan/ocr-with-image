from __future__ import annotations

import io
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pymupdf
from fastapi import UploadFile
from PIL import Image, ImageOps, ImageSequence, UnidentifiedImageError

from ..config import Settings
from ..db import Database
from ..errors import AppError, PayloadTooLargeError, UnsupportedFileError
from ..utils import new_id, relative_data_path, resolve_data_path, sanitize_filename

try:  # Optional HEIC/HEIF support (bundled on all platforms when installed).
    import pillow_heif

    pillow_heif.register_heif_opener()
except Exception:  # pragma: no cover - optional dependency
    pass

Image.MAX_IMAGE_PIXELS = 80_000_000
SUPPORTED_IMAGE_MIME = {
    "PNG": ("image/png", ".png"),
    "JPEG": ("image/jpeg", ".jpg"),
    "WEBP": ("image/webp", ".webp"),
    "BMP": ("image/bmp", ".bmp"),
    "TIFF": ("image/tiff", ".tiff"),
    "GIF": ("image/gif", ".gif"),
    "HEIF": ("image/heic", ".heic"),
    "AVIF": ("image/avif", ".avif"),
}
MAX_IMAGE_DIMENSION = 8000


@dataclass
class SavedUpload:
    upload: dict[str, Any]
    warnings: list[str]


def _rel(settings: Settings, path: Path) -> str:
    return relative_data_path(settings.data_dir, path)


def _flatten(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
        background = Image.new("RGB", image.size, (255, 255, 255))
        rgba = image.convert("RGBA")
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


def _save_thumb(image: Image.Image, path: Path) -> tuple[int, int]:
    thumb = image.copy()
    thumb.thumbnail((420, 560), Image.Resampling.LANCZOS)
    if thumb.mode != "RGB":
        thumb = _flatten(thumb)
    path.parent.mkdir(parents=True, exist_ok=True)
    thumb.save(path, "JPEG", quality=84, optimize=True)
    return thumb.width, thumb.height


def _save_page_image(image: Image.Image, path: Path) -> tuple[int, int]:
    image = _flatten(image)
    if max(image.size) > MAX_IMAGE_DIMENSION:
        image.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)
    return image.width, image.height


async def _stream_to_disk(upload: UploadFile, destination: Path, max_bytes: int) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    with destination.open("wb") as handle:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                handle.close()
                destination.unlink(missing_ok=True)
                raise PayloadTooLargeError(
                    f"“{upload.filename or 'file'}” is larger than {max_bytes // (1024 * 1024)} MB.",
                    hint="Compress the file or split the PDF into smaller ranges.",
                )
            handle.write(chunk)
    if total == 0:
        destination.unlink(missing_ok=True)
        raise UnsupportedFileError("The uploaded file is empty.")
    return total


def _image_format(path: Path) -> str:
    try:
        with Image.open(path) as image:
            return (image.format or "").upper()
    except UnidentifiedImageError as exc:
        raise UnsupportedFileError(
            "That file is not a supported image or PDF.",
            hint="Use PDF, PNG, JPEG, WebP, TIFF, GIF, BMP, HEIC, or AVIF.",
        ) from exc
    except Exception as exc:
        raise UnsupportedFileError(f"Could not read the image: {exc}") from exc


def _looks_like_pdf(path: Path) -> bool:
    with path.open("rb") as handle:
        return handle.read(5) == b"%PDF-"


async def save_upload(
    file: UploadFile, settings: Settings, db: Database
) -> SavedUpload:
    original_name = sanitize_filename(file.filename or "document")
    upload_id = new_id("up")
    folder = settings.uploads_dir / upload_id
    folder.mkdir(parents=True, exist_ok=True)
    temp_path = settings.tmp_dir / f"{upload_id}.upload"
    max_bytes = settings.max_upload_mb * 1024 * 1024

    try:
        size = await _stream_to_disk(file, temp_path, max_bytes)
        is_pdf = _looks_like_pdf(temp_path)
        if is_pdf:
            return _save_pdf(temp_path, folder, upload_id, original_name, size, settings, db)
        return _save_image_file(
            temp_path, folder, upload_id, original_name, size, settings, db
        )
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    finally:
        temp_path.unlink(missing_ok=True)
        await file.close()


def _save_pdf(
    temp_path: Path,
    folder: Path,
    upload_id: str,
    original_name: str,
    size: int,
    settings: Settings,
    db: Database,
) -> SavedUpload:
    source_path = folder / "source.pdf"
    shutil.move(temp_path, source_path)
    try:
        document = pymupdf.open(source_path)
    except Exception as exc:
        raise UnsupportedFileError(
            "That PDF could not be opened. It may be corrupt or incomplete.",
            hint="Try re-exporting the PDF, or upload page images instead.",
        ) from exc

    try:
        if document.needs_pass:
            raise AppError(
                "This PDF is password-protected.",
                code="pdf_password",
                hint="Remove the password in Preview or Acrobat, then upload it again.",
            )
        page_count = document.page_count
        if page_count <= 0:
            raise UnsupportedFileError("That PDF has no pages.")
        if page_count > settings.max_upload_pages:
            raise AppError(
                f"This PDF has {page_count} pages; the upload limit is {settings.max_upload_pages}.",
                code="too_many_pages",
                hint="Split the PDF, then upload the pages you need.",
            )

        pages: list[dict[str, Any]] = []
        for index in range(page_count):
            page = document.load_page(index)
            try:
                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1, 1), alpha=False)
                image = Image.open(io.BytesIO(pixmap.tobytes("png")))
            except Exception:
                image = Image.new("RGB", (595, 842), "white")
            thumb_path = folder / f"thumb-{index + 1}.jpg"
            thumb_w, thumb_h = _save_thumb(image, thumb_path)
            pages.append(
                {
                    "id": new_id("pg"),
                    "page_number": index + 1,
                    "image_path": None,
                    "thumb_path": _rel(settings, thumb_path),
                    "width": thumb_w,
                    "height": thumb_h,
                }
            )
    finally:
        document.close()

    upload = db.create_upload(
        upload_id=upload_id,
        original_name=original_name,
        stored_path=_rel(settings, source_path),
        mime="application/pdf",
        size=size,
        kind="pdf",
        page_count=page_count,
        pages=pages,
    )
    return SavedUpload(upload=upload, warnings=[])


def _save_image_file(
    temp_path: Path,
    folder: Path,
    upload_id: str,
    original_name: str,
    size: int,
    settings: Settings,
    db: Database,
) -> SavedUpload:
    image_format = _image_format(temp_path)
    if image_format not in SUPPORTED_IMAGE_MIME:
        raise UnsupportedFileError(
            f"Images in {image_format or 'this'} format are not supported.",
            hint="Use PNG, JPEG, WebP, TIFF, GIF, BMP, HEIC, or AVIF.",
        )
    mime, suffix = SUPPORTED_IMAGE_MIME[image_format]
    source_path = folder / f"source{suffix}"
    shutil.move(temp_path, source_path)

    warnings: list[str] = []
    try:
        with Image.open(source_path) as opened:
            frames = []
            for frame in ImageSequence.Iterator(opened):
                frames.append(frame.copy())
                if len(frames) > settings.max_upload_pages:
                    raise AppError(
                        f"This image contains more than {settings.max_upload_pages} frames.",
                        code="too_many_pages",
                        hint="Use a shorter animation or a static page.",
                    )
        if not frames:
            raise UnsupportedFileError("That image contains no frames.")

        pages: list[dict[str, Any]] = []
        for index, frame in enumerate(frames):
            image_path = folder / f"page-{index + 1}.png"
            width, height = _save_page_image(frame, image_path)
            thumb_path = folder / f"thumb-{index + 1}.jpg"
            _save_thumb(frame, thumb_path)
            pages.append(
                {
                    "id": new_id("pg"),
                    "page_number": index + 1,
                    "image_path": _rel(settings, image_path),
                    "thumb_path": _rel(settings, thumb_path),
                    "width": width,
                    "height": height,
                }
            )
        if len(frames) > 1:
            warnings.append(f"Extracted {len(frames)} frames from this image.")
    except AppError:
        raise
    except Exception as exc:
        raise UnsupportedFileError(f"Could not decode that image: {exc}") from exc

    upload = db.create_upload(
        upload_id=upload_id,
        original_name=original_name,
        stored_path=_rel(settings, source_path),
        mime=mime,
        size=size,
        kind="image",
        page_count=len(pages),
        pages=pages,
    )
    return SavedUpload(upload=upload, warnings=warnings)


def ensure_page_image(
    db: Database, settings: Settings, upload_id: str, page_number: int, dpi: int
) -> tuple[str, int, int]:
    """Render (or reuse) a full-resolution page image and return its relative path."""
    upload = db.get_upload(upload_id)
    if not upload:
        raise AppError("The source upload no longer exists.", code="upload_missing", status_code=404)
    page = next((p for p in upload["pages"] if int(p["page_number"]) == page_number), None)
    if not page:
        raise AppError(
            f"Page {page_number} does not exist in that upload.", code="page_missing", status_code=404
        )

    if upload["kind"] == "image":
        image_path = resolve_data_path(settings.data_dir, page["image_path"])
        if image_path is None or not image_path.exists():
            raise AppError(
                "The rendered page image is missing.",
                code="page_missing",
                status_code=404,
            )
        with Image.open(image_path) as image:
            width, height = image.size
        return page["image_path"], width, height

    if page.get("image_path"):
        candidate = resolve_data_path(settings.data_dir, page["image_path"])
        if candidate and candidate.exists() and f"@{dpi}dpi" in candidate.name:
            return page["image_path"], int(page["width"] or 0), int(page["height"] or 0)

    source = resolve_data_path(settings.data_dir, upload["stored_path"])
    if source is None or not source.exists():
        raise AppError(
            "The source file is missing from local storage.",
            code="upload_missing",
            status_code=404,
        )
    output = settings.uploads_dir / upload_id / f"page-{page_number}@{dpi}dpi.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        document = pymupdf.open(source)
        pdf_page = document.load_page(page_number - 1)
        matrix = pymupdf.Matrix(dpi / 72, dpi / 72)
        pixmap = pdf_page.get_pixmap(matrix=matrix, alpha=False)
        pixmap.save(output)
        width, height = pixmap.width, pixmap.height
        document.close()
    except Exception as exc:
        raise AppError(
            f"Could not render page {page_number} of this PDF: {exc}",
            code="pdf_render_failed",
            hint="Try a lower DPI, or re-export the PDF.",
        ) from exc

    relative = _rel(settings, output)
    db.update_upload_page(page["id"], image_path=relative, width=width, height=height)
    return relative, width, height


def delete_upload_files(settings: Settings, upload: dict[str, Any]) -> None:
    folder = settings.uploads_dir / upload["id"]
    shutil.rmtree(folder, ignore_errors=True)
