from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.engine.fake import GenerationResult
from tests.helpers import first_upload, make_job, wait_job


def test_auto_retry_truncated_pages_doubles_the_budget(client: TestClient) -> None:
    engine = client.app.state.fake_engine
    calls: list[int] = []
    original = engine.ocr

    async def first_truncated(**kwargs):
        calls.append(kwargs["max_tokens"])
        if len(calls) == 1:
            return GenerationResult(
                "title [10, 10, 200, 40]Partial page",
                finish_reason="length",
                prompt_tokens=10,
                completion_tokens=5,
                duration_ms=5,
            )
        return await original(**kwargs)

    engine.ocr = first_truncated  # type: ignore[method-assign]
    try:
        entry = first_upload(client, pages=1)
        created = make_job(
            client,
            [entry["id"]],
            auto_retry_truncated=True,
            max_tokens=1024,
        ).json()
        job = wait_job(client, created["id"])
    finally:
        engine.ocr = original  # type: ignore[method-assign]

    assert calls == [1024, 2048]
    assert job["status"] == "completed"
    page = job["pages"][0]
    assert "automatically retried" in (page["warning"] or "").lower()
    assert page["finish_reason"] == "stop"
    assert "Fake OCR page" in page["output_clean"]


def test_strip_repeated_margins_option_rewrites_page_blocks(client: TestClient) -> None:
    engine = client.app.state.fake_engine
    original = engine._page_text

    def with_header(image_path: str, index: int) -> str:
        stem = Path(image_path).stem
        return (
            "header [10, 10, 400, 30]ACME CONFIDENTIAL\n"
            f"text [10, 50, 400, 300]Body for {stem}\n"
        )

    engine._page_text = with_header  # type: ignore[method-assign]
    try:
        entry = first_upload(client, pages=3)
        created = make_job(client, [entry["id"]], strip_repeated_margins=True).json()
        job = wait_job(client, created["id"])
    finally:
        engine._page_text = original  # type: ignore[method-assign]

    assert job["status"] == "completed"
    for page in job["pages"]:
        assert page["blocks"][0]["label"] == "text"
        assert "ACME CONFIDENTIAL" not in page["output_clean"]


def test_queued_cancel_before_the_worker_starts_is_terminal(client: TestClient) -> None:
    entry = first_upload(client, pages=1)
    created = make_job(client, [entry["id"]]).json()
    canceled = client.post(f"/api/jobs/{created['id']}/cancel").json()
    assert canceled["status"] in {"queued", "running", "canceled"}
    final = wait_job(client, created["id"])
    assert final["status"] == "canceled"
    assert final["pages"][0]["status"] in {"skipped", "completed"}
