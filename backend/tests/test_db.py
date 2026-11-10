from __future__ import annotations

import json
from pathlib import Path

from app.db import Database
from app.services.jobs import public_job
from app.utils import new_id


def build_database(tmp_path: Path) -> Database:
    return Database(tmp_path / "app.db")


def add_upload(db: Database, *, pages: int = 2, name: str = "doc.pdf") -> dict:
    upload_id = new_id("up")
    page_rows = [
        {
            "id": new_id("pg"),
            "page_number": index + 1,
            "image_path": f"uploads/{upload_id}/page-{index + 1}.png",
            "thumb_path": f"uploads/{upload_id}/thumb-{index + 1}.jpg",
            "width": 600,
            "height": 800,
        }
        for index in range(pages)
    ]
    return db.create_upload(
        upload_id=upload_id,
        original_name=name,
        stored_path=f"uploads/{upload_id}/source.pdf",
        mime="application/pdf",
        size=1234,
        kind="pdf",
        page_count=pages,
        pages=page_rows,
    )


def test_upload_roundtrip_and_delete_cascade(tmp_path: Path) -> None:
    db = build_database(tmp_path)
    upload = add_upload(db)
    assert len(upload["pages"]) == 2
    assert db.get_upload(upload["id"])["original_name"] == "doc.pdf"
    db.update_upload_page(upload["pages"][0]["id"], image_path="x.png", width=1, height=2)
    assert db.get_upload(upload["id"])["pages"][0]["image_path"] == "x.png"
    db.delete_upload(upload["id"])
    assert db.get_upload(upload["id"]) is None
    db.close()


def test_job_lifecycle_counters_and_queue(tmp_path: Path) -> None:
    db = build_database(tmp_path)
    upload = add_upload(db)
    options = {"prompt": "document parsing.", "page_selection": {upload["id"]: "all"}}
    first = db.create_job(
        job_id="job_1", options=options, uploads=[(upload, [1, 2])], engine="fake", model="fake"
    )
    second = db.create_job(
        job_id="job_2", options=options, uploads=[(upload, [1])], engine="fake", model="fake"
    )
    assert first["status"] == "queued"
    assert first["total_pages"] == 2
    assert first["queue_position"] == 1
    assert second["queue_position"] == 2

    db.update_job("job_1", status="running")
    assert db.queue_position("job_1") is None
    counters = db.increment_job_pages("job_1", completed=1)
    assert counters == {"completed_pages": 1, "failed_pages": 0}
    counters = db.increment_job_pages("job_1", failed=1)
    assert counters == {"completed_pages": 1, "failed_pages": 1}

    db.update_job_page("job_1", 0, status="completed", output_clean="hello", blocks=[{"label": "text"}])
    page = db.get_job("job_1")["pages"][0]
    assert page["output_clean"] == "hello"
    assert page["blocks"] == [{"label": "text"}]

    db.close()


def test_cancel_marks_pending_pages_and_terminal_status(tmp_path: Path) -> None:
    db = build_database(tmp_path)
    upload = add_upload(db, pages=3)
    db.create_job(
        job_id="job_1",
        options={},
        uploads=[(upload, [1, 2, 3])],
        engine="fake",
        model="fake",
    )
    db.update_job_page("job_1", 0, status="running")
    db.request_cancel("job_1")
    job = db.get_job("job_1")
    # The worker owns the terminal status; request_cancel only flags the job.
    assert job["status"] == "queued"
    assert job["pages"][0]["status"] == "running"
    assert job["pages"][1]["status"] == "skipped"
    assert job["pages"][2]["status"] == "skipped"
    assert db.cancel_requested("job_1") is True
    db.close()


def test_recover_interrupted_jobs(tmp_path: Path) -> None:
    db = build_database(tmp_path)
    upload = add_upload(db, pages=1)
    db.create_job(job_id="job_1", options={}, uploads=[(upload, [1])], engine="fake", model="fake")
    db.update_job("job_1", status="running")
    db.update_job_page("job_1", 0, status="running")
    assert db.recover_interrupted_jobs() == 1
    job = db.get_job("job_1")
    assert job["status"] == "failed"
    assert job["pages"][0]["status"] == "failed"
    assert "restart" in job["error"]
    db.close()


def test_list_jobs_search_status_and_pagination(tmp_path: Path) -> None:
    db = build_database(tmp_path)
    contract = add_upload(db, name="contract.pdf")
    invoice = add_upload(db, name="invoice.pdf")
    db.create_job(
        job_id="job_1", options={}, uploads=[(contract, [1])], engine="fake", model="fake"
    )
    db.create_job(
        job_id="job_2", options={}, uploads=[(invoice, [1])], engine="fake", model="fake"
    )
    db.update_job("job_2", status="completed")

    jobs, total = db.list_jobs(limit=10)
    assert total == 2
    assert len(jobs) == 2

    jobs, total = db.list_jobs(status="completed")
    assert total == 1 and jobs[0]["id"] == "job_2"

    jobs, total = db.list_jobs(q="contract")
    assert total == 1 and jobs[0]["id"] == "job_1"

    jobs, total = db.list_jobs(q="nothing-matches")
    assert total == 0 and jobs == []

    jobs, total = db.list_jobs(limit=1, offset=0)
    assert len(jobs) == 1 and total == 2
    db.close()


def test_delete_job_returns_only_orphaned_uploads(tmp_path: Path) -> None:
    db = build_database(tmp_path)
    shared = add_upload(db)
    only_one = add_upload(db)
    db.create_job(job_id="job_1", options={}, uploads=[(shared, [1]), (only_one, [1])], engine="f", model="f")
    db.create_job(job_id="job_2", options={}, uploads=[(shared, [1])], engine="f", model="f")
    removed = db.delete_job("job_1")
    assert removed == [only_one["id"]]
    assert db.get_upload(shared["id"]) is not None
    assert db.get_upload(only_one["id"]) is None
    db.delete_job("job_2")
    assert db.get_upload(shared["id"]) is None
    db.close()


def test_clear_history_returns_orphaned_uploads(tmp_path: Path) -> None:
    db = build_database(tmp_path)
    upload = add_upload(db)
    db.create_job(job_id="job_1", options={}, uploads=[(upload, [1])], engine="f", model="f")
    removed = db.clear_history()
    assert removed == [upload["id"]]
    assert db.counts()["total"] == 0
    db.close()


def test_public_job_serialisation_matches_schema_shape(tmp_path: Path) -> None:
    from app.config import settings as default_settings

    db = build_database(tmp_path)
    upload = add_upload(db)
    job = db.create_job(job_id="job_1", options={"prompt": "x"}, uploads=[(upload, [1])], engine="f", model="f")
    payload = public_job(job, default_settings)
    assert payload["id"] == "job_1"
    assert payload["pages"][0]["thumb_url"].startswith("/files/uploads/")
    assert payload["uploads"][0]["original_name"] == "doc.pdf"
    json.dumps(payload)  # must be JSON serialisable for SSE
    db.close()
