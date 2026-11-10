from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image

from app.services.figures import (
    extract_figures,
    page_figure_json,
    page_markdown,
)
from tests.helpers import make_settings


def make_page_image(tmp_path: Path, width: int = 1000, height: int = 1400) -> tuple[Path, dict]:
    settings = make_settings(tmp_path)
    settings.ensure_dirs()
    image_path = settings.uploads_dir / "up_fig" / "page-1.png"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    # A solid red page makes every crop easy to identify.
    image = Image.new("RGB", (width, height), (200, 30, 30))
    image.save(image_path)
    page = {
        "position": 0,
        "image_path": "uploads/up_fig/page-1.png",
        "width": width,
        "height": height,
        "output_clean": "Body text",
        "blocks": [
            {"label": "text", "box": [80, 100, 920, 300], "text": "Body text"},
            {"label": "image", "box": [120, 640, 880, 820], "text": ""},
            {"label": "image_caption", "box": [120, 830, 880, 870], "text": "Figure 1"},
        ],
    }
    return settings, page


def test_extract_figures_crops_normalized_boxes(tmp_path: Path) -> None:
    settings, page = make_page_image(tmp_path)
    figures = extract_figures(settings, "job_1", page)
    assert len(figures) == 1
    figure = figures[0]
    assert figure["block_index"] == 1
    assert figure["label"] == "image"
    assert figure["data_url"].startswith("data:image/png;base64,")
    assert Path(figure["path"]).exists()
    payload = base64.b64decode(figure["data_url"].split(",", 1)[1])
    crop = Image.open(io.BytesIO(payload))
    # 760/1000 of 1000 px wide, 180/1000 of 1400 px tall.
    assert 700 <= crop.width <= 800
    assert 230 <= crop.height <= 280
    assert crop.getpixel((crop.width // 2, crop.height // 2)) == (200, 30, 30)


def test_extract_figures_uses_pixel_boxes_when_out_of_range(tmp_path: Path) -> None:
    settings, page = make_page_image(tmp_path, width=4000, height=5000)
    page["blocks"] = [{"label": "figure", "box": [400, 800, 1200, 1800], "text": ""}]
    figures = extract_figures(settings, "job_2", page)
    assert figures[0]["data_url"]
    crop = Image.open(io.BytesIO(base64.b64decode(figures[0]["data_url"].split(",", 1)[1])))
    assert (crop.width, crop.height) == (800, 1000)


def test_missing_page_render_degrades_gracefully(tmp_path: Path) -> None:
    settings, page = make_page_image(tmp_path)
    page["image_path"] = "uploads/up_fig/missing.png"
    figures = extract_figures(settings, "job_3", page)
    assert figures[0]["data_url"] is None
    assert "missing" in figures[0]["warning"].lower()


def test_page_markdown_embeds_figures_in_block_order(tmp_path: Path) -> None:
    settings, page = make_page_image(tmp_path)
    figures = extract_figures(settings, "job_4", page)
    markdown = page_markdown(page, figures)
    assert markdown.startswith("Body text")
    assert "![image](data:image/png;base64," in markdown
    assert "Figure 1" in markdown
    assert markdown.index("Body text") < markdown.index("![image]") < markdown.index("Figure 1")


def test_page_markdown_without_figures_keeps_clean_output(tmp_path: Path) -> None:
    _settings, page = make_page_image(tmp_path)
    page["blocks"] = [{"label": "text", "box": None, "text": "Only text"}]
    assert page_markdown(page, []) == "Body text"


def test_page_figure_json_strips_filesystem_paths(tmp_path: Path) -> None:
    settings, page = make_page_image(tmp_path)
    figures = extract_figures(settings, "job_5", page)
    payload = page_figure_json(page, figures)
    assert payload[0]["block_index"] == 1
    assert "data_url" in payload[0]
    assert "path" not in payload[0]
