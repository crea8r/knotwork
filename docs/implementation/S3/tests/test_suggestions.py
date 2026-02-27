"""
S3 tests: Mode B improvement suggestions.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from knotwork.knowledge.suggestions import generate_suggestions


async def test_suggestions_file_not_found(db):
    """Non-existent file_id returns empty list."""
    from uuid import uuid4
    from knotwork.knowledge.suggestions import generate_suggestions
    result = await generate_suggestions(uuid4(), db)
    assert result == []


async def test_suggestions_mocked_llm(db, workspace, tmp_storage):
    """With a mocked LLM, suggestions are returned and capped at 3."""
    import knotwork.knowledge.suggestions as sugg_mod
    orig = sugg_mod.get_storage_adapter
    sugg_mod.get_storage_adapter = lambda: tmp_storage

    from knotwork.knowledge.models import KnowledgeFile

    # Write a file to storage so the adapter can read it
    await tmp_storage.write(
        str(workspace.id), "shared/guide.md",
        "## Guide\nAlways be professional.",
        saved_by="system",
    )

    kf = KnowledgeFile(
        workspace_id=workspace.id,
        path="shared/guide.md",
        title="Guide",
        raw_token_count=50,
        resolved_token_count=50,
        linked_paths=[],
    )
    db.add(kf)
    await db.commit()
    await db.refresh(kf)

    mock_response = MagicMock()
    mock_response.content = '["Add examples", "Clarify rule X", "Remove ambiguity", "Extra one"]'

    with patch("langchain_openai.ChatOpenAI") as mock_cls:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_cls.return_value = mock_llm

        suggestions = await generate_suggestions(kf.id, db)

    assert len(suggestions) <= 3
    assert "Add examples" in suggestions

    sugg_mod.get_storage_adapter = orig


async def test_suggestions_llm_error_returns_empty(db, workspace, tmp_storage):
    """If the LLM call raises, suggestions returns [] gracefully."""
    import knotwork.knowledge.suggestions as sugg_mod
    orig = sugg_mod.get_storage_adapter
    sugg_mod.get_storage_adapter = lambda: tmp_storage

    from knotwork.knowledge.models import KnowledgeFile

    await tmp_storage.write(str(workspace.id), "shared/err.md", "content", saved_by="system")

    kf = KnowledgeFile(
        workspace_id=workspace.id,
        path="shared/err.md",
        title="Err",
        raw_token_count=10,
        resolved_token_count=10,
        linked_paths=[],
    )
    db.add(kf)
    await db.commit()
    await db.refresh(kf)

    with patch("langchain_openai.ChatOpenAI", side_effect=Exception("no LLM")):
        suggestions = await generate_suggestions(kf.id, db)

    assert suggestions == []

    sugg_mod.get_storage_adapter = orig


async def test_suggestions_malformed_json_returns_empty(db, workspace, tmp_storage):
    """Malformed LLM response (not a JSON array) returns []."""
    import knotwork.knowledge.suggestions as sugg_mod
    orig = sugg_mod.get_storage_adapter
    sugg_mod.get_storage_adapter = lambda: tmp_storage

    from knotwork.knowledge.models import KnowledgeFile

    await tmp_storage.write(str(workspace.id), "shared/malformed.md", "content", saved_by="system")

    kf = KnowledgeFile(
        workspace_id=workspace.id,
        path="shared/malformed.md",
        title="Malformed",
        raw_token_count=10,
        resolved_token_count=10,
        linked_paths=[],
    )
    db.add(kf)
    await db.commit()
    await db.refresh(kf)

    mock_response = MagicMock()
    mock_response.content = "not valid json {"

    with patch("langchain_openai.ChatOpenAI") as mock_cls:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_cls.return_value = mock_llm

        suggestions = await generate_suggestions(kf.id, db)

    assert suggestions == []

    sugg_mod.get_storage_adapter = orig


async def test_suggestions_api_endpoint(client, ws_id):
    """GET /knowledge/suggestions returns SuggestionOut schema."""
    await client.post(f"/api/v1/workspaces/{ws_id}/knowledge", json={
        "path": "shared/sugg-test.md",
        "title": "Sugg Test",
        "content": "Be concise.",
    })

    with patch("langchain_openai.ChatOpenAI") as mock_cls:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=MagicMock(content='["Be more specific"]'))
        mock_cls.return_value = mock_llm

        r = await client.get(
            f"/api/v1/workspaces/{ws_id}/knowledge/suggestions",
            params={"path": "shared/sugg-test.md"},
        )

    assert r.status_code == 200
    data = r.json()
    assert "suggestions" in data
    assert "health_score" in data


async def test_suggestions_file_not_found_api(client, ws_id):
    r = await client.get(
        f"/api/v1/workspaces/{ws_id}/knowledge/suggestions",
        params={"path": "missing.md"},
    )
    assert r.status_code == 404


@pytest.fixture
async def ws_id(workspace):
    return str(workspace.id)
