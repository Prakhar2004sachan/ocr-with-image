from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from .utils import iso_now

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    kind TEXT NOT NULL,
    page_count INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_pages (
    id TEXT PRIMARY KEY,
    upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    image_path TEXT,
    thumb_path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    UNIQUE (upload_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_upload_pages_upload ON upload_pages(upload_id);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    options TEXT NOT NULL,
    total_pages INTEGER NOT NULL,
    completed_pages INTEGER NOT NULL DEFAULT 0,
    failed_pages INTEGER NOT NULL DEFAULT 0,
    output_markdown TEXT,
    error TEXT,
    warning TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    duration_ms INTEGER,
    engine TEXT,
    model TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS job_uploads (
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (job_id, upload_id)
);

CREATE TABLE IF NOT EXISTS job_pages (
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    upload_id TEXT NOT NULL,
    upload_name TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    image_path TEXT,
    thumb_path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    status TEXT NOT NULL,
    output_raw TEXT,
    output_clean TEXT,
    blocks TEXT,
    error TEXT,
    warning TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    duration_ms INTEGER,
    finish_reason TEXT,
    PRIMARY KEY (job_id, position)
);
"""

JOB_FIELDS = {
    "status",
    "completed_pages",
    "failed_pages",
    "output_markdown",
    "error",
    "warning",
    "started_at",
    "finished_at",
    "duration_ms",
    "engine",
    "model",
    "cancel_requested",
}

PAGE_FIELDS = {
    "status",
    "image_path",
    "width",
    "height",
    "output_raw",
    "output_clean",
    "blocks",
    "error",
    "warning",
    "prompt_tokens",
    "completion_tokens",
    "duration_ms",
    "finish_reason",
}


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(path, check_same_thread=False, timeout=30)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ------------------------------------------------------------------ helpers
    def _execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._conn.execute(sql, tuple(params))
            self._conn.commit()
            return cur

    def _one(self, sql: str, params: Iterable[Any] = ()) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(sql, tuple(params)).fetchone()
        return dict(row) if row else None

    def _all(self, sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(sql, tuple(params)).fetchall()
        return [dict(row) for row in rows]

    # ------------------------------------------------------------------ uploads
    def create_upload(
        self,
        *,
        upload_id: str,
        original_name: str,
        stored_path: str,
        mime: str,
        size: int,
        kind: str,
        page_count: int,
        pages: list[dict[str, Any]],
    ) -> dict[str, Any]:
        now = iso_now()
        with self._lock:
            self._conn.execute(
                """INSERT INTO uploads
                   (id, original_name, stored_path, mime, size, kind, page_count, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (upload_id, original_name, stored_path, mime, size, kind, page_count, now),
            )
            for page in pages:
                self._conn.execute(
                    """INSERT INTO upload_pages
                       (id, upload_id, page_number, image_path, thumb_path, width, height)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        page["id"],
                        upload_id,
                        page["page_number"],
                        page.get("image_path"),
                        page["thumb_path"],
                        page.get("width"),
                        page.get("height"),
                    ),
                )
            self._conn.commit()
        upload = self.get_upload(upload_id)
        assert upload is not None
        return upload

    def get_upload(self, upload_id: str) -> dict[str, Any] | None:
        row = self._one("SELECT * FROM uploads WHERE id = ?", (upload_id,))
        if not row:
            return None
        pages = self._all(
            "SELECT * FROM upload_pages WHERE upload_id = ? ORDER BY page_number", (upload_id,)
        )
        row["pages"] = pages
        return row

    def update_upload_page(
        self, page_id: str, *, image_path: str | None, width: int | None, height: int | None
    ) -> None:
        self._execute(
            "UPDATE upload_pages SET image_path = ?, width = ?, height = ? WHERE id = ?",
            (image_path, width, height, page_id),
        )

    def list_uploads(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self._all("SELECT * FROM uploads ORDER BY created_at DESC LIMIT ?", (limit,))
        for row in rows:
            row["pages"] = self._all(
                "SELECT * FROM upload_pages WHERE upload_id = ? ORDER BY page_number",
                (row["id"],),
            )
        return rows

    def upload_is_used(self, upload_id: str) -> bool:
        row = self._one("SELECT COUNT(*) AS n FROM job_uploads WHERE upload_id = ?", (upload_id,))
        return bool(row and row["n"])

    def delete_upload(self, upload_id: str) -> None:
        self._execute("DELETE FROM uploads WHERE id = ?", (upload_id,))

    # ------------------------------------------------------------------ jobs
    def create_job(
        self,
        *,
        job_id: str,
        options: dict[str, Any],
        uploads: list[tuple[dict[str, Any], list[int]]],
        engine: str,
        model: str,
    ) -> dict[str, Any]:
        now = iso_now()
        total_pages = sum(len(pages) for _, pages in uploads)
        with self._lock:
            self._conn.execute(
                """INSERT INTO jobs
                   (id, status, options, total_pages, created_at, engine, model)
                   VALUES (?, 'queued', ?, ?, ?, ?, ?)""",
                (job_id, json.dumps(options), total_pages, now, engine, model),
            )
            position = 0
            for upload_index, (upload, pages) in enumerate(uploads):
                self._conn.execute(
                    "INSERT INTO job_uploads (job_id, upload_id, position) VALUES (?, ?, ?)",
                    (job_id, upload["id"], upload_index),
                )
                for page_number in pages:
                    source = next(
                        p for p in upload["pages"] if int(p["page_number"]) == int(page_number)
                    )
                    self._conn.execute(
                        """INSERT INTO job_pages
                           (job_id, position, upload_id, upload_name, page_number,
                            image_path, thumb_path, width, height, status)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')""",
                        (
                            job_id,
                            position,
                            upload["id"],
                            upload["original_name"],
                            page_number,
                            source.get("image_path"),
                            source["thumb_path"],
                            source.get("width"),
                            source.get("height"),
                        ),
                    )
                    position += 1
            self._conn.commit()
        job = self.get_job(job_id)
        assert job is not None
        return job

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        row = self._one("SELECT * FROM jobs WHERE id = ?", (job_id,))
        if not row:
            return None
        row["options"] = json.loads(row["options"])
        row["pages"] = self._all(
            "SELECT * FROM job_pages WHERE job_id = ? ORDER BY position", (job_id,)
        )
        for page in row["pages"]:
            if isinstance(page.get("blocks"), str):
                try:
                    page["blocks"] = json.loads(page["blocks"])
                except json.JSONDecodeError:
                    page["blocks"] = []
        row["uploads"] = self._all(
            """SELECT u.id, u.original_name, u.kind, u.page_count, u.size
               FROM uploads u JOIN job_uploads ju ON ju.upload_id = u.id
               WHERE ju.job_id = ? ORDER BY ju.position""",
            (job_id,),
        )
        row.pop("cancel_requested", None)
        row["queue_position"] = self.queue_position(job_id)
        return row

    def list_jobs(
        self, *, limit: int = 30, offset: int = 0, status: str | None = None, q: str | None = None
    ) -> tuple[list[dict[str, Any]], int]:
        where = []
        params: list[Any] = []
        if status and status != "all":
            where.append("j.status = ?")
            params.append(status)
        if q:
            where.append(
                "EXISTS (SELECT 1 FROM job_pages jp JOIN uploads u ON u.id = jp.upload_id "
                "WHERE jp.job_id = j.id AND u.original_name LIKE ?)"
            )
            params.append(f"%{q}%")
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        total_row = self._one(f"SELECT COUNT(*) AS n FROM jobs j {clause}", params)
        rows = self._all(
            f"SELECT j.id FROM jobs j {clause} ORDER BY j.created_at DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        )
        jobs = [job for row in rows if (job := self.get_job(row["id"]))]
        return jobs, int(total_row["n"] if total_row else 0)

    def update_job(self, job_id: str, **fields: Any) -> None:
        fields = {k: v for k, v in fields.items() if k in JOB_FIELDS}
        if not fields:
            return
        assignments = ", ".join(f"{key} = ?" for key in fields)
        self._execute(
            f"UPDATE jobs SET {assignments} WHERE id = ?", [*fields.values(), job_id]
        )

    def update_job_page(self, job_id: str, position: int, **fields: Any) -> None:
        fields = {k: v for k, v in fields.items() if k in PAGE_FIELDS}
        if "blocks" in fields and not isinstance(fields["blocks"], str):
            fields["blocks"] = json.dumps(fields["blocks"])
        if not fields:
            return
        assignments = ", ".join(f"{key} = ?" for key in fields)
        self._execute(
            f"UPDATE job_pages SET {assignments} WHERE job_id = ? AND position = ?",
            [*fields.values(), job_id, position],
        )

    def increment_job_pages(
        self, job_id: str, *, completed: int = 0, failed: int = 0
    ) -> dict[str, int]:
        """Atomically bump the job counters and return the new values."""
        self._execute(
            """UPDATE jobs
               SET completed_pages = completed_pages + ?,
                   failed_pages = failed_pages + ?
               WHERE id = ?""",
            (completed, failed, job_id),
        )
        row = self._one(
            "SELECT completed_pages, failed_pages FROM jobs WHERE id = ?", (job_id,)
        ) or {}
        return {
            "completed_pages": int(row.get("completed_pages") or 0),
            "failed_pages": int(row.get("failed_pages") or 0),
        }

    def skip_pending_pages(self, job_id: str, *, error: str) -> int:
        cur = self._execute(
            """UPDATE job_pages SET status = 'skipped', error = ?
               WHERE job_id = ? AND status = 'pending'""",
            (error, job_id),
        )
        return cur.rowcount

    def set_job_page_image(
        self, job_id: str, position: int, *, image_path: str, width: int, height: int
    ) -> None:
        self._execute(
            """UPDATE job_pages SET image_path = ?, width = ?, height = ?
               WHERE job_id = ? AND position = ?""",
            (image_path, width, height, job_id, position),
        )

    def cancel_requested(self, job_id: str) -> bool:
        row = self._one("SELECT cancel_requested FROM jobs WHERE id = ?", (job_id,))
        return bool(row and row["cancel_requested"])

    def request_cancel(self, job_id: str) -> None:
        """Ask the worker to stop, without declaring the job terminal.

        The worker owns the final status: it lets the page that is currently
        decoding settle (or marks it skipped) before publishing ``canceled``.
        Declaring the job finished here made the UI report a terminal job while
        a page was still marked *running* and the worker was still writing.
        """
        self._execute(
            "UPDATE jobs SET cancel_requested = 1 "
            "WHERE id = ? AND status IN ('queued','preparing','running')",
            (job_id,),
        )
        self._execute(
            "UPDATE job_pages SET status = 'skipped', error = 'Canceled' "
            "WHERE job_id = ? AND status = 'pending'",
            (job_id,),
        )

    def delete_job(self, job_id: str) -> list[str]:
        uploads = self._all("SELECT upload_id FROM job_uploads WHERE job_id = ?", (job_id,))
        self._execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        orphaned: list[str] = []
        for row in uploads:
            upload_id = row["upload_id"]
            if not self.upload_is_used(upload_id):
                orphaned.append(upload_id)
                self.delete_upload(upload_id)
        return orphaned

    def queue_position(self, job_id: str) -> int | None:
        row = self._one("SELECT status, created_at FROM jobs WHERE id = ?", (job_id,))
        if not row or row["status"] != "queued":
            return None
        ahead = self._one(
            "SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued' AND created_at <= ?",
            (row["created_at"],),
        )
        return int(ahead["n"]) if ahead else None

    def queued_job_ids(self) -> list[str]:
        rows = self._all(
            "SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC"
        )
        return [row["id"] for row in rows]

    def active_job_id(self) -> str | None:
        row = self._one(
            "SELECT id FROM jobs WHERE status IN ('preparing','running') ORDER BY started_at LIMIT 1"
        )
        return row["id"] if row else None

    def queued_count(self) -> int:
        row = self._one("SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'")
        return int(row["n"]) if row else 0

    def recover_interrupted_jobs(self) -> int:
        now = iso_now()
        cur = self._execute(
            """UPDATE jobs SET status = 'failed', finished_at = ?,
                      error = 'The backend restarted while this job was running. Partial results were preserved.'
               WHERE status IN ('preparing','running')""",
            (now,),
        )
        self._execute(
            """UPDATE job_pages SET status = 'failed',
                      error = 'Interrupted by a backend restart.'
               WHERE status = 'running'"""
        )
        return cur.rowcount

    def clear_history(self) -> list[str]:
        jobs = self._all("SELECT id FROM jobs")
        uploads: list[str] = []
        for job in jobs:
            uploads.extend(self.delete_job(job["id"]))
        return uploads

    def counts(self) -> dict[str, int]:
        row = self._one(
            """SELECT
                 SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
                 SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                 COUNT(*) AS total
               FROM jobs"""
        ) or {}
        return {k: int(v or 0) for k, v in row.items()}
