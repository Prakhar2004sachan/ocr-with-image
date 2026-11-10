from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.helpers import (
    first_upload,
    make_job,
    make_settings,
    pdf_bytes,
    png_bytes,
    upload,
    wait_job,
)


# --------------------------------------------------------------------- health
def test_health_reports_fake_engine_and_platform(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["engine"]["status"] == "ready"
    assert payload["engine"]["engine_type"] == "fake"
    assert payload["model"]["ready"] is True
    assert payload["model"]["engine"] == "fake"
    assert payload["system"]["platform_label"]
    assert payload["system"]["accelerator"]
    assert payload["system"]["cpu_count"] > 0
    assert payload["uptime_seconds"] >= 0


def test_models_and_diagnostics_follow_the_active_engine(client: TestClient) -> None:
    models = client.get("/api/system/models").json()
    health = client.get("/api/health").json()
    assert models["engine"] == health["model"]["engine"] == "fake"
    assert models["ready"] is True

    diagnostics = client.get("/api/system/diagnostics").json()
    assert diagnostics["active_engine"] == "fake"
    assert diagnostics["engines"]["active"] == "fake"
    assert diagnostics["engines"]["platform"]["fake_engine"] is True
    assert diagnostics["db_path"].endswith("app.db")
    assert diagnostics["log_path"].replace("\\", "/").endswith("fake-engine.log")

    engines = client.get("/api/system/engines").json()
    assert engines["active"] == "fake"
    assert "llama_cpp" in engines and "transformers" in engines


def test_logs_endpoint_returns_plain_text(client: TestClient) -> None:
    response = client.get("/api/system/logs?target=engine&lines=20")
    assert response.status_code == 200
    assert "text/plain" in response.headers["content-type"]
    assert "fake-engine" in response.text or "No engine log" in response.text
    invalid = client.get("/api/system/logs?target=nope")
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "validation_error"


# ------------------------------------------------------------------- settings
def test_settings_roundtrip_and_reset(client: TestClient) -> None:
    original = client.get("/api/settings").json()
    patched = client.put(
        "/api/settings",
        json={"default_dpi": 320, "default_prompt": "read tables.", "default_prompt_mode": "custom"},
    )
    assert patched.status_code == 200
    assert patched.json()["default_dpi"] == 320
    assert patched.json()["default_prompt"] == "read tables."
    assert client.get("/api/settings").json()["default_dpi"] == 320
    reset = client.post("/api/settings/reset")
    assert reset.status_code == 200
    assert reset.json()["default_dpi"] == original["default_dpi"]
    assert reset.json()["default_prompt"] == original["default_prompt"]


@pytest.mark.parametrize(
    "body",
    [
        {"default_dpi": 100},
        {"default_dpi": 900},
        {"default_max_tokens": 100},
        {"default_prompt_mode": "auto"},
        {"uocr2_device": "tpu"},
        {"active_engine": "bogus"},
    ],
)
def test_settings_validation_uses_stable_envelope(client: TestClient, body: dict) -> None:
    response = client.put("/api/settings", json=body)
    assert response.status_code == 422
    payload = response.json()
    assert payload["code"] == "validation_error"
    assert isinstance(payload["detail"], str)


def test_settings_can_change_engine_preference_without_breaking_fake_engine(
    client: TestClient,
) -> None:
    # Regression: the old handler read `request.app.state` as if it were the
    # FastAPI app and crashed with a State AttributeError.
    response = client.put(
        "/api/settings",
        json={"active_engine": "llama_cpp", "uocr2_device": "cuda"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["active_engine"] == "llama_cpp"
    # The deterministic engine remains active for the test run.
    assert client.get("/api/system/engines").json()["active"] == "fake"


# -------------------------------------------------------------------- uploads
def test_upload_png_pdf_and_per_file_errors(client: TestClient) -> None:
    payload = upload(client, "shot.png", png_bytes(), "image/png")
    assert payload["errors"] == []
    assert payload["uploads"][0]["kind"] == "image"
    assert payload["uploads"][0]["page_count"] == 1
    assert payload["uploads"][0]["pages"][0]["image_url"].startswith("/files/uploads/")

    pdf = upload(client, "report.pdf", pdf_bytes(3), "application/pdf")
    assert pdf["uploads"][0]["page_count"] == 3
    assert len(pdf["uploads"][0]["pages"]) == 3

    bad = upload(client, "notes.txt", b"plain", "text/plain")
    assert bad["uploads"] == []
    assert bad["errors"][0]["code"] == "unsupported_file"


def test_upload_mixed_batch_reports_successes_and_failures(client: TestClient) -> None:
    response = client.post(
        "/api/uploads",
        files=[
            ("files", ("good.png", png_bytes(), "image/png")),
            ("files", ("bad.txt", b"hello", "text/plain")),
        ],
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["uploads"]) == 1
    assert len(payload["errors"]) == 1
    assert payload["errors"][0]["filename"] == "bad.txt"


def test_upload_enforces_file_count(client: TestClient) -> None:
    files = [
        ("files", (f"page-{index}.png", png_bytes(20, 20), "image/png"))
        for index in range(21)
    ]
    response = client.post("/api/uploads", files=files)
    assert response.status_code == 400
    assert response.json()["code"] == "too_many_files"


def test_upload_rejects_encrypted_corrupt_empty_and_too_many_pages(client: TestClient) -> None:
    encrypted = upload(client, "locked.pdf", pdf_bytes(1, password="x"), "application/pdf")
    assert encrypted["errors"][0]["code"] == "pdf_password"
    corrupt = upload(client, "bad.pdf", b"%PDF-1.4 nope", "application/pdf")
    assert corrupt["errors"][0]["code"] == "unsupported_file"
    empty = upload(client, "empty.png", b"", "image/png")
    assert empty["errors"][0]["code"] == "unsupported_file"
    huge = upload(client, "big.pdf", pdf_bytes(120), "application/pdf")
    assert huge["errors"][0]["code"] == "too_many_pages"


def test_upload_get_delete_and_used_guard(client: TestClient) -> None:
    entry = upload(client, "shot.png", png_bytes(), "image/png")["uploads"][0]
    got = client.get(f"/api/uploads/{entry['id']}")
    assert got.status_code == 200
    assert got.json()["original_name"] == "shot.png"
    assert client.get("/api/uploads/up_missing").status_code == 404

    job_response = make_job(client, [entry["id"]])
    assert job_response.status_code == 201
    used = client.delete(f"/api/uploads/{entry['id']}")
    assert used.status_code == 409
    assert used.json()["code"] == "conflict"

    wait_job(client, job_response.json()["id"])
    client.delete(f"/api/jobs/{job_response.json()['id']}")
    assert client.delete(f"/api/uploads/{entry['id']}").status_code == 200


def test_upload_urls_are_posix_even_for_windows_paths(client: TestClient) -> None:
    db = client.app.state.db
    upload_id = "up_windows_paths"
    db.create_upload(
        upload_id=upload_id,
        original_name="scan.pdf",
        stored_path=f"uploads\\{upload_id}\\source.pdf",
        mime="application/pdf",
        size=10,
        kind="pdf",
        page_count=1,
        pages=[
            {
                "id": "pg_windows",
                "page_number": 1,
                "image_path": f"uploads\\{upload_id}\\page-1.png",
                "thumb_path": f"uploads\\{upload_id}\\thumb-1.jpg",
                "width": 10,
                "height": 20,
            }
        ],
    )
    upload = client.get(f"/api/uploads/{upload_id}").json()
    assert upload["pages"][0]["thumb_url"] == f"/files/uploads/{upload_id}/thumb-1.jpg"
    assert upload["pages"][0]["image_url"] == f"/files/uploads/{upload_id}/page-1.png"
    assert "\\" not in upload["pages"][0]["thumb_url"]


def test_uploaded_page_is_served_with_long_cache_headers(client: TestClient) -> None:
    entry = upload(client, "shot.png", png_bytes(), "image/png")["uploads"][0]
    image = client.get(entry["pages"][0]["image_url"])
    assert image.status_code == 200
    assert image.headers["content-type"].startswith("image/png")
    assert "immutable" in image.headers["cache-control"]
    assert image.headers["x-content-type-options"] == "nosniff"


# ----------------------------------------------------------------------- jobs
def test_job_lifecycle_stream_export_and_delete(client: TestClient) -> None:
    entry = first_upload(client, pages=2)
    response = make_job(client, [entry["id"]])
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["status"] == "queued"
    assert created["total_pages"] == 2

    final = wait_job(client, created["id"])
    assert final["status"] == "completed"
    assert final["completed_pages"] == 2
    assert final["failed_pages"] == 0
    assert final["engine"] and final["model"]
    assert final["pages"][0]["status"] == "completed"
    assert "Fake OCR page" in final["pages"][0]["output_clean"]
    assert final["pages"][0]["blocks"]
    assert final["pages"][0]["image_url"].startswith("/files/uploads/")
    labels = [block["label"] for block in final["pages"][0]["blocks"]]
    assert "image" in labels and "image_caption" in labels

    # A finished job streams a snapshot followed by job_done.
    stream = client.get(f"/api/jobs/{created['id']}/events")
    assert stream.status_code == 200
    events = [
        json.loads(line[len("data: ") :])
        for line in stream.text.splitlines()
        if line.startswith("data: ")
    ]
    assert events[0]["type"] == "snapshot"
    assert events[-1]["type"] == "job_done"
    assert events[-1]["job"]["status"] == "completed"

    for fmt, marker in (("md", "##"), ("txt", "page 1"), ("json", '"pages"')):
        export = client.get(f"/api/jobs/{created['id']}/export?format={fmt}")
        assert export.status_code == 200
        assert marker in export.text
        assert "attachment" in export.headers["content-disposition"]
        assert export.headers["cache-control"] == "no-store"
        if fmt == "md":
            assert "![image](data:image/png;base64," in export.text
            assert "image_caption" not in export.text.split("![image]")[0]
        if fmt == "txt":
            assert "[Figure:" in export.text
        if fmt == "json":
            payload = json.loads(export.text)
            figures = payload["pages"][0]["figures"]
            assert figures and figures[0]["data_url"].startswith("data:image/png;base64,")

    page_export = client.get(f"/api/jobs/{created['id']}/export?format=md&page=0")
    assert page_export.status_code == 200
    assert "##" in page_export.text
    assert "data:image/png;base64," in page_export.text
    output_dir = client.app.state.settings.outputs_dir / created["id"]
    assert any(output_dir.glob("*.png"))

    bundle = client.get(f"/api/jobs/{created['id']}/export?format=zip")
    assert bundle.status_code == 200
    assert bundle.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
        names = archive.namelist()
        markdown_name = next(name for name in names if name.endswith(".md"))
        images = [name for name in names if name.startswith("images/")]
        assert images
        bundled_markdown = archive.read(markdown_name).decode("utf-8")
        assert "![image](images/" in bundled_markdown
        assert "data:image/png;base64," not in bundled_markdown
    bad_page = client.get(f"/api/jobs/{created['id']}/export?format=md&page=99")
    assert bad_page.status_code == 400
    assert bad_page.json()["code"] == "invalid_page"

    deleted = client.delete(f"/api/jobs/{created['id']}")
    assert deleted.status_code == 200
    assert not output_dir.exists()
    assert client.get(f"/api/jobs/{created['id']}").status_code == 404
    assert client.get(f"/api/jobs/{created['id']}/export").status_code == 404


def test_job_page_selection_and_prompt_validation(client: TestClient) -> None:
    entry = first_upload(client, pages=4)
    selected = make_job(client, [entry["id"]], selection={entry["id"]: "2-3"})
    assert selected.status_code == 201
    job = wait_job(client, selected.json()["id"])
    assert [page["page_number"] for page in job["pages"]] == [2, 3]

    bad_range = make_job(client, [entry["id"]], selection={entry["id"]: "9-12"})
    assert bad_range.status_code == 400
    assert bad_range.json()["code"] == "invalid_page_selection"

    blank_prompt = client.post(
        "/api/jobs",
        json={
            "upload_ids": [entry["id"]],
            "options": {"prompt": "   ", "page_selection": {entry["id"]: "1"}},
        },
    )
    assert blank_prompt.status_code == 422
    assert blank_prompt.json()["code"] == "validation_error"


def test_job_caps_batch_guard_and_missing_upload(client: TestClient) -> None:
    entry = first_upload(client, pages=51, name="fiftyone.pdf")
    too_many = make_job(client, [entry["id"]])
    assert too_many.status_code == 400
    assert too_many.json()["code"] == "too_many_pages"

    batch = make_job(client, [entry["id"]], batch_mode=True, selection={entry["id"]: "1-40"})
    assert batch.status_code == 400
    assert batch.json()["code"] == "batch_too_large"

    missing = make_job(client, ["up_missing"])
    assert missing.status_code == 404
    assert missing.json()["code"] == "upload_missing"

    empty = client.post("/api/jobs", json={"upload_ids": [], "options": {}})
    assert empty.status_code == 422


def test_batch_mode_assigns_one_page_per_marker(client: TestClient) -> None:
    entry = first_upload(client, pages=2)
    created = make_job(client, [entry["id"]], batch_mode=True)
    assert created.status_code == 201, created.text
    job = wait_job(client, created.json()["id"])
    assert job["completed_pages"] == 2
    assert [page["status"] for page in job["pages"]] == ["completed", "completed"]
    assert "Fake OCR page 1" in job["pages"][0]["output_clean"]
    assert "Fake OCR page 2" in job["pages"][1]["output_clean"]


def test_cancel_job_keeps_settled_pages_and_skips_the_rest(tmp_path: Path) -> None:
    config = make_settings(tmp_path, fake_engine_delay=0.05)
    app = create_app(config, serve_frontend=False)
    with TestClient(app) as client:
        entry = first_upload(client, pages=20)
        created = make_job(client, [entry["id"]]).json()
        cancel = client.post(f"/api/jobs/{created['id']}/cancel")
        assert cancel.status_code == 200
        final = wait_job(client, created["id"])
        assert final["status"] == "canceled"
        assert all(
            page["status"] in {"completed", "skipped", "failed"} for page in final["pages"]
        )
        assert any(page["status"] == "skipped" for page in final["pages"])
        # Canceling again is idempotent.
        assert client.post(f"/api/jobs/{created['id']}/cancel").status_code == 200
        assert client.delete(f"/api/jobs/{created['id']}").status_code == 200


def test_rerun_duplicates_options_and_sources(client: TestClient) -> None:
    entry = first_upload(client, pages=1)
    created = make_job(client, [entry["id"]], temperature=0.2, max_tokens=1024).json()
    wait_job(client, created["id"])
    rerun = client.post(f"/api/jobs/{created['id']}/rerun")
    assert rerun.status_code == 201
    duplicate = rerun.json()
    assert duplicate["id"] != created["id"]
    assert duplicate["options"]["temperature"] == 0.2
    assert duplicate["options"]["max_tokens"] == 1024
    wait_job(client, duplicate["id"])


def test_history_search_filter_and_pagination(client: TestClient) -> None:
    contract = first_upload(client, pages=1, name="contract.pdf")
    invoice = first_upload(client, pages=1, name="invoice.pdf")
    first = make_job(client, [contract["id"]]).json()
    second = make_job(client, [invoice["id"]]).json()
    wait_job(client, first["id"])
    wait_job(client, second["id"])

    everything = client.get("/api/jobs?limit=10").json()
    assert everything["total"] == 2
    found = client.get("/api/jobs?q=contract").json()
    assert found["total"] == 1
    assert found["items"][0]["id"] == first["id"]
    completed = client.get("/api/jobs?status=completed").json()
    assert completed["total"] == 2
    queued = client.get("/api/jobs?status=queued").json()
    assert queued["total"] == 0
    page = client.get("/api/jobs?limit=1&offset=1").json()
    assert page["total"] == 2 and len(page["items"]) == 1


def test_clear_history_removes_jobs_and_uploads(client: TestClient, config) -> None:
    entry = first_upload(client, pages=1)
    job = make_job(client, [entry["id"]]).json()
    wait_job(client, job["id"])
    response = client.post("/api/system/clear-history")
    assert response.status_code == 200
    assert client.get("/api/jobs").json()["total"] == 0
    assert client.get(f"/api/uploads/{entry['id']}").status_code == 404
    assert not (config.uploads_dir / entry["id"]).exists()


def test_missing_job_endpoints_return_stable_envelopes(client: TestClient) -> None:
    for method, path in (
        ("get", "/api/jobs/job_missing"),
        ("post", "/api/jobs/job_missing/cancel"),
        ("post", "/api/jobs/job_missing/rerun"),
        ("get", "/api/jobs/job_missing/events"),
        ("get", "/api/jobs/job_missing/export"),
    ):
        response = getattr(client, method)(path)
        assert response.status_code == 404, (method, path, response.text)
        assert response.json()["code"] == "job_missing"
    # DELETE is deliberately idempotent for a job that is already gone.
    assert client.delete("/api/jobs/job_missing").status_code == 200


# --------------------------------------------------------- missing-engine app
def test_missing_engine_reports_actionable_errors(tmp_path: Path) -> None:
    config = make_settings(tmp_path, fake_engine=False)
    app = create_app(config, serve_frontend=False)
    with TestClient(app) as client:
        health = client.get("/api/health").json()
        assert health["status"] == "error"
        assert health["model"]["ready"] is False
        assert health["engine"]["status"] in {"error", "stopped"}

        start = client.post("/api/system/engine/start")
        assert start.status_code == 503
        assert start.json()["code"] in {"engine_unavailable", "model_missing"}
        assert start.json()["hint"]

        assert client.post("/api/system/engine/stop").status_code == 200

        entry = first_upload(client, pages=2)
        job = make_job(client, [entry["id"]]).json()
        final = wait_job(client, job["id"])
        assert final["status"] == "failed"
        assert final["error"]
        assert final["pages"][0]["status"] == "failed"
        assert final["pages"][1]["status"] == "skipped"
