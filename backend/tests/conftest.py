from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from tests.helpers import make_settings


@pytest.fixture
def config(tmp_path: Path) -> Settings:
    return make_settings(tmp_path)


@pytest.fixture
def client(config: Settings) -> Iterator[TestClient]:
    from app.main import create_app

    app = create_app(config, serve_frontend=False)
    with TestClient(app) as test_client:
        yield test_client
