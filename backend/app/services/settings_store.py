from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from ..config import Settings
from ..schemas import AppSettings, SettingsUpdate


class SettingsStore:
    def __init__(self, path: Path, config: Settings) -> None:
        self.path = path
        self.config = config
        self._settings = self._load()

    def _defaults(self) -> AppSettings:
        return AppSettings(
            default_prompt="document parsing.",
            default_prompt_mode="layout",
            default_dpi=self.config.default_dpi,
            default_max_tokens=self.config.default_max_tokens,
            auto_start_engine=True,
            keep_history=True,
        )

    def _load(self) -> AppSettings:
        if not self.path.exists():
            return self._defaults()
        try:
            raw = json.loads(self.path.read_text("utf-8"))
            return AppSettings.model_validate(raw)
        except Exception:
            return self._defaults()

    def get(self) -> AppSettings:
        return self._settings

    def update(self, update: SettingsUpdate) -> AppSettings:
        data = self._settings.model_dump()
        for key, value in update.model_dump(exclude_none=True).items():
            data[key] = value
        self._settings = AppSettings.model_validate(data)
        self._save()
        return self._settings

    def reset(self) -> AppSettings:
        self._settings = self._defaults()
        self._save()
        return self._settings

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(dir=self.path.parent, prefix=".settings-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(self._settings.model_dump(), handle, indent=2)
                handle.write("\n")
            os.replace(temp_name, self.path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)
