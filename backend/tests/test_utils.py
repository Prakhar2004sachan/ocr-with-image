from __future__ import annotations

from pathlib import Path

import pytest

from app.errors import AppError
from app.utils import (
    human_bytes,
    iso_now,
    new_id,
    parse_page_selection,
    relative_data_path,
    resolve_data_path,
    safe_within,
    sanitize_filename,
    url_path,
)


def test_ids_are_prefixed_and_unique() -> None:
    first = new_id("job")
    second = new_id("job")
    assert first.startswith("job_") and second.startswith("job_")
    assert first != second
    assert len(first) == len("job_") + 16


def test_iso_now_is_utc() -> None:
    value = iso_now()
    assert value.endswith("Z")
    assert "T" in value


def test_sanitize_filename_handles_windows_and_unix_paths() -> None:
    assert sanitize_filename(r"C:\Users\ana\My Report.pdf") == "My Report.pdf"
    assert sanitize_filename("/home/ana/scan 01.png") == "scan 01.png"
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename("   ") == "document"
    assert sanitize_filename("a" * 200 + ".pdf").endswith(".pdf")
    assert len(sanitize_filename("a" * 200 + ".pdf")) <= 92


def test_sanitize_filename_strips_control_characters() -> None:
    cleaned = sanitize_filename('bad<>:"/\\|?*\x00 name.pdf')
    assert "<" not in cleaned and ">" not in cleaned and "\x00" not in cleaned
    assert cleaned.endswith(".pdf")


def test_parse_page_selection_defaults_to_all() -> None:
    assert parse_page_selection(None, 4, max_pages=10) == [1, 2, 3, 4]
    assert parse_page_selection("all", 2, max_pages=10) == [1, 2]
    assert parse_page_selection("*,", 3, max_pages=10) == [1, 2, 3]


def test_parse_page_selection_ranges_and_duplicates() -> None:
    assert parse_page_selection("1-3, 5, 8-", 9, max_pages=20) == [1, 2, 3, 5, 8, 9]
    assert parse_page_selection("3, 1, 2, 2", 5, max_pages=20) == [1, 2, 3]
    assert parse_page_selection("2–4", 5, max_pages=20) == [2, 3, 4]


@pytest.mark.parametrize("spec", ["0", "6", "5-2", "abc", "1-6"])
def test_parse_page_selection_rejects_invalid_ranges(spec: str) -> None:
    with pytest.raises(AppError) as error:
        parse_page_selection(spec, 5, max_pages=10)
    assert error.value.code == "invalid_page_selection"


def test_parse_page_selection_enforces_job_cap() -> None:
    with pytest.raises(AppError) as error:
        parse_page_selection("1-8", 10, max_pages=5)
    assert error.value.code == "too_many_pages"
    assert "5" in error.value.message


def test_parse_page_selection_rejects_empty_documents() -> None:
    with pytest.raises(AppError) as error:
        parse_page_selection("all", 0, max_pages=5)
    assert error.value.code == "empty_document"


def test_relative_and_resolve_data_paths_are_portable(tmp_path: Path) -> None:
    nested = tmp_path / "uploads" / "up_1" / "page-1.png"
    nested.parent.mkdir(parents=True)
    nested.write_bytes(b"x")
    relative = relative_data_path(tmp_path, nested)
    assert relative == "uploads/up_1/page-1.png"
    assert resolve_data_path(tmp_path, relative) == nested
    # A path written by an older Windows build still resolves on POSIX.
    assert resolve_data_path(tmp_path, r"uploads\up_1\page-1.png") == nested


def test_url_path_normalises_separators() -> None:
    assert url_path(r"uploads\up_1\page 1.png") == "uploads/up_1/page 1.png"
    assert url_path("/uploads/up_1/page.png") == "uploads/up_1/page.png"


def test_safe_within_allows_children_and_rejects_escape(tmp_path: Path) -> None:
    child = tmp_path / "a" / "b.txt"
    child.parent.mkdir()
    child.write_text("x")
    assert safe_within(tmp_path, child) == child.resolve()
    with pytest.raises(AppError):
        safe_within(tmp_path, tmp_path.parent / "outside.txt")


def test_human_bytes() -> None:
    assert human_bytes(None) == "—"
    assert human_bytes(0) == "0 B"
    assert human_bytes(1024) == "1.0 KB"
    assert human_bytes(1024 * 1024 * 3.5) == "3.5 MB"
