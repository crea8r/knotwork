"""
S6.3 automated tests:
  - RunUpdate accepts optional name and input
  - update_run rejects input change on non-draft runs
  - prompt_builder renders prior_outputs in THIS CASE section
  - llm_agent node respects input_sources config
  - node_outputs accumulates across nodes in RunState
"""
from __future__ import annotations
import uuid
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

from knotwork.main import app
from knotwork.database import Base, get_db


# ── DB fixture ────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="function")
async def db_session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession):
    async def override():
        yield db_session
    app.dependency_overrides[get_db] = override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


# ── helpers ───────────────────────────────────────────────────────────────────

async def _setup(client: AsyncClient) -> dict:
    ws_id = str(uuid.uuid4())
    g = await client.post(f"/api/v1/workspaces/{ws_id}/graphs", json={"name": "Test Graph"})
    assert g.status_code == 201, g.text
    graph_id = g.json()["id"]
    v = await client.post(
        f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}/versions",
        json={"definition": {"nodes": [{"id": "n1", "type": "llm_agent", "name": "N1", "config": {}}], "edges": []}},
    )
    assert v.status_code == 201
    return {"ws_id": ws_id, "graph_id": graph_id}


async def _create_run(client: AsyncClient, ws_id: str, graph_id: str, **kwargs) -> str:
    r = await client.post(
        f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}/runs",
        json={"input": {"q": "hello"}, **kwargs},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ── RunUpdate / draft input editing ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_patch_name_only(client):
    s = await _setup(client)
    run_id = await _create_run(client, s["ws_id"], s["graph_id"])
    r = await client.patch(
        f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}",
        json={"name": "New name"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "New name"


@pytest.mark.asyncio
async def test_patch_input_rejected_on_non_draft(client):
    """Input update must be rejected when run is not in draft status."""
    s = await _setup(client)
    run_id = await _create_run(client, s["ws_id"], s["graph_id"])
    # Default status after create is "queued" (not draft)
    r = await client.patch(
        f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}",
        json={"input": {"q": "changed"}},
    )
    assert r.status_code == 400
    assert "draft" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_patch_input_allowed_on_draft(client, db_session):
    """Input update succeeds when run is in draft status."""
    s = await _setup(client)
    run_id = await _create_run(client, s["ws_id"], s["graph_id"])

    # Force to draft
    from knotwork.runs.models import Run
    run = await db_session.get(Run, uuid.UUID(run_id))
    run.status = "draft"
    await db_session.commit()

    r = await client.patch(
        f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}",
        json={"input": {"q": "updated value"}},
    )
    assert r.status_code == 200

    # Verify persisted
    r2 = await client.get(f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}")
    assert r2.json()["input"]["q"] == "updated value"


@pytest.mark.asyncio
async def test_patch_name_and_input_on_draft(client, db_session):
    """Both name and input can be updated in one PATCH on a draft run."""
    s = await _setup(client)
    run_id = await _create_run(client, s["ws_id"], s["graph_id"])

    from knotwork.runs.models import Run
    run = await db_session.get(Run, uuid.UUID(run_id))
    run.status = "draft"
    await db_session.commit()

    r = await client.patch(
        f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}",
        json={"name": "Draft test", "input": {"q": "new input"}},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Draft test"
    assert data["input"]["q"] == "new input"


# ── prompt_builder prior_outputs ─────────────────────────────────────────────

def test_render_case_with_prior_outputs():
    """prior_outputs entries appear as named sections in THIS CASE."""
    from knotwork.runtime.prompt_builder import _render_case

    result = _render_case(
        state_fields={"customer": "Acme"},
        context_files=[],
        prior_outputs={"step-1": "Contract looks fine."},
    )
    assert "### Run input" in result
    assert "Acme" in result
    assert "### Output from node: step-1" in result
    assert "Contract looks fine." in result


def test_render_case_no_prior_outputs():
    """Without prior_outputs the case section looks the same as before."""
    from knotwork.runtime.prompt_builder import _render_case

    result = _render_case(
        state_fields={"x": 1},
        context_files=[],
    )
    assert "### Run input" in result
    assert "Output from node" not in result


def test_render_case_no_run_input_only_prior():
    """Empty state_fields + prior_outputs renders only prior section."""
    from knotwork.runtime.prompt_builder import _render_case

    result = _render_case(
        state_fields={},
        context_files=[],
        prior_outputs={"step-1": "hello"},
    )
    # state_fields is empty dict → no Run input section
    assert "### Run input" not in result
    assert "### Output from node: step-1" in result


def test_build_agent_prompt_prior_outputs_in_user_prompt():
    """prior_outputs end up in the user_prompt (THIS CASE), not system_prompt."""
    from knotwork.runtime.knowledge_loader import KnowledgeTree
    from knotwork.runtime.prompt_builder import build_agent_prompt

    _, user_prompt = build_agent_prompt(
        tree=KnowledgeTree(),
        state_fields={"q": "test"},
        prior_outputs={"a": "Answer from node a"},
    )
    assert "Output from node: a" in user_prompt
    assert "Answer from node a" in user_prompt


# ── node_outputs reducer ──────────────────────────────────────────────────────

def test_merge_outputs_reducer():
    """_merge_outputs merges two dicts (later dict wins on key conflict)."""
    from knotwork.runtime.engine import _merge_outputs

    merged = _merge_outputs({"a": "first"}, {"b": "second"})
    assert merged == {"a": "first", "b": "second"}

    # Later value wins
    overwrite = _merge_outputs({"a": "old"}, {"a": "new"})
    assert overwrite["a"] == "new"


# ── config key alignment ──────────────────────────────────────────────────────

def test_llm_agent_reads_system_prompt_key():
    """make_llm_agent_node reads 'system_prompt' config key (not 'instructions')."""
    from knotwork.runtime.nodes.llm_agent import make_llm_agent_node

    node_def = {
        "id": "n1",
        "type": "llm_agent",
        "name": "N1",
        "config": {"system_prompt": "You are a legal assistant."},
    }
    # Factory should not raise; the instructions are captured at factory time
    fn = make_llm_agent_node(node_def)
    assert fn is not None
    # Verify it captured the correct value via closure inspection
    assert fn.__closure__ is not None
    closure_vars = {cell.cell_contents for cell in fn.__closure__ if isinstance(
        getattr(cell, 'cell_contents', None), str
    )}
    assert "You are a legal assistant." in closure_vars


def test_llm_agent_reads_knowledge_paths_key():
    """make_llm_agent_node reads 'knowledge_paths' config key (not 'knowledge_files')."""
    from knotwork.runtime.nodes.llm_agent import make_llm_agent_node

    node_def = {
        "id": "n1",
        "type": "llm_agent",
        "name": "N1",
        "config": {"knowledge_paths": ["legal/review.md"]},
    }
    fn = make_llm_agent_node(node_def)
    assert fn is not None
    closure_vars = [cell.cell_contents for cell in fn.__closure__
                    if isinstance(getattr(cell, 'cell_contents', None), list)]
    assert ["legal/review.md"] in closure_vars
