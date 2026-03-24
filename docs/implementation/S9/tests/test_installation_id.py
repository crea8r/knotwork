"""
S9 — Install/session-state hardening
Tests for installation_id in /health and the _load_or_create_installation_id helper.

Run:  cd backend && pytest ../docs/implementation/S9/tests/test_installation_id.py -v
"""
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helper tests — pure unit tests, no DB needed
# ---------------------------------------------------------------------------

def test_load_creates_file_if_missing(tmp_path):
    """If the .installation_id file does not exist, a new UUID is written and returned."""
    from knotwork.main import _load_or_create_installation_id

    id_path = tmp_path / "data" / ".installation_id"
    with patch("knotwork.main.Path") as mock_path_cls:
        # Make Path(os.getcwd()) / "data" / ".installation_id" resolve to tmp_path
        mock_path_cls.return_value.__truediv__.return_value.__truediv__.return_value = id_path
        # Patch directly: easier to just call with the known path
        pass

    # Direct approach: patch os.getcwd so the helper resolves inside tmp_path
    with patch("knotwork.main.os.getcwd", return_value=str(tmp_path)):
        result = _load_or_create_installation_id()

    assert result  # non-empty
    try:
        uuid.UUID(result)  # valid UUID
    except ValueError:
        pytest.fail(f"installation_id is not a valid UUID: {result!r}")

    id_path = tmp_path / "data" / ".installation_id"
    assert id_path.exists()
    assert id_path.read_text().strip() == result


def test_load_reads_existing_file(tmp_path):
    """If the .installation_id file already exists, its value is returned unchanged."""
    from knotwork.main import _load_or_create_installation_id

    fixed_id = str(uuid.uuid4())
    id_path = tmp_path / "data" / ".installation_id"
    id_path.parent.mkdir(parents=True)
    id_path.write_text(fixed_id)

    with patch("knotwork.main.os.getcwd", return_value=str(tmp_path)):
        result = _load_or_create_installation_id()

    assert result == fixed_id


def test_load_replaces_empty_file(tmp_path):
    """An empty .installation_id file is treated as missing — a new UUID is generated."""
    from knotwork.main import _load_or_create_installation_id

    id_path = tmp_path / "data" / ".installation_id"
    id_path.parent.mkdir(parents=True)
    id_path.write_text("   ")  # whitespace only

    with patch("knotwork.main.os.getcwd", return_value=str(tmp_path)):
        result = _load_or_create_installation_id()

    assert result
    try:
        uuid.UUID(result)
    except ValueError:
        pytest.fail(f"Replacement installation_id is not a valid UUID: {result!r}")


def test_two_loads_same_dir_return_same_id(tmp_path):
    """Calling the helper twice in the same directory returns the same UUID."""
    from knotwork.main import _load_or_create_installation_id

    with patch("knotwork.main.os.getcwd", return_value=str(tmp_path)):
        first = _load_or_create_installation_id()
        second = _load_or_create_installation_id()

    assert first == second


def test_different_dirs_produce_different_ids(tmp_path):
    """Two independent directories (simulating fresh installs) get different UUIDs."""
    from knotwork.main import _load_or_create_installation_id

    dir_a = tmp_path / "a"
    dir_b = tmp_path / "b"

    with patch("knotwork.main.os.getcwd", return_value=str(dir_a)):
        id_a = _load_or_create_installation_id()

    with patch("knotwork.main.os.getcwd", return_value=str(dir_b)):
        id_b = _load_or_create_installation_id()

    assert id_a != id_b


# ---------------------------------------------------------------------------
# /health endpoint integration test
# ---------------------------------------------------------------------------

def test_health_returns_installation_id(tmp_path):
    """GET /health includes a non-empty installation_id string."""
    # Patch getcwd before creating the app so lifespan resolves the right path.
    with patch("knotwork.main.os.getcwd", return_value=str(tmp_path)):
        from knotwork.main import create_app
        app = create_app()

    # TestClient enters the lifespan context.
    with TestClient(app) as client:
        res = client.get("/health")

    # Accept 200 (DB ok) or 503 (DB unreachable in test env) — both should carry installation_id.
    assert res.status_code in (200, 503)
    body = res.json()
    assert "installation_id" in body
    install_id = body["installation_id"]
    assert install_id  # non-empty
    try:
        uuid.UUID(install_id)
    except ValueError:
        pytest.fail(f"/health installation_id is not a valid UUID: {install_id!r}")


def test_health_installation_id_stable_across_calls(tmp_path):
    """The installation_id in /health is the same on repeated calls within one process."""
    with patch("knotwork.main.os.getcwd", return_value=str(tmp_path)):
        from knotwork.main import create_app
        app = create_app()

    with TestClient(app) as client:
        id1 = client.get("/health").json().get("installation_id")
        id2 = client.get("/health").json().get("installation_id")

    assert id1 == id2
    assert id1  # non-empty
