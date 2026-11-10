"""Extract figure/image blocks from rendered pages for exports.

The OCR model reports figure regions as geometry-only blocks
(``image [x1,y1,x2,y2]``). The studio already draws those boxes in the Source
tab, but a Markdown export previously contained only the text blocks, so the
figures silently disappeared. This module crops each figure from the cached
page render and embeds it as a data URI, producing a self-contained Markdown
file that shows the images on any viewer.
"""

from __future__ import annotations

import base64
import io
from collections.abc import Callable
from typing import Any

from PIL import Image

from ..config import Settings
from ..utils import resolve_data_path

FIGURE_LABELS = {"image", "figure"}
_MIN_CROP_PX = 8


def _figure_blocks(page: dict[str, Any]) -> list[tuple[int, dict[str, Any]]]:
    found: list[tuple[int, dict[str, Any]]] = []
    for index, block in enumerate(page.get("blocks") or []):
        label = str(block.get("label") or "").lower()
        box = block.get("box")
        if label not in FIGURE_LABELS or not box or len(box) != 4:
            continue
        found.append((index, block))
    return found


def _crop_box(
    box: list[int] | tuple[int, int, int, int], width: int, height: int
) -> tuple[int, int, int, int] | None:
    x1, y1, x2, y2 = (int(value) for value in box)
    x1, x2 = sorted((x1, x2))
    y1, y2 = sorted((y1, y2))
    if x2 <= x1 or y2 <= y1:
        return None
    # Models trained by Baidu emit boxes normalized to a 0-1000 grid. Older
    #/custom outputs occasionally use pixel coordinates; detect those when a
    # value exceeds the normalized range and fall back to pixel space.
    normalized = max(x2, y2) <= 1000
    if normalized:
        left = round(x1 * width / 1000)
        right = round(x2 * width / 1000)
        top = round(y1 * height / 1000)
        bottom = round(y2 * height / 1000)
    else:
        left, top, right, bottom = x1, y1, x2, y2
    left = max(0, min(width - 1, left))
    right = max(left + 1, min(width, right))
    top = max(0, min(height - 1, top))
    bottom = max(top + 1, min(height, bottom))
    if right - left < _MIN_CROP_PX or bottom - top < _MIN_CROP_PX:
        return None
    return left, top, right, bottom


def extract_figures(
    config: Settings,
    job_id: str,
    page: dict[str, Any],
) -> list[dict[str, Any]]:
    """Return figure crops for a page, cached under ``data/outputs``.

    Each item carries the original block index, label, box, saved path, and a
    ``data_url`` suitable for a self-contained Markdown image.
    """
    blocks = _figure_blocks(page)
    if not blocks:
        return []

    source = resolve_data_path(config.data_dir, page.get("image_path"))
    if source is None or not source.exists():
        return [
            {
                "block_index": index,
                "label": block.get("label"),
                "box": block.get("box"),
                "data_url": None,
                "path": None,
                "warning": "The page render is missing, so this figure cannot be exported.",
            }
            for index, block in blocks
        ]

    folder = config.outputs_dir / job_id
    figures: list[dict[str, Any]] = []
    try:
        with Image.open(source) as opened:
            image = opened.convert("RGB")
            width, height = image.size
            for order, (index, block) in enumerate(blocks):
                crop_box = _crop_box(block["box"], width, height)
                if crop_box is None:
                    figures.append(
                        {
                            "block_index": index,
                            "label": block.get("label"),
                            "box": block.get("box"),
                            "data_url": None,
                            "path": None,
                            "warning": "The figure box was too small or invalid to crop.",
                        }
                    )
                    continue
                crop = image.crop(crop_box)
                # Cap absurdly large crops while keeping normal figures sharp.
                if max(crop.size) > 1800:
                    crop.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
                folder.mkdir(parents=True, exist_ok=True)
                output = folder / f"page-{page.get('position', 0) + 1}-figure-{order + 1}.png"
                buffer = io.BytesIO()
                crop.save(buffer, "PNG", optimize=True)
                payload = buffer.getvalue()
                output.write_bytes(payload)
                figures.append(
                    {
                        "block_index": index,
                        "label": block.get("label"),
                        "box": block.get("box"),
                        "data_url": "data:image/png;base64,"
                        + base64.b64encode(payload).decode("ascii"),
                        "path": str(output),
                        "warning": None,
                    }
                )
    except Exception as exc:
        return [
            {
                "block_index": index,
                "label": block.get("label"),
                "box": block.get("box"),
                "data_url": None,
                "path": None,
                "warning": f"Could not crop this figure: {exc}",
            }
            for index, block in blocks
        ]
    return figures


def page_markdown(
    page: dict[str, Any],
    figures: list[dict[str, Any]],
    image_src: Callable[[dict[str, Any]], str | None] | None = None,
) -> str:
    """Render a page as Markdown with figure images in block order.

    By default images are inline data URIs (a self-contained ``.md``). A ZIP
    export passes ``image_src`` to emit relative paths instead.
    """
    if not figures:
        return page.get("output_clean") or ""

    by_index = {figure["block_index"]: figure for figure in figures}
    blocks = page.get("blocks") or []
    parts: list[str] = []
    for index, block in enumerate(blocks):
        text = (block.get("text") or "").strip()
        figure = by_index.get(index)
        if figure is not None:
            label = (figure.get("label") or "figure").strip() or "figure"
            source = image_src(figure) if image_src is not None else figure.get("data_url")
            if source:
                parts.append(f"![{label}]({source})")
            else:
                parts.append(f"> [{label} image unavailable: {figure.get('warning') or 'no crop'}]")
        if text:
            parts.append(text)
    if not parts:
        return page.get("output_clean") or ""
    return "\n\n".join(parts).strip()


def remove_job_figures(config: Settings, job_id: str) -> None:
    """Delete cached figure crops when a job is removed."""
    import shutil

    shutil.rmtree(config.outputs_dir / job_id, ignore_errors=True)


def page_figure_json(page: dict[str, Any], figures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Metadata for the JSON export (without duplicating the page render)."""
    return [
        {
            "block_index": figure["block_index"],
            "label": figure["label"],
            "box": figure["box"],
            "data_url": figure["data_url"],
            "warning": figure["warning"],
        }
        for figure in figures
    ]
