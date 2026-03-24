"""
S6.1 — input_schema, run delete, and abort endpoint tests.
Uses SQLite in-memory; no live services needed.
"""
import os
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

os.environ.setdefault("OPENAI_API_KEY", "sk-test-fake")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("DATABASE_URL_SYNC", "")

import knotwork.auth.models          # noqa: F401
import knotwork.workspaces.models    # noqa: F401
import knotwork.graphs.models        # noqa: F401
import knotwork.runs.models          # noqa: F401
import knotwork.knowledge.models     # noqa: F401
import knotwork.tools.models         # noqa: F401
import knotwork.escalations.models   # noqa: F401
import knotwork.ratings.models       # noqa: F401
import knotwork.audit.models         # noqa: F401
import knotwork.notifications.models # noqa: F401

from knotwork.database import Base, get_db
from knotwork.main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def engine():
    eng = create_async_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.fixture
async def setup(engine):
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    from knotwork.workspaces.models import Workspace
    async with factory() as db:
        ws = Workspace(name="S6.1 WS", slug="s61-ws")
        db.add(ws)
        await db.commit()
        await db.refresh(ws)
        return {"workspace_id": str(ws.id)}


@pytest.fixture
async def client(engine, setup):
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db

    import knotwork.knowledge.service as svc_mod
    import knotwork.knowledge.router as router_mod
    import knotwork.knowledge.suggestions as sugg_mod
    from knotwork.knowledge.storage.local_fs import LocalFSAdapter
    import tempfile, pathlib
    tmp = LocalFSAdapter(root=str(pathlib.Path(tempfile.mkdtemp())))
    lam = lambda: tmp  # noqa: E731
    orig = (svc_mod.get_storage_adapter, router_mod.get_storage_adapter, sugg_mod.get_storage_adapter)
    svc_mod.get_storage_adapter = lam
    router_mod.get_storage_adapter = lam
    sugg_mod.get_storage_adapter = lam

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()
    svc_mod.get_storage_adapter, router_mod.get_storage_adapter, sugg_mod.get_storage_adapter = orig


# ---------------------------------------------------------------------------
# InputFieldDef schema validation
# ---------------------------------------------------------------------------

def test_input_field_def_defaults():
    from knotwork.graphs.schemas import InputFieldDef
    f = InputFieldDef(name="email", label="Email")
    assert f.required is True
    assert f.type == "text"
    assert f.description == ""


def test_input_field_def_all_types():
    from knotwork.graphs.schemas import InputFieldDef
    for t in ("text", "textarea", "number"):
        f = InputFieldDef(name="x", label="X", type=t)
        assert f.type == t


def test_graph_definition_schema_has_input_schema():
    from knotwork.graphs.schemas import GraphDefinitionSchema, InputFieldDef
    defn = GraphDefinitionSchema(
        nodes=[],
        edges=[],
        input_schema=[
            InputFieldDef(name="client_name", label="Client Name"),
            InputFieldDef(name="contract_text", label="Contract Text", type="textarea"),
        ],
    )
    assert len(defn.input_schema) == 2
    assert defn.input_schema[0].name == "client_name"


def test_graph_definition_schema_input_schema_optional():
    from knotwork.graphs.schemas import GraphDefinitionSchema
    defn = GraphDefinitionSchema()
    assert defn.input_schema == []


