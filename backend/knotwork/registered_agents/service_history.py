"""Agent usage history and debug link retrieval."""
from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.graphs.models import Graph, GraphVersion
from knotwork.registered_agents.models import RegisteredAgent
from knotwork.registered_agents.schemas import (
    AgentUsageItem,
    DebugLinkItem,
    RegisteredAgentHistoryItem,
)
from knotwork.registered_agents.service_utils import _get_agent_row
from knotwork.runs.models import OpenAICallLog, Run


async def list_agent_history(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, limit: int = 100
) -> list[RegisteredAgentHistoryItem]:
    ra = await db.get(RegisteredAgent, agent_id)
    if ra is None or ra.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")

    rows = await db.execute(
        select(Run, Graph, GraphVersion)
        .join(Graph, Graph.id == Run.graph_id)
        .join(GraphVersion, GraphVersion.id == Run.graph_version_id)
        .where(Run.workspace_id == workspace_id)
        .order_by(Run.created_at.desc())
        .limit(limit * 3)
    )

    out: list[RegisteredAgentHistoryItem] = []
    for run, graph, version in rows.all():
        nodes = (version.definition or {}).get("nodes", [])
        matched_nodes = [
            node.get("name") or node.get("id") or "Unknown node"
            for node in nodes
            if str(node.get("registered_agent_id") or "") == str(agent_id)
        ]
        if not matched_nodes:
            continue
        out.append(RegisteredAgentHistoryItem(
            run_id=run.id, run_name=run.name, run_status=run.status,
            run_created_at=run.created_at, started_at=run.started_at,
            completed_at=run.completed_at, graph_id=graph.id, graph_name=graph.name,
            involved_nodes=matched_nodes,
        ))
        if len(out) >= limit:
            break
    return out


async def list_usage(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, limit: int = 100
) -> list[AgentUsageItem]:
    history = await list_agent_history(db, workspace_id, agent_id, limit=limit)
    return [
        AgentUsageItem(
            type="run", run_id=h.run_id, workflow_id=h.graph_id,
            workflow_name=h.graph_name, status=h.run_status, timestamp=h.run_created_at,
        )
        for h in history
    ]


async def get_debug_links(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, limit: int = 50
) -> list[DebugLinkItem]:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    rows = await db.execute(
        select(OpenAICallLog)
        .where(OpenAICallLog.workspace_id == workspace_id)
        .where(or_(
            OpenAICallLog.agent_ref == ra.agent_ref,
            OpenAICallLog.agent_ref == f"openai:{ra.agent_ref}",
        ))
        .order_by(OpenAICallLog.created_at.desc())
        .limit(min(max(limit, 1), 200))
    )
    return [
        DebugLinkItem(
            run_id=row.run_id, node_id=row.node_id,
            provider_request_id=row.openai_run_id,
            provider_response_id=row.openai_thread_id,
            provider_trace_id=row.openai_assistant_id,
            created_at=row.created_at,
        )
        for row in rows.scalars()
    ]
