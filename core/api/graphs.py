from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from modules.workflows.backend import graphs_service


async def get_graph(db: AsyncSession, graph_id: UUID):
    return await graphs_service.get_graph(db, graph_id)


async def get_latest_version(db: AsyncSession, graph_id: UUID):
    return await graphs_service.get_latest_version(db, graph_id)


async def get_any_draft(db: AsyncSession, graph_id: UUID):
    return await graphs_service.get_any_draft(db, graph_id)
