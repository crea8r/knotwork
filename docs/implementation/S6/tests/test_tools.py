"""
S6 — Tool registry tests.
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
    """Create a workspace and return its str(id)."""
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    from knotwork.workspaces.models import Workspace
    async with factory() as db:
        ws = Workspace(name="Tools WS", slug="tools-ws-s6")
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


@pytest.mark.asyncio
async def test_list_tools_empty(client, setup):
    ws_id = setup["workspace_id"]
    resp = await client.get(f"/api/v1/workspaces/{ws_id}/tools")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_create_and_get_tool(client, setup):
    ws_id = setup["workspace_id"]
    payload = {
        "name": "My HTTP Tool",
        "slug": "my-http",
        "category": "http",
        "scope": "workspace",
        "definition": {"url": "https://example.com", "method": "GET"},
    }
    resp = await client.post(f"/api/v1/workspaces/{ws_id}/tools", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["slug"] == "my-http"
    tool_id = data["id"]

    resp2 = await client.get(f"/api/v1/workspaces/{ws_id}/tools/{tool_id}")
    assert resp2.status_code == 200
    assert resp2.json()["id"] == tool_id


@pytest.mark.asyncio
async def test_update_tool(client, setup):
    ws_id = setup["workspace_id"]
    create_resp = await client.post(
        f"/api/v1/workspaces/{ws_id}/tools",
        json={"name": "Old", "slug": "old-tool", "category": "function", "definition": {}},
    )
    tool_id = create_resp.json()["id"]
    resp = await client.patch(
        f"/api/v1/workspaces/{ws_id}/tools/{tool_id}", json={"name": "Updated"}
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated"


@pytest.mark.asyncio
async def test_delete_tool(client, setup):
    ws_id = setup["workspace_id"]
    create_resp = await client.post(
        f"/api/v1/workspaces/{ws_id}/tools",
        json={"name": "Del", "slug": "del-tool", "category": "function", "definition": {}},
    )
    tool_id = create_resp.json()["id"]
    resp = await client.delete(f"/api/v1/workspaces/{ws_id}/tools/{tool_id}")
    assert resp.status_code == 204
    resp2 = await client.get(f"/api/v1/workspaces/{ws_id}/tools/{tool_id}")
    assert resp2.status_code == 404


@pytest.mark.asyncio
async def test_get_tool_not_found(client, setup):
    ws_id = setup["workspace_id"]
    resp = await client.get(f"/api/v1/workspaces/{ws_id}/tools/00000000-0000-0000-0000-999999999999")
    assert resp.status_code == 404


@pytest.mark.xfail(reason="superseded by S7: built-in tools endpoint removed", strict=False)
@pytest.mark.asyncio
async def test_list_builtin_tools(client, setup):
    ws_id = setup["workspace_id"]
    resp = await client.get(f"/api/v1/workspaces/{ws_id}/tools/builtins")
    assert resp.status_code == 200
    slugs = [t["slug"] for t in resp.json()]
    assert "web.search" in slugs
    assert "web.fetch" in slugs
    assert "http.request" in slugs
    assert "calc" in slugs
