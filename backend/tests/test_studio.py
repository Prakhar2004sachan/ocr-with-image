"""Self-contained backend checks for the OCR studio.

Run from ``backend/`` with::

    .venv/bin/python -m unittest tests.test_studio

Everything runs against a throwaway data directory, so the real engine, the
real database, and the model files are never touched.
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

_TEMP: Path | None = None


def setUpModule() -> None:
    global _TEMP
    _TEMP = Path(tempfile.mkdtemp(prefix="ocr-selftest-"))
    os.environ["OCR_DATA_DIR"] = str(_TEMP / "data")
    os.environ["OCR_LLAMA_SERVER_BIN"] = "/nonexistent/llama-server"
    os.environ["OCR_MODEL_PATH"] = "/nonexistent/model.gguf"
    os.environ["OCR_MMPROJ_PATH"] = "/nonexistent/mmproj.gguf"
    # The engine must stay asleep: these tests never run inference.
    settings_path = Path(os.environ["OCR_DATA_DIR"]) / "settings.json"
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(
        json.dumps({"auto_start_engine": False, "keep_history": True}), encoding="utf-8"
    )
    # Keep the noise out of the test output.
    import logging

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def tearDownModule() -> None:
    import shutil

    if _TEMP and _TEMP.exists():
        shutil.rmtree(_TEMP, ignore_errors=True)


class StudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        from fastapi.testclient import TestClient

        from app.config import Settings
        from app.main import create_app

        data_dir = Path(os.environ["OCR_DATA_DIR"])
        config = Settings(
            data_dir=data_dir,
            models_dir=data_dir / "models",
            uocr2_dir=data_dir / "models" / "uocr2",
            llama_server_bin=os.environ["OCR_LLAMA_SERVER_BIN"],
            model_path=Path(os.environ["OCR_MODEL_PATH"]),
            mmproj_path=Path(os.environ["OCR_MMPROJ_PATH"]),
            fake_engine=False,
            engine_start_timeout=5.0,
        )
        app = create_app(config, serve_frontend=False)
        cls.client_cm = TestClient(app)
        cls.client = cls.client_cm.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client_cm.__exit__(None, None, None)

    # ------------------------------------------------------------------ helpers
    def upload(self, filename: str, data: bytes, content_type: str | None = None):
        files = {"files": (filename, io.BytesIO(data), content_type or "application/octet-stream")}
        return self.client.post("/api/uploads", files=files)

    @staticmethod
    def pdf_bytes(pages: int, *, password: str | None = None) -> bytes:
        import fitz

        doc = fitz.open()
        for index in range(pages):
            doc.new_page().insert_text(
                (72, 100), f"Self test page {index + 1} of {pages}.", fontsize=14
            )
        buffer = io.BytesIO()
        if password:
            doc.save(
                buffer,
                encryption=fitz.PDF_ENCRYPT_AES_256,
                user_pw=password,
                owner_pw=password,
            )
        else:
            doc.save(buffer)
        doc.close()
        return buffer.getvalue()

    # ------------------------------------------------------------------- parsing
    def test_parse_plain_layout_blocks(self) -> None:
        from app.services.ocr_text import parse_ocr_output

        raw = (
            "title [116, 101, 884, 159]Introduction\n"
            "text [143, 200, 884, 217]The quick brown fox.\n"
            "page_number [493, 923, 506, 935]7\n"
        )
        parsed = parse_ocr_output(raw, prompt_mode="layout")
        self.assertEqual(len(parsed.blocks), 3)
        self.assertEqual(parsed.blocks[0].label, "title")
        self.assertEqual(parsed.blocks[0].box, (116, 101, 884, 159))
        self.assertEqual(parsed.blocks[0].text, "Introduction")
        self.assertEqual(parsed.blocks[2].label, "page_number")
        self.assertIn("The quick brown fox.", parsed.clean)
        self.assertNotIn("[143, 200", parsed.clean)
        self.assertIsNone(parsed.warning)

    def test_parse_tagged_blocks(self) -> None:
        from app.services.ocr_text import parse_ocr_output

        raw = "<|det|> title [10, 20, 300, 400] <|/det|>Unlimited OCR"
        parsed = parse_ocr_output(raw)
        self.assertEqual(len(parsed.blocks), 1)
        self.assertEqual(parsed.blocks[0].box, (10, 20, 300, 400))
        self.assertEqual(parsed.blocks[0].text, "Unlimited OCR")

    def test_parse_unlimited_ocr_2_blocks(self) -> None:
        from app.services.ocr_text import parse_ocr_output

        raw = (
            "<PAGE><BLOCK>header[122, 27, 324, 77]<FORK>Baidu 百度\n"
            "<BLOCK>title<LEVEL1>[357, 135, 642, 156]<FORK>Unlimited OCR Works\n"
            "<BLOCK>text[288, 162, 711, 181]<FORK>Welcome the Era\n"
            "<BLOCK>image[166, 602, 819, 800]<FORK>\n"
            "<BLOCK>image_caption[114, 814, 885, 895]<FORK>Figure 1 | R-SWA."
        )
        parsed = parse_ocr_output(raw, prompt_mode="layout")
        labels = [block.label for block in parsed.blocks]
        self.assertEqual(
            labels, ["header", "title", "text", "image", "image_caption"]
        )
        self.assertEqual(parsed.blocks[1].box, (357, 135, 642, 156))
        self.assertEqual(parsed.blocks[1].text, "Unlimited OCR Works")
        # The geometry-only figure block must survive so the overlay can draw it.
        self.assertEqual(parsed.blocks[3].label, "image")
        self.assertEqual(parsed.blocks[3].box, (166, 602, 819, 800))
        self.assertEqual(parsed.blocks[3].text, "")
        self.assertNotIn("<FORK>", parsed.clean)
        self.assertNotIn("<BLOCK>", parsed.clean)
        self.assertNotIn("<LEVEL1>", parsed.clean)

    def test_parse_keeps_geometry_only_image_block(self) -> None:
        from app.services.ocr_text import parse_ocr_output

        raw = (
            "text [113, 318, 885, 590]Body copy.\n"
            "image [168, 601, 825, 804]\n"
            "image_caption [113, 814, 885, 896]Figure 1 | Caption."
        )
        parsed = parse_ocr_output(raw, prompt_mode="layout")
        labels = [block.label for block in parsed.blocks]
        self.assertIn("image", labels)
        image = next(b for b in parsed.blocks if b.label == "image")
        self.assertEqual(image.box, (168, 601, 825, 804))
        self.assertEqual(image.text, "")

    def test_parse_empty_output_warns(self) -> None:
        from app.services.ocr_text import parse_ocr_output

        parsed = parse_ocr_output("   ")
        self.assertEqual(parsed.clean, "")
        self.assertTrue(parsed.warning)

    def test_repetition_warning(self) -> None:
        from app.services.ocr_text import detect_repetition

        loop = "lorem ipsum dolor sit amet " * 40
        self.assertTrue(detect_repetition(loop))
        self.assertIsNone(detect_repetition("A perfectly normal page of prose."))

    def test_split_page_output(self) -> None:
        from app.services.ocr_text import split_page_output

        parts = split_page_output("first<PAGE>second<PAGE>third")
        self.assertEqual(parts, ["first", "second", "third"])
        self.assertEqual(split_page_output("no markers"), ["no markers"])

    def test_version_parsing(self) -> None:
        from app.engine.llama_cpp import _parse_version

        self.assertEqual(
            _parse_version(
                "0.00.000.441 I srv llama_server: initializing ...\n"
                "version: 0.5.0 (build 11146, commit 7fe450e19)\n"
            ),
            "0.5.0 (build 11146, commit 7fe450e19)",
        )

    # --------------------------------------------------------------------- api
    def test_health_reports_stopped_engine(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        # The engine stays asleep in the selftest. When weights are present the
        # app reports "degraded" (ready weights, stopped engine); when they are
        # missing it reports "error". Both are valid here.
        self.assertIn(payload["status"], {"ok", "degraded", "error"})
        self.assertEqual(payload["engine"]["status"], "stopped")
        self.assertIn("version", payload)

    def test_settings_roundtrip(self) -> None:
        original = self.client.get("/api/settings").json()
        patched = self.client.put(
            "/api/settings", json={"default_dpi": 300}
        ).json()
        self.assertEqual(patched["default_dpi"], 300)
        self.client.post("/api/settings/reset")
        after = self.client.get("/api/settings").json()
        self.assertEqual(after["default_dpi"], 200)
        self.client.put("/api/settings", json={"default_dpi": original["default_dpi"]})

    def test_upload_errors_are_per_file(self) -> None:
        response = self.upload("notes.txt", b"plain text", "text/plain")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["uploads"], [])
        self.assertEqual(len(payload["errors"]), 1)
        self.assertEqual(payload["errors"][0]["code"], "unsupported_file")

    def test_upload_rejects_corrupt_and_empty_files(self) -> None:
        corrupt = self.upload("corrupt.pdf", b"%PDF-1.4 garbage", "application/pdf")
        self.assertEqual(corrupt.status_code, 200)
        self.assertEqual(corrupt.json()["errors"][0]["code"], "unsupported_file")

        empty = self.upload("empty.png", b"", "image/png")
        self.assertEqual(empty.json()["errors"][0]["code"], "unsupported_file")

    def test_upload_rejects_password_protected_pdf(self) -> None:
        data = self.pdf_bytes(2, password="secret")
        response = self.upload("encrypted.pdf", data, "application/pdf")
        self.assertEqual(response.status_code, 200)
        error = response.json()["errors"][0]
        self.assertEqual(error["code"], "pdf_password")
        self.assertTrue(error["hint"])

    def test_upload_enforces_page_limit(self) -> None:
        response = self.upload("big.pdf", self.pdf_bytes(120))
        error = response.json()["errors"][0]
        self.assertEqual(error["code"], "too_many_pages")

    def test_upload_accepts_png_and_reports_page_count(self) -> None:
        import fitz

        doc = fitz.open()
        page = doc.new_page(width=600, height=800)
        page.insert_text((30, 60), "PNG self test", fontsize=24)
        pix = page.get_pixmap(dpi=120)
        doc.close()
        response = self.upload("shot.png", pix.tobytes("png"), "image/png")
        payload = response.json()
        self.assertEqual(payload["errors"], [])
        self.assertEqual(len(payload["uploads"]), 1)
        upload = payload["uploads"][0]
        self.assertEqual(upload["kind"], "image")
        self.assertEqual(upload["page_count"], 1)
        self.assertIn("/files/uploads/", upload["pages"][0]["image_url"])

    def test_job_page_cap_and_batch_guard(self) -> None:
        upload = self.upload("fiftyone.pdf", self.pdf_bytes(51)).json()["uploads"][0]
        upload_id = upload["id"]

        too_many = self.client.post(
            "/api/jobs",
            json={
                "upload_ids": [upload_id],
                "options": {
                    "prompt": "document parsing.",
                    "dpi": 200,
                    "page_selection": {upload_id: "all"},
                },
            },
        )
        self.assertEqual(too_many.status_code, 400)
        self.assertEqual(too_many.json()["code"], "too_many_pages")

        batch = self.client.post(
            "/api/jobs",
            json={
                "upload_ids": [upload_id],
                "options": {
                    "prompt": "document parsing.",
                    "dpi": 200,
                    "batch_mode": True,
                    "page_selection": {upload_id: "1-40"},
                },
            },
        )
        self.assertEqual(batch.status_code, 400)
        self.assertEqual(batch.json()["code"], "batch_too_large")

        unknown = self.client.post(
            "/api/jobs",
            json={"upload_ids": ["up_missing"], "options": {}},
        )
        self.assertEqual(unknown.status_code, 404)

    def test_export_requires_known_job(self) -> None:
        response = self.client.get("/api/jobs/job_missing/export?format=md")
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(unittest.main())
