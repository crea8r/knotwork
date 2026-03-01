"""
S4 tests: designer agent (design_graph).
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from knotwork.designer import session as sess
from knotwork.designer.agent import design_graph


@pytest.fixture(autouse=True)
def clear_sessions():
    """Clear all sessions between tests."""
    sess._sessions.clear()
    yield
    sess._sessions.clear()


async def _mock_llm(response_content: str):
    mock_response = MagicMock()
    mock_response.content = response_content
    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(return_value=mock_response)
    return mock_llm


async def test_design_graph_basic(db):
    """Valid LLM JSON response produces reply + graph_delta."""
    payload = json.dumps({
        "reply": "Added an LLM node.",
        "graph_delta": {
            "add_nodes": [{"id": "analyse", "type": "llm_agent", "name": "Analyse", "config": {}}],
        },
        "questions": [],
    })

    with patch("langchain_openai.ChatOpenAI") as mock_cls:
        mock_cls.return_value = await _mock_llm(payload)
        result = await design_graph("s1", "Add an LLM node", "ws1", None, db)

    assert result["reply"] == "Added an LLM node."
    assert "add_nodes" in result["graph_delta"]
    assert result["questions"] == []


async def test_design_graph_with_questions(db):
    """LLM may return clarifying questions."""
    payload = json.dumps({
        "reply": "What should this node do?",
        "graph_delta": {},
        "questions": ["What is the purpose of this node?", "What inputs does it receive?"],
    })

    with patch("langchain_openai.ChatOpenAI") as mock_cls:
        mock_cls.return_value = await _mock_llm(payload)
        result = await design_graph("s2", "Add a node", "ws1", None, db)

    assert len(result["questions"]) == 2
    assert result["graph_delta"] == {}


async def test_design_graph_invalid_json_fallback(db):
    """Malformed LLM response returns fallback dict with empty delta."""
    with patch("langchain_openai.ChatOpenAI") as mock_cls:
        mock_cls.return_value = await _mock_llm("not valid json {{")
        result = await design_graph("s3", "anything", "ws1", None, db)

    assert "reply" in result
    assert result["graph_delta"] == {}
    assert result["questions"] == []


@pytest.mark.xfail(reason="superseded by S6.4: history now persisted in DB per graph_id; in-memory session fallback has no history between calls")
async def test_session_history_preserved(db):
    """Second call to design_graph includes first turn in LLM history."""
    payload = json.dumps({"reply": "ok", "graph_delta": {}, "questions": []})

    calls = []

    async def capture_messages(messages):
        calls.append(messages)
        resp = MagicMock()
        resp.content = payload
        return resp

    with patch("langchain_openai.ChatOpenAI") as mock_cls:
        mock_llm = MagicMock()
        mock_llm.ainvoke = capture_messages
        mock_cls.return_value = mock_llm

        await design_graph("s4", "first message", "ws1", None, db)
        await design_graph("s4", "second message", "ws1", None, db)

    # Second call should have system + user1 + ai1 + user2 = 4 messages
    assert len(calls[1]) == 4


async def test_design_graph_strips_markdown_fences(db):
    """LLM wrapping output in ```json``` fences is handled."""
    payload = '```json\n' + json.dumps({
        "reply": "Done.",
        "graph_delta": {},
        "questions": [],
    }) + '\n```'

    with patch("langchain_openai.ChatOpenAI") as mock_cls:
        mock_cls.return_value = await _mock_llm(payload)
        result = await design_graph("s5", "anything", "ws1", None, db)

    assert result["reply"] == "Done."


async def test_design_graph_passes_existing_graph(db):
    """Existing graph definition is included in the prompt."""
    payload = json.dumps({"reply": "ok", "graph_delta": {}, "questions": []})
    existing = {"nodes": [{"id": "n1"}], "edges": []}
    captured = []

    async def capture(messages):
        captured.extend(messages)
        resp = MagicMock()
        resp.content = payload
        return resp

    with patch("langchain_openai.ChatOpenAI") as mock_cls:
        mock_llm = MagicMock()
        mock_llm.ainvoke = capture
        mock_cls.return_value = mock_llm

        await design_graph("s6", "msg", "ws1", existing, db)

    # System message should contain the graph JSON
    system_content = captured[0].content
    assert '"n1"' in system_content