# ---------------------------------------------------------------------------
# Graph create/save with input_schema via API
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_graph_with_input_schema(client, setup):
    ws_id = setup["workspace_id"]
    payload = {
        "name": "Contract Review",
        "definition": {
            "nodes": [{"id": "review", "type": "llm_agent", "name": "Review", "config": {}}],
            "edges": [],
            "entry_point": "review",
            "input_schema": [
                {"name": "client_name", "label": "Client Name", "description": "", "required": True, "type": "text"},
                {"name": "contract_text", "label": "Contract Text", "description": "Paste the contract", "required": True, "type": "textarea"},
            ],
        },
    }
    resp = await client.post(f"/api/v1/workspaces/{ws_id}/graphs", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    graph_id = data["id"]

    # Fetch it back and check definition
    resp2 = await client.get(f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}")
    assert resp2.status_code == 200
    defn = resp2.json()["latest_version"]["definition"]
    assert "input_schema" in defn
    assert len(defn["input_schema"]) == 2
    assert defn["input_schema"][0]["name"] == "client_name"
    assert defn["input_schema"][1]["type"] == "textarea"


@pytest.mark.asyncio
async def test_save_version_with_input_schema(client, setup):
    ws_id = setup["workspace_id"]
    # Create graph first
    create_resp = await client.post(f"/api/v1/workspaces/{ws_id}/graphs", json={"name": "Test"})
    graph_id = create_resp.json()["id"]

    # Save a version with input_schema
    version_payload = {
        "definition": {
            "nodes": [],
            "edges": [],
            "input_schema": [
                {"name": "summary", "label": "Summary", "description": "", "required": False, "type": "textarea"},
            ],
        }
    }
    resp = await client.post(f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}/versions", json=version_payload)
    assert resp.status_code == 201
    defn = resp.json()["definition"]
    assert defn["input_schema"][0]["name"] == "summary"
    assert defn["input_schema"][0]["required"] is False


# ---------------------------------------------------------------------------
# Delete run endpoint
# ---------------------------------------------------------------------------

async def _create_graph_and_run(client, ws_id: str, status: str):
    """Helper: create a graph version + a run record with given status."""
    import uuid

    # Create graph
    g_resp = await client.post(f"/api/v1/workspaces/{ws_id}/graphs", json={"name": "G"})
    assert g_resp.status_code == 201, g_resp.text
    graph_id = g_resp.json()["id"]

    # Save version and capture its ID
    ver_resp = await client.post(
        f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}/versions",
        json={"definition": {"nodes": [], "edges": []}},
    )
    assert ver_resp.status_code == 201, ver_resp.text
    version_id = ver_resp.json()["id"]

    # Directly insert a run with the desired status (bypass arq)
    from knotwork.database import get_db
    db_gen = app.dependency_overrides[get_db]()
    db = await db_gen.__anext__()

    from knotwork.runs.models import Run
    run = Run(
        id=str(uuid.uuid4()),
        workspace_id=uuid.UUID(ws_id),
        graph_id=uuid.UUID(graph_id),
        graph_version_id=uuid.UUID(version_id),
        input={},
        status=status,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    run_id = str(run.id)

    try:
        await db_gen.__anext__()
    except StopAsyncIteration:
        pass

    return run_id, graph_id


@pytest.mark.asyncio
async def test_delete_terminal_run(client, setup):
    ws_id = setup["workspace_id"]
    run_id, _ = await _create_graph_and_run(client, ws_id, "completed")

    resp = await client.delete(f"/api/v1/workspaces/{ws_id}/runs/{run_id}")
    assert resp.status_code == 204

    # Verify it's gone
    resp2 = await client.get(f"/api/v1/workspaces/{ws_id}/runs/{run_id}")
    assert resp2.status_code == 404


@pytest.mark.asyncio
@pytest.mark.xfail(reason="superseded by S8: DELETABLE_STATUSES expanded to include 'running'; active runs can now be deleted directly")
async def test_delete_active_run_rejected(client, setup):
    ws_id = setup["workspace_id"]
    run_id, _ = await _create_graph_and_run(client, ws_id, "running")

    resp = await client.delete(f"/api/v1/workspaces/{ws_id}/runs/{run_id}")
    assert resp.status_code == 400
    assert "running" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_abort_active_run(client, setup):
    ws_id = setup["workspace_id"]
    run_id, _ = await _create_graph_and_run(client, ws_id, "running")

    resp = await client.post(f"/api/v1/workspaces/{ws_id}/runs/{run_id}/abort")
    assert resp.status_code == 200
    assert resp.json()["status"] == "stopped"


@pytest.mark.asyncio
async def test_abort_terminal_run_rejected(client, setup):
    ws_id = setup["workspace_id"]
    run_id, _ = await _create_graph_and_run(client, ws_id, "completed")

    resp = await client.post(f"/api/v1/workspaces/{ws_id}/runs/{run_id}/abort")
    assert resp.status_code == 400
    assert "terminal" in resp.json()["detail"].lower()
