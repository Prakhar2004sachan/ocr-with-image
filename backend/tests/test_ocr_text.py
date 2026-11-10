from __future__ import annotations

from app.schemas import OcrBlock
from app.services.ocr_text import (
    detect_repetition,
    parse_ocr_output,
    render_blocks,
    split_page_output,
    strip_repeated_margins,
)


def test_plain_layout_blocks_keep_boxes_and_order() -> None:
    raw = (
        "title [116, 101, 884, 159]Introduction\n"
        "text [143, 200, 884, 217]The quick brown fox.\n"
        "page_number [493, 923, 506, 935]7\n"
    )
    parsed = parse_ocr_output(raw)
    assert [block.label for block in parsed.blocks] == ["title", "text", "page_number"]
    assert parsed.blocks[0].box == (116, 101, 884, 159)
    assert parsed.blocks[0].text == "Introduction"
    assert "[143, 200" not in parsed.clean
    assert "page_number" not in parsed.clean
    assert parsed.warning is None


def test_tagged_det_blocks() -> None:
    raw = "<|det|> title [10, 20, 300, 400] <|/det|>Unlimited OCR"
    parsed = parse_ocr_output(raw)
    assert len(parsed.blocks) == 1
    assert parsed.blocks[0].box == (10, 20, 300, 400)
    assert parsed.blocks[0].text == "Unlimited OCR"


def test_ocr2_block_grammar_with_level_and_geometry_only_figure() -> None:
    raw = (
        "<PAGE><BLOCK>header[122, 27, 324, 77]<FORK>Baidu 百度\n"
        "<BLOCK>title<LEVEL1>[357, 135, 642, 156]<FORK>Unlimited OCR Works\n"
        "<BLOCK>text[288, 162, 711, 181]<FORK>Welcome the Era\n"
        "<BLOCK>image[166, 602, 819, 800]<FORK>\n"
        "<BLOCK>image_caption[114, 814, 885, 895]<FORK>Figure 1 | R-SWA."
    )
    parsed = parse_ocr_output(raw)
    assert [block.label for block in parsed.blocks] == [
        "header",
        "title",
        "text",
        "image",
        "image_caption",
    ]
    image = parsed.blocks[3]
    assert image.box == (166, 602, 819, 800)
    assert image.text == ""
    assert "<BLOCK>" not in parsed.clean
    assert "<FORK>" not in parsed.clean
    assert "<LEVEL1>" not in parsed.clean


def test_ocr2_malformed_header_falls_back_to_text() -> None:
    parsed = parse_ocr_output("<BLOCK>this header is broken<FORK>but readable")
    assert parsed.blocks[0].label == "text"
    assert "but readable" in parsed.clean


def test_plain_unlabeled_text_becomes_one_block() -> None:
    parsed = parse_ocr_output("Just some model prose\non two lines.")
    assert len(parsed.blocks) == 1
    assert parsed.blocks[0].label == "text"
    assert parsed.clean == "Just some model prose\non two lines."


def test_geometry_only_image_block_survives_plain_parsing() -> None:
    raw = (
        "text [113, 318, 885, 590]Body copy.\n"
        "image [168, 601, 825, 804]\n"
        "image_caption [113, 814, 885, 896]Figure 1 | Caption."
    )
    parsed = parse_ocr_output(raw)
    image = next(block for block in parsed.blocks if block.label == "image")
    assert image.box == (168, 601, 825, 804)
    assert image.text == ""


def test_clean_output_strips_special_tokens_but_keeps_text() -> None:
    parsed = parse_ocr_output(
        "<|det|>text [1, 2, 30, 40]<|/det|>Hello<|endoftext|> world"
    )
    assert parsed.clean == "Hello world"


def test_empty_output_warns() -> None:
    parsed = parse_ocr_output("   ")
    assert parsed.clean == ""
    assert parsed.warning


def test_repetition_detection() -> None:
    assert detect_repetition("lorem ipsum dolor sit amet " * 60)
    assert detect_repetition("A perfectly normal page of prose.") is None


def test_split_page_output() -> None:
    assert split_page_output("first<PAGE>second<PAGE>third") == ["first", "second", "third"]
    assert split_page_output("no markers") == ["no markers"]
    assert split_page_output("<PAGE>only") == ["only"]


def test_strip_repeated_margins_removes_only_common_edges() -> None:
    pages = [
        [
            OcrBlock(label="header", text="ACME REPORT"),
            OcrBlock(label="text", text="Body one"),
            OcrBlock(label="footer", text="Page 1"),
        ],
        [
            OcrBlock(label="header", text="ACME REPORT"),
            OcrBlock(label="text", text="Body two"),
            OcrBlock(label="footer", text="Page 2"),
        ],
        [
            OcrBlock(label="header", text="ACME REPORT"),
            OcrBlock(label="text", text="Body three"),
            OcrBlock(label="footer", text="Page 3"),
        ],
    ]
    stripped = strip_repeated_margins(pages)
    assert stripped[0][0].text == "Body one"
    assert stripped[1][0].text == "Body two"
    assert stripped[2][0].text == "Body three"


def test_strip_repeated_margins_needs_three_pages() -> None:
    pages = [[OcrBlock(label="text", text="one")], [OcrBlock(label="text", text="one")]]
    assert strip_repeated_margins(pages) == pages


def test_strip_repeated_margins_keeps_a_page_with_only_margins() -> None:
    pages = [
        [OcrBlock(label="header", text="ACME"), OcrBlock(label="footer", text="1")],
        [OcrBlock(label="header", text="ACME"), OcrBlock(label="footer", text="1")],
        [OcrBlock(label="header", text="ACME"), OcrBlock(label="footer", text="1")],
    ]
    stripped = strip_repeated_margins(pages)
    assert stripped[0] == pages[0]


def test_render_blocks_skips_empty() -> None:
    assert render_blocks([OcrBlock(label="text", text="a"), OcrBlock(label="image", text="")]) == "a"
