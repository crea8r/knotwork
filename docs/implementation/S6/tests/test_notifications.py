"""
S6 — Notification preference + log tests.
Uses SQLite in-memory; no live services needed.
"""
import os
import pytest
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
        ws = Workspace(name="Notif WS", slug="notif-ws-s6")
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
async def test_get_preferences_auto_creates(client, setup):
    ws_id = setup["workspace_id"]
    resp = await client.get(f"/api/v1/workspaces/{ws_id}/notification-preferences")
    assert resp.status_code == 200
    data = resp.json()
    assert data["email_enabled"] is False
    assert data["telegram_enabled"] is False
    assert data["whatsapp_enabled"] is False
    assert data["workspace_id"] == ws_id


@pytest.mark.asyncio
async def test_update_email_preference(client, setup):
    ws_id = setup["workspace_id"]
    resp = await client.patch(
        f"/api/v1/workspaces/{ws_id}/notification-preferences",
        json={"email_enabled": True, "email_address": "ops@example.com"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email_enabled"] is True
    assert data["email_address"] == "ops@example.com"


@pytest.mark.asyncio
async def test_update_telegram_preference(client, setup):
    ws_id = setup["workspace_id"]
    resp = await client.patch(
        f"/api/v1/workspaces/{ws_id}/notification-preferences",
        json={"telegram_enabled": True, "telegram_chat_id": "987654321"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["telegram_enabled"] is True
    assert data["telegram_chat_id"] == "987654321"


@pytest.mark.asyncio
async def test_update_whatsapp_preference(client, setup):
    ws_id = setup["workspace_id"]
    resp = await client.patch(
        f"/api/v1/workspaces/{ws_id}/notification-preferences",
        json={"whatsapp_enabled": True, "whatsapp_number": "1234567890"},
    )
    assert resp.status_code == 200
    assert resp.json()["whatsapp_enabled"] is True


@pytest.mark.asyncio
async def test_notification_log_empty(client, setup):
    ws_id = setup["workspace_id"]
    resp = await client.get(f"/api/v1/workspaces/{ws_id}/notification-log")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_notification_log_after_service_call(engine, setup):
    """Insert a log entry directly via service and verify it appears via API."""
    import uuid
    from knotwork.notifications.service import log_notification

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    ws_id = uuid.UUID(setup["workspace_id"])

    async with factory() as db:
        await log_notification(db, ws_id, "email", "sent", detail="test-detail")

    # Verify via API using the same engine
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
    svc_mod.get_storage_adapter = lam
    router_mod.get_storage_adapter = lam
    sugg_mod.get_storage_adapter = lam

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.get(f"/api/v1/workspaces/{setup['workspace_id']}/notification-log")

    app.dependency_overrides.clear()
    assert resp.status_code == 200
    entries = resp.json()
    assert any(e["channel"] == "email" and e["status"] == "sent" for e in entries)
