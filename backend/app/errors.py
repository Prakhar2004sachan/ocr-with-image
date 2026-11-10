from __future__ import annotations


class AppError(Exception):
    """An error with a stable code and a user-facing hint."""

    status_code = 400
    code = "bad_request"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        hint: str | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if hint:
            self.hint = hint
        else:
            self.hint = getattr(self, "hint", None)
        if status_code:
            self.status_code = status_code


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class PayloadTooLargeError(AppError):
    status_code = 413
    code = "payload_too_large"


class UnsupportedFileError(AppError):
    status_code = 415
    code = "unsupported_file"


class EngineUnavailableError(AppError):
    status_code = 503
    code = "engine_unavailable"


class ModelMissingError(AppError):
    status_code = 503
    code = "model_missing"
