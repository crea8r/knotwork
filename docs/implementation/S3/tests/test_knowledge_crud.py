"""
S3 tests: Handbook (knowledge file) CRUD API.
"""
from __future__ import annotations

import pytest


WS_ID = None  # filled by workspace fixture


@pytest.fixture
async def ws_id(workspace):
    return str(workspace.id)


async def test_list_files_empty(client, ws_id):
    """Empty workspace returns empty list."""
    r = await client.get(f"/api/v1/workspaces/{ws_id}/knowledge")
    assert r.status_code == 200
    assert r.json() == []


async def test_create_file(client, ws_id):
    """POST creates a file; returns 201 with metadata."""
    r = await client.post(f"/api/v1/workspaces/{ws_id}/knowledge", json={
        "path": "legal/contract-review.md",
        "title": "Contract Review",
        "content": "## Contract Review\nAlways check the termination clause.",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["path"] == "legal/contract-review.md"
    assert data["title"] == "Contract Review"
    assert data["raw_token_count"] > 0
    assert data["current_version_id"] is not None


async def test_list_files_after_create(client, ws_id):
    """List returns the created file."""
    await client.post(f"/api/v1/workspaces/{ws_id}/knowledge", json={
        "path": "shared/tone.md",
        "title": "Tone Guide",
        "content": "Always be professional.",
    })
    r = await client.get(f"/api/v1/workspaces/{ws_id}/knowledge")
    assert r.status_code == 200
    paths = [f["path"] for f in r.json()]
    assert "shared/tone.md" in paths


async def test_get_file(client, ws_id):
    """GET /knowledge/file returns content + metadata."""
    await client.post(f"/api/v1/workspaces/{ws_id}/knowledge", json={
        "path": "finance/ratios.md",
        "title": "Financial Ratios",
        "content": "## Ratios\nDebt-to-equity is key.",
    })
    r = await client.get(f"/api/v1/workspaces/{ws_id}/knowledge/file", params={"path": "finance/ratios.md"})
    assert r.status_code == 200
    data = r.json()
    assert data["content"] == "## Ratios\nDebt-to-equity is key."
    assert data["version_id"] is not None


async def test_get_file_not_found(client, ws_id):
    r = await client.get(f"/api/v1/workspaces/{ws_id}/knowledge/file", params={"path": "missing.md"})
    assert r.status_code == 404


async def test_update_file(client, ws_id):
    """PUT /knowledge/file updates content and creates a new version."""
    await client.post(f"/api/v1/workspaces/{ws_id}/knowledge", json={
        "path": "shared/guidelines.md",
        "title": "Guidelines",
        "content": "v1 content",
    })
    r = await client.put(
        f"/api/v1/workspaces/{ws_id}/knowledge/file",
        params={"path": "shared/guidelines.md"},
        json={"content": "v2 content", "change_summary": "Updated guidelines"},
    )
    assert r.status_code == 200

    r2 = await client.get(f"/api/v1/workspaces/{ws_id}/knowledge/file", params={"path": "shared/guidelines.md"})
    assert r2.json()["content"] == "v2 content"


async def test_update_file_not_found(client, ws_id):
    r = await client.put(
        f"/api/v1/workspaces/{ws_id}/knowledge/file",
        params={"path": "nonexistent.md"},
        json={"content": "nope"},
    )
    assert r.status_code == 404


async def test_delete_file(client, ws_id):
    """DELETE soft-deletes file; subsequent GET returns 404."""
    await client.post(f"/api/v1/workspaces/{ws_id}/knowledge", json={
        "path": "temp/scratch.md",
        "title": "Scratch",
        "content": "temporary content",
    })
    r = await client.delete(f"/api/v1/workspaces/{ws_id}/knowledge/file", params={"path": "temp/scratch.md"})
    assert r.status_code == 204

    r2 = await client.get(f"/api/v1/workspaces/{ws_id}/knowledge/file", params={"path": "temp/scratch.md"})
    assert r2.status_code == 404


async def test_delete_file_not_found(client, ws_id):
    r = await client.delete(f"/api/v1/workspaces/{ws_id}/knowledge/file", params={"path": "ghost.md"})
    assert r.status_code == 404


async def test_file_history(client, ws_id):
    """GET /knowledge/history returns all versions newest-first."""
    await client.post(f"/api/v1/workspaces/{ws_id}/knowledge", json={
        "path": "shared/versioned.md",
        "title": "Versioned",
        "content": "version one",
    })
    await client.put(
        f"/api/v1/workspaces/{ws_id}/knowledge/file",
        params={"path": "shared/versioned.md"},
        json={"content": "version two"},
    )
    r = await client.get(f"/api/v1/workspaces/{ws_id}/knowledge/history", params={"path": "shared/versioned.md"})
    assert r.status_code == 200
    versions = r.json()
    assert len(versions) == 2
    assert all("version_id" in v for v in versions)


async def test_restore_version(client, ws_id):
    """POST /knowledge/restore replaces content with a historical version."""
    await client.post(f"/api/v1/workspaces/{ws_id}/knowledge", json={
        "path": "shared/restore-test.md",
        "title": "Restore Test",
        "content": "original content",
    })
    await client.put(
        f"/api/v1/workspaces/{ws_id}/knowledge/file",
        params={"path": "shared/restore-test.md"},
        json={"content": "updated content"},
    )
    # Get history to find the original version_id
    history_r = await client.get(
        f"/api/v1/workspaces/{ws_id}/knowledge/history",
        params={"path": "shared/restore-test.md"},
    )
    versions = history_r.json()
    original_version_id = versions[-1]["version_id"]  # oldest = last in list

    r = await client.post(
        f"/api/v1/workspaces/{ws_id}/knowledge/restore",
        params={"path": "shared/restore-test.md"},
        json={"version_id": original_version_id},
    )
    assert r.status_code == 200

    r2 = await client.get(
        f"/api/v1/workspaces/{ws_id}/knowledge/file",
        params={"path": "shared/restore-test.md"},
    )
    assert r2.json()["content"] == "original content"


async def test_restore_bad_version(client, ws_id):
    """Restoring a non-existent version_id returns 404."""
    await client.post(f"/api/v1/workspaces/{ws_id}/knowledge", json={
        "path": "shared/no-version.md",
        "title": "NoVer",
        "content": "content",
    })
    r = await client.post(
        f"/api/v1/workspaces/{ws_id}/knowledge/restore",
        params={"path": "shared/no-version.md"},
        json={"version_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert r.status_code == 404


async def test_token_count_stored(client, ws_id):
    """raw_token_count is stored and reflects content length."""
    content = "word " * 400  # ~400 tokens
    r = await client.post(f"/api/v1/workspaces/{ws_id}/knowledge", json={
        "path": "shared/long.md",
        "title": "Long",
        "content": content,
    })
    assert r.status_code == 201
    assert r.json()["raw_token_count"] >= 300


async def test_linked_paths_extracted(client, ws_id):
    """Wiki-links are extracted and stored in linked_paths."""
    r = await client.post(f"/api/v1/workspaces/{ws_id}/knowledge", json={
        "path": "legal/main.md",
        "title": "Main",
        "content": "See [[red-flags]] and [[shared/tone]] for context.",
    })
    assert r.status_code == 201
    linked = r.json()["linked_paths"]
    assert "red-flags" in linked
    assert "shared/tone" in linked
