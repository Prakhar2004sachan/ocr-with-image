from __future__ import annotations

import os
import re
import secrets
from datetime import UTC, datetime
from pathlib import Path

from .errors import AppError

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]+")
_RANGE_SPLIT = re.compile(r"[\s,]+")


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def utc_now() -> datetime:
    return datetime.now(UTC)


def iso_now() -> str:
    return utc_now().isoformat().replace("+00:00", "Z")


def sanitize_filename(name: str, fallback: str = "document") -> str:
    name = (name or "").replace("\\", "/").split("/")[-1].strip()
    name = _SAFE_NAME.sub("_", name).strip(" .")
    name = re.sub(r"_{2,}", "_", name)
    if not name:
        return fallback
    stem = Path(name).stem[:80] or fallback
    suffix = Path(name).suffix[:12]
    return f"{stem}{suffix}"


def parse_page_selection(spec: str | None, page_count: int, *, max_pages: int) -> list[int]:
    """Parse a human page selection such as ``1-3, 5, 8-``.

    The returned list is sorted, de-duplicated and one-based.
    """
    if page_count <= 0:
        raise AppError("This file has no pages.", code="empty_document")

    normalized_spec = (spec or "").strip().strip(",; ").lower()
    if not normalized_spec or normalized_spec in {"all", "*", "every"}:
        pages = list(range(1, page_count + 1))
    else:
        normalized = spec.replace("–", "-").replace("—", "-").strip()
        pages: list[int] = []
        for part in _RANGE_SPLIT.split(normalized):
            if not part:
                continue
            if "-" in part:
                start_raw, _, end_raw = part.partition("-")
                try:
                    start = int(start_raw) if start_raw else 1
                    end = int(end_raw) if end_raw else page_count
                except ValueError as exc:
                    raise AppError(
                        f"Could not understand page selection “{part}”.",
                        code="invalid_page_selection",
                        hint="Use formats like 1-5, 8, 11-.",
                    ) from exc
            else:
                try:
                    start = end = int(part)
                except ValueError as exc:
                    raise AppError(
                        f"Could not understand page selection “{part}”.",
                        code="invalid_page_selection",
                        hint="Use formats like 1-5, 8, 11-.",
                    ) from exc

            if start < 1 or end < 1 or start > page_count or end > page_count or start > end:
                raise AppError(
                    f"Page range {part} is outside this document (1–{page_count}).",
                    code="invalid_page_selection",
                )
            pages.extend(range(start, end + 1))

        pages = sorted(set(pages))

    if len(pages) > max_pages:
        raise AppError(
            f"That selection contains {len(pages)} pages; the limit is {max_pages} per job.",
            code="too_many_pages",
            hint="Select a smaller range, or split the document into multiple jobs.",
        )
    if not pages:
        raise AppError("No pages were selected.", code="invalid_page_selection")
    return pages


def human_bytes(num: float | None) -> str:
    if num is None:
        return "—"
    value = float(num)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return "—"


def relative_data_path(base: Path, candidate: Path) -> str:
    """Store data-relative paths with forward slashes on every platform.

    URLs and the SQLite archive must be portable: a Windows relative path
    (``uploads\\up_1\\page-1.png``) would 404 when turned into a URL, and a
    database written on Linux could not be read back on Windows.
    """
    try:
        relative = candidate.resolve().relative_to(base.resolve())
    except ValueError:
        relative = candidate
    return relative.as_posix()


def resolve_data_path(base: Path, relative: str | None) -> Path | None:
    """Resolve a stored data-relative path back to an absolute path."""
    if not relative:
        return None
    candidate = Path(relative)
    if candidate.is_absolute():
        return candidate
    # Split manually so a forward-slash path works on Windows and a
    # backslash path written by an older build still works on POSIX.
    parts = [part for part in re.split(r"[\\/]+", str(relative)) if part]
    return base.joinpath(*parts)


def url_path(relative: str) -> str:
    """Return a URL-safe relative path (forward slashes on every platform)."""
    return str(relative).replace("\\", "/").replace(os.sep, "/").lstrip("/")


def safe_within(base: Path, candidate: Path) -> Path:
    base = base.resolve()
    candidate = candidate.resolve()
    if candidate != base and base not in candidate.parents:
        raise AppError("That file path is not allowed.", code="invalid_path", status_code=400)
    return candidate
