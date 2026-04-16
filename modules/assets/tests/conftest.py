from __future__ import annotations

import os

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret")

import libs.auth.backend.models  # noqa: F401
import libs.audit.backend.models  # noqa: F401
import modules.admin.backend.workspaces_models  # noqa: F401
import modules.assets.backend.knowledge_models  # noqa: F401
import modules.communication.backend.channels_models  # noqa: F401
import modules.communication.backend.notifications_models  # noqa: F401
import modules.workflows.backend.runs.escalations_models  # noqa: F401
import modules.projects.backend.projects_models  # noqa: F401
import modules.workflows.backend.graphs.models  # noqa: F401
import modules.workflows.backend.runs.models  # noqa: F401

from libs.database import Base
from modules.admin.backend.workspaces_models import Workspace
from modules.workflows.backend.graphs.models import Graph
from modules.workflows.backend.runs.models import Run


@pytest.fixture
async def engine():
    eng = create_async_engine("sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False})
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.fixture
async def db(engine):
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest.fixture
async def workspace(db: AsyncSession) -> Workspace:
    ws = Workspace(name="Assets Test Workspace", slug="assets-test")
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    return ws


@pytest.fixture
async def graph(db: AsyncSession, workspace: Workspace) -> Graph:
    graph = Graph(
        workspace_id=workspace.id,
        name="Health Graph",
        path="workflows/health",
        trigger_config={},
    )
    db.add(graph)
    await db.commit()
    await db.refresh(graph)
    return graph


@pytest.fixture
async def run(db: AsyncSession, workspace: Workspace, graph: Graph) -> Run:
    run = Run(
        workspace_id=workspace.id,
        graph_id=graph.id,
        input={},
        context_files=[],
        trigger="manual",
        status="completed",
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run
