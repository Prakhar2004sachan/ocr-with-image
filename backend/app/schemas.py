from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

JobStatus = Literal[
    "queued",
    "preparing",
    "running",
    "completed",
    "partial",
    "failed",
    "canceled",
]
PageStatus = Literal["pending", "running", "completed", "failed", "skipped"]
PromptMode = Literal["layout", "plain", "custom"]


class UploadPage(BaseModel):
    id: str
    page_number: int
    thumb_url: str
    image_url: str | None = None
    width: int | None = None
    height: int | None = None


class Upload(BaseModel):
    id: str
    original_name: str
    mime: str
    size: int
    kind: Literal["pdf", "image"]
    page_count: int
    created_at: str
    pages: list[UploadPage] = Field(default_factory=list)


class JobOptions(BaseModel):
    prompt: str = Field(default="document parsing.", max_length=4000)
    prompt_mode: PromptMode = "layout"
    dpi: int = Field(default=200, ge=120, le=400)
    max_tokens: int = Field(default=8192, ge=512, le=32768)
    temperature: float = Field(default=0.0, ge=0.0, le=1.5)
    top_p: float = Field(default=1.0, gt=0.0, le=1.0)
    seed: int = -1
    batch_mode: bool = False
    strip_repeated_margins: bool = False
    auto_retry_truncated: bool = False
    page_selection: dict[str, str] = Field(default_factory=dict)

    @field_validator("prompt")
    @classmethod
    def prompt_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("The prompt cannot be empty.")
        return value


class CreateJobRequest(BaseModel):
    upload_ids: list[str] = Field(min_length=1, max_length=20)
    options: JobOptions = Field(default_factory=JobOptions)


class UploadError(BaseModel):
    filename: str
    message: str
    code: str = "upload_failed"
    hint: str | None = None


class UploadBatchResponse(BaseModel):
    uploads: list[Upload] = Field(default_factory=list)
    errors: list[UploadError] = Field(default_factory=list)


class DeleteResponse(BaseModel):
    deleted: bool = True
    message: str | None = None


class OcrBlock(BaseModel):
    label: str
    box: tuple[int, int, int, int] | None = None
    text: str


class JobPage(BaseModel):
    position: int
    upload_id: str
    upload_name: str
    page_number: int
    status: PageStatus
    image_url: str | None = None
    thumb_url: str
    width: int | None = None
    height: int | None = None
    output_clean: str | None = None
    output_raw: str | None = None
    blocks: list[OcrBlock] = Field(default_factory=list)
    error: str | None = None
    warning: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    duration_ms: int | None = None
    finish_reason: str | None = None


class UploadSummary(BaseModel):
    id: str
    original_name: str
    kind: str
    page_count: int
    size: int


class Job(BaseModel):
    id: str
    status: JobStatus
    options: JobOptions
    total_pages: int
    completed_pages: int
    failed_pages: int
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    duration_ms: int | None = None
    error: str | None = None
    warning: str | None = None
    engine: str | None = None
    model: str | None = None
    uploads: list[UploadSummary] = Field(default_factory=list)
    pages: list[JobPage] = Field(default_factory=list)
    queue_position: int | None = None

    @property
    def output_combined(self) -> str:
        parts: list[str] = []
        for page in self.pages:
            if page.output_clean:
                parts.append(f"## {page.upload_name} — page {page.page_number}\n\n{page.output_clean}")
        return "\n\n---\n\n".join(parts)


class JobList(BaseModel):
    items: list[Job]
    total: int
    limit: int
    offset: int


class ModelFile(BaseModel):
    name: str
    path: str
    exists: bool
    size: int | None = None
    expected: str | None = None


EngineKind = Literal["llama_cpp", "transformers", "fake"]


class ModelStatus(BaseModel):
    ready: bool
    model: ModelFile | None = None
    mmproj: ModelFile | None = None
    message: str
    download_command: str | None = None
    # Extra detail for the transformers backend (original Safetensors weights).
    engine: EngineKind | None = None
    directory: str | None = None
    device: str | None = None
    shards: list[str] = Field(default_factory=list)


class EngineStatus(BaseModel):
    status: Literal["stopped", "starting", "ready", "error"]
    port: int | None = None
    pid: int | None = None
    model: str | None = None
    backend: str = "llama.cpp"
    started_at: str | None = None
    last_error: str | None = None
    log_tail: list[str] = Field(default_factory=list)
    engine_type: EngineKind = "llama_cpp"
    device: str | None = None
    ready: bool | None = None


class SystemInfo(BaseModel):
    platform: str
    platform_label: str = ""
    machine: str
    python: str
    cpu_count: int
    total_ram: int
    available_ram: int
    disk_total: int
    disk_free: int
    llama_server: str | None = None
    llama_version: str | None = None
    torch_version: str | None = None
    accelerator: str | None = None
    engine_label: str | None = None


class Health(BaseModel):
    status: Literal["ok", "degraded", "error"]
    version: str
    uptime_seconds: float
    engine: EngineStatus
    model: ModelStatus
    system: SystemInfo
    active_job: str | None = None
    queued_jobs: int = 0


class AppSettings(BaseModel):
    default_prompt: str = "document parsing."
    default_prompt_mode: PromptMode = "layout"
    default_dpi: int = Field(default=200, ge=120, le=400)
    default_max_tokens: int = Field(default=8192, ge=512, le=32768)
    auto_start_engine: bool = True
    keep_history: bool = True
    # "auto" picks Unlimited-OCR-2 when its original weights are present and
    # falls back to the llama.cpp GGUF build otherwise.
    active_engine: Literal["auto", "llama_cpp", "transformers"] = "auto"
    uocr2_device: Literal["auto", "mps", "cuda", "cpu"] = "auto"


class SettingsUpdate(BaseModel):
    default_prompt: str | None = Field(default=None, max_length=4000)
    default_prompt_mode: PromptMode | None = None
    default_dpi: int | None = Field(default=None, ge=120, le=400)
    default_max_tokens: int | None = Field(default=None, ge=512, le=32768)
    auto_start_engine: bool | None = None
    keep_history: bool | None = None
    active_engine: Literal["auto", "llama_cpp", "transformers"] | None = None
    uocr2_device: Literal["auto", "mps", "cuda", "cpu"] | None = None


class Diagnostics(BaseModel):
    health: Health
    data_dir: str
    models_dir: str
    db_path: str
    log_path: str
    engine_command: list[str] | None = None
    engine_log_tail: list[str] = Field(default_factory=list)
    settings: AppSettings
    active_engine: EngineKind = "llama_cpp"
    engines: dict[str, Any] = Field(default_factory=dict)


class ErrorBody(BaseModel):
    detail: str
    code: str = "error"
    hint: str | None = None
