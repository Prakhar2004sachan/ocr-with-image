from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..schemas import OcrBlock

# Unlimited-OCR-1 (llama.cpp) keeps the <|det|> wrappers.
_TAGGED_BLOCK = re.compile(
    r"<\|det\|>\s*([A-Za-z][A-Za-z_]{0,24})\s*\[([^\]]*)\]\s*<\|/det\|>(.*?)(?=<\|det\|>|\Z)",
    re.DOTALL,
)
# Unlimited-OCR-2 (original transformers weights) emits its own block grammar:
#   <BLOCK>label[<LEVEL1>][x1, y1, x2, y2]<FORK>text
# The level tag and the box are both optional, and the text may be empty
# (an ``image`` block carries geometry but no glyphs).
_BLOCK_TAG = re.compile(r"<BLOCK>", re.IGNORECASE)
_FORK_TAG = re.compile(r"<FORK>", re.IGNORECASE)
_LEVEL_TAG = re.compile(r"<LEVEL\s*([1-9])>", re.IGNORECASE)
_BOX_AFTER_LABEL = re.compile(
    r"^\s*([A-Za-z][A-Za-z_]{0,24})"
    r"(?:\s*<LEVEL\s*[1-9]>)?"
    r"\s*\[\s*(-?\d{1,5})\s*,\s*(-?\d{1,5})\s*,\s*(-?\d{1,5})\s*,\s*(-?\d{1,5})\s*\]"
)
# llama-server strips special tokens, leaving "label [x, y, x, y]content".
_PLAIN_BLOCK = re.compile(
    r"^[ \t]*([A-Za-z][A-Za-z_]{1,24})\s*\[\s*(\d{1,4})\s*,\s*(\d{1,4})\s*,\s*(\d{1,4})\s*,\s*(\d{1,4})\s*\]\s*(.*)$"
)
_SPECIAL_TOKEN = re.compile(r"<\|(?!det\||/det\|)[^|]{1,80}\|>")
_PAGE_MARKER = re.compile(r"<PAGE>", re.IGNORECASE)
_KNOWN_LABELS = {
    "abstract",
    "author",
    "caption",
    "code",
    "date",
    "email",
    "figure",
    "footer",
    "formula",
    "header",
    "image",
    "image_caption",
    "list",
    "page_number",
    "reference",
    "table",
    "text",
    "title",
}
# Blocks that carry geometry but legitimately have no text of their own.
# They must survive parsing so the layout overlay can draw them.
_GEOMETRY_ONLY_LABELS = {"image", "figure"}


@dataclass
class ParsedPage:
    blocks: list[OcrBlock] = field(default_factory=list)
    clean: str = ""
    warning: str | None = None

    @property
    def plain(self) -> str:
        return self.clean


def _box(values: str) -> tuple[int, int, int, int] | None:
    try:
        nums = [int(float(part.strip())) for part in values.split(",")]
    except (TypeError, ValueError):
        return None
    if len(nums) != 4:
        return None
    x1, y1, x2, y2 = nums
    x1, x2 = sorted((max(0, x1), max(0, x2)))
    y1, y2 = sorted((max(0, y1), max(0, y2)))
    if x2 <= x1 or y2 <= y1:
        return None
    return (x1, y1, x2, y2)


def _box_from_groups(groups: tuple[str, ...]) -> tuple[int, int, int, int] | None:
    return _box(",".join(groups))


def _clean_block_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _PAGE_MARKER.sub("", text)
    text = _BLOCK_TAG.sub("", text)
    text = _FORK_TAG.sub("", text)
    text = _LEVEL_TAG.sub("", text)
    text = _SPECIAL_TOKEN.sub("", text)
    text = text.replace("\u0000", "").replace("\ufffd", "")
    lines = []
    for line in text.split("\n"):
        line = re.sub(r"[ \t]+", " ", line).strip()
        lines.append(line)
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def split_page_output(raw: str) -> list[str]:
    """Split a multi-page response on the model's ``<PAGE>`` markers."""
    if not _PAGE_MARKER.search(raw):
        return [raw]
    parts = _PAGE_MARKER.split(raw)
    return [part for part in parts if part.strip()]


def _parse_block_grammar(raw: str) -> list[OcrBlock]:
    """Parse Unlimited-OCR-2's ``<BLOCK>label[box]<FORK>text`` stream.

    The grammar is positional rather than line based: a block runs from one
    ``<BLOCK>`` to the next ``<BLOCK>`` (or end of text), and ``<FORK>``
    separates the header (label + optional level + optional box) from the
    body. Anything before the first ``<BLOCK>`` is preamble and is ignored.
    """
    if not _BLOCK_TAG.search(raw):
        return []

    blocks: list[OcrBlock] = []
    # Keep the leading marker so the split yields a header segment per block.
    segments = _BLOCK_TAG.split(raw)[1:]
    for segment in segments:
        header, sep, body = segment.partition("<FORK>")
        if not sep:
            # No <FORK>: either a truncated block or a bare header. Treat the
            # whole segment as the header and let the body stay empty.
            body = ""
        match = _BOX_AFTER_LABEL.match(header)
        if not match:
            # Malformed header (the model drifted): keep the text as plain
            # content rather than dropping the page.
            leftover = _clean_block_text(header + body)
            if leftover:
                blocks.append(OcrBlock(label="text", box=None, text=leftover))
            continue
        label = match.group(1).lower()
        box = _box_from_groups(match.groups()[1:5])
        text = _clean_block_text(body)
        if not text and label not in _GEOMETRY_ONLY_LABELS:
            continue
        blocks.append(OcrBlock(label=label, box=box, text=text))
    return blocks


