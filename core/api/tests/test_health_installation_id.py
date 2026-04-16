from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.api.bootstrap.health import initialize_health_state, load_or_create_installation_id, register_health_route


def test_load_creates_file_if_missing(tmp_path: Path):
    with patch("core.api.bootstrap.health.os.getcwd", return_value=str(tmp_path)):
        result = load_or_create_installation_id()

    assert result
    uuid.UUID(result)
    assert (tmp_path / "data" / ".installation_id").read_text().strip() == result


def test_load_reads_existing_file(tmp_path: Path):
    fixed_id = str(uuid.uuid4())
    id_path = tmp_path / "data" / ".installation_id"
    id_path.parent.mkdir(parents=True)
    id_path.write_text(fixed_id)

    with patch("core.api.bootstrap.health.os.getcwd", return_value=str(tmp_path)):
        result = load_or_create_installation_id()

    assert result == fixed_id


def test_load_replaces_empty_file(tmp_path: Path):
    id_path = tmp_path / "data" / ".installation_id"
    id_path.parent.mkdir(parents=True)
    id_path.write_text("   ")

    with patch("core.api.bootstrap.health.os.getcwd", return_value=str(tmp_path)):
        result = load_or_create_installation_id()

    assert result
    uuid.UUID(result)


def test_two_loads_same_dir_return_same_id(tmp_path: Path):
    with patch("core.api.bootstrap.health.os.getcwd", return_value=str(tmp_path)):
        first = load_or_create_installation_id()
        second = load_or_create_installation_id()

    assert first == second


def test_different_dirs_produce_different_ids(tmp_path: Path):
    with patch("core.api.bootstrap.health.os.getcwd", return_value=str(tmp_path / "a")):
        id_a = load_or_create_installation_id()
    with patch("core.api.bootstrap.health.os.getcwd", return_value=str(tmp_path / "b")):
        id_b = load_or_create_installation_id()

    assert id_a != id_b


def test_health_returns_installation_id():
    app = FastAPI(version="0.1.0")
    installation_id = str(uuid.uuid4())
    initialize_health_state(installation_id=installation_id, schema_version="test")
    register_health_route(app)

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code in (200, 503)
    body = response.json()
    assert body["installation_id"] == installation_id
    uuid.UUID(body["installation_id"])


def test_health_installation_id_stable_across_calls():
    app = FastAPI(version="0.1.0")
    installation_id = str(uuid.uuid4())
    initialize_health_state(installation_id=installation_id, schema_version="test")
    register_health_route(app)

    with TestClient(app) as client:
        first = client.get("/health").json()["installation_id"]
        second = client.get("/health").json()["installation_id"]

    assert first == second == installation_id
