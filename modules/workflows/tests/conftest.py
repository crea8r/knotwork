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
from modules.workflows.backend.graphs.models import Graph, GraphVersion

SIMPLE_DEFINITION = {
    "name": "Workflow",
    "nodes": [
        {"id": "start", "type": "start", "name": "Start", "config": {}},
        {
            "id": "work",
            "type": "agent",
            "name": "Work",
            "agent_ref": "human",
            "operator_id": "human:operator",
            "supervisor_id": "human:supervisor",
            "config": {},
        },
        {"id": "end", "type": "end", "name": "End", "config": {}},
    ],
    "edges": [
        {"id": "e1", "source": "start", "target": "work", "type": "direct"},
        {"id": "e2", "source": "work", "target": "end", "type": "direct"},
    ],
    "entry_point": "work",
}


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
    ws = Workspace(name="Workflow Test Workspace", slug="workflow-test")
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    return ws


@pytest.fixture
async def graph(db: AsyncSession, workspace: Workspace) -> Graph:
    graph = Graph(
        workspace_id=workspace.id,
        name="Workflow Graph",
        path="workflows/workflow-graph",
        trigger_config={},
    )
    db.add(graph)
    await db.flush()

    draft = GraphVersion(
        graph_id=graph.id,
        definition=SIMPLE_DEFINITION,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(graph)
    return graph