def parse_ocr_output(raw: str, *, prompt_mode: str = "layout") -> ParsedPage:
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    if not raw.strip():
        return ParsedPage(clean="", warning="The model returned an empty response.")

    blocks: list[OcrBlock] = []

    # Unlimited-OCR-2's own block grammar takes precedence when present.
    blocks = _parse_block_grammar(raw)

    # Unlimited-OCR-1 exports keep the <|det|> wrappers.
    if not blocks:
        for match in _TAGGED_BLOCK.finditer(raw):
            label = match.group(1).lower()
            text = _clean_block_text(match.group(3))
            if text or label in _GEOMETRY_ONLY_LABELS:
                blocks.append(OcrBlock(label=label, box=_box(match.group(2)), text=text))

    if not blocks:
        # llama-server strips special tokens, leaving "text [x, y, x, y]content".
        current: OcrBlock | None = None
        unlabeled: list[str] = []
        for line in raw.split("\n"):
            match = _PLAIN_BLOCK.match(line)
            if match:
                label = match.group(1).lower()
                if label in _KNOWN_LABELS or len(label) > 2:
                    text = _clean_block_text(match.group(6))
                    # Flush the previous block even when it had no text: an
                    # ``image``/``figure`` block carries geometry only, and
                    # dropping it here is what made figures disappear from the
                    # layout overlay.
                    if current and (
                        current.text or current.label in _GEOMETRY_ONLY_LABELS
                    ):
                        blocks.append(current)
                    current = OcrBlock(
                        label=label,
                        box=_box(",".join(match.groups()[1:5])),
                        text=text,
                    )
                    continue
            if current is not None:
                addition = _clean_block_text(line)
                if addition:
                    current.text = f"{current.text}\n{addition}" if current.text else addition
            else:
                cleaned = _clean_block_text(line)
                if cleaned:
                    unlabeled.append(cleaned)
        if current is not None:
            blocks.append(current)
        if not blocks and unlabeled:
            text = _clean_block_text("\n".join(unlabeled))
            if text:
                blocks.append(OcrBlock(label="text", box=None, text=text))

    # Drop empty blocks and collapse exact consecutive duplicates. Geometry-only
    # blocks (image/figure) are kept even though their text is empty, otherwise
    # the layout overlay loses every figure on the page.
    cleaned_blocks: list[OcrBlock] = []
    for block in blocks:
        block.text = _clean_block_text(block.text)
        if not block.text and block.label not in _GEOMETRY_ONLY_LABELS:
            continue
        if cleaned_blocks and cleaned_blocks[-1].text == block.text and block.text:
            continue
        if (
            cleaned_blocks
            and not block.text
            and cleaned_blocks[-1].label == block.label
            and cleaned_blocks[-1].box == block.box
        ):
            continue
        cleaned_blocks.append(block)

    if not cleaned_blocks:
        return ParsedPage(clean="", warning="The model returned no readable text.")

    clean = "\n\n".join(block.text for block in cleaned_blocks if block.text)

    warning = detect_repetition(raw)
    return ParsedPage(blocks=cleaned_blocks, clean=clean.strip(), warning=warning)


def detect_repetition(text: str) -> str | None:
    """Cheap guard against the model falling into a short repeat loop."""
    tail = text[-1200:]
    compact = re.sub(r"\s+", " ", tail)
    for period in (24, 40, 64, 96, 128):
        if len(compact) < period * 5:
            continue
        chunk = compact[-period:]
        if compact.count(chunk) >= 5:
            return (
                "The model appears to have entered a repetition loop. "
                "Try the layout prompt, a smaller page range, or a higher token limit."
            )
    return None


def strip_repeated_margins(pages: list[list[OcrBlock]]) -> list[list[OcrBlock]]:
    """Remove running headers/footers that repeat on most pages."""
    if len(pages) < 3:
        return pages

    def signature(block: OcrBlock) -> str:
        return re.sub(r"\s+", " ", block.text).strip().lower()

    first_counts: dict[str, int] = {}
    last_counts: dict[str, int] = {}
    for blocks in pages:
        if blocks:
            first_counts[signature(blocks[0])] = first_counts.get(signature(blocks[0]), 0) + 1
            last_counts[signature(blocks[-1])] = last_counts.get(signature(blocks[-1]), 0) + 1

    threshold = max(3, int(len(pages) * 0.6 + 0.999))
    repeated_first = {k for k, v in first_counts.items() if v >= threshold and 0 < len(k) < 200}
    repeated_last = {k for k, v in last_counts.items() if v >= threshold and 0 < len(k) < 200}

    result: list[list[OcrBlock]] = []
    for blocks in pages:
        kept = list(blocks)
        if kept and signature(kept[0]) in repeated_first:
            kept = kept[1:]
        if kept and signature(kept[-1]) in repeated_last:
            kept = kept[:-1]
        # A page that consists only of a running header/footer keeps its
        # original blocks rather than becoming an empty result.
        result.append(kept or list(blocks))
    return result


def render_blocks(blocks: list[OcrBlock]) -> str:
    return "\n\n".join(block.text for block in blocks if block.text).strip()
