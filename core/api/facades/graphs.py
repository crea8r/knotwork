"""Core facade for workflow graph access.

Keep graph-specific mutation and normalization in
`modules.workflows.backend.graphs.*`.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from modules.workflows.backend.graphs import service as graphs_service
from modules.workflows.backend.graphs import draft_mutation as graph_draft_mutation


async def get_graph(db: AsyncSession, graph_id: UUID):
    return await graphs_service.get_graph(db, graph_id)


async def get_latest_version(db: AsyncSession, graph_id: UUID):
    return await graphs_service.get_latest_version(db, graph_id)


async def get_any_draft(db: AsyncSession, graph_id: UUID):
    return await graphs_service.get_any_draft(db, graph_id)


async def list_workspace_graphs(db: AsyncSession, workspace_id: UUID):
    return await graphs_service.list_workspace_graphs(db, workspace_id)


async def update_root_draft(db: AsyncSession, graph_id: UUID, definition: dict, created_by: UUID | None = None):
    return await graph_draft_mutation.update_root_draft(db, graph_id, definition, created_by=created_by)


async def apply_delta_to_root_draft(db: AsyncSession, graph_id: UUID, delta: dict, created_by: UUID | None = None):
    return await graph_draft_mutation.apply_delta_to_root_draft(db, graph_id, delta, created_by=created_by)
