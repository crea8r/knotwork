from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import graphs as core_graphs
from core.api import projects as core_projects
from core.api import workspaces as core_workspaces
from libs.auth.backend.models import User
from libs.participants import member_participant_id

from ..channels_models import Channel, ChannelSubscription
from .bootstrap import _generate_channel_slug


async def get_or_create_objective_agentzero_consultation(
    db: AsyncSession,
    workspace_id: UUID,
    objective_id: UUID,
    requester_member,
    requester_user: User,
) -> Channel:
    objective = await core_projects.get_objective(db, objective_id)
    if objective is None or objective.workspace_id != workspace_id:
        raise ValueError("Objective not found")
    label = objective.code or objective.title
    return await _get_or_create_consultation(
        db,
        workspace_id=workspace_id,
        requester_member=requester_member,
        requester_user=requester_user,
        query_filters={"objective_id": objective_id},
        channel_name=f"AgentZero consult: {label}",
        channel_slug_seed=f"agentzero consult {label}",
        project_id=objective.project_id,
        objective_id=objective.id,
    )


async def get_or_create_graph_agentzero_consultation(
    db: AsyncSession,
    workspace_id: UUID,
    graph_id: UUID,
    requester_member,
    requester_user: User,
) -> Channel:
    graph = await core_graphs.get_graph(db, graph_id)
    if graph is None or graph.workspace_id != workspace_id:
        raise ValueError("Graph not found")
    label = graph.name or "Workflow"
    return await _get_or_create_consultation(
        db,
        workspace_id=workspace_id,
        requester_member=requester_member,
        requester_user=requester_user,
        query_filters={"graph_id": graph_id},
        channel_name=f"AgentZero workflow consult: {label}",
        channel_slug_seed=f"agentzero workflow consult {label}",
        project_id=graph.project_id,
        graph_id=graph.id,
    )


async def _get_or_create_consultation(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    requester_member,
    requester_user: User,
    query_filters: dict,
    channel_name: str,
    channel_slug_seed: str,
    project_id: UUID | None = None,
    objective_id: UUID | None = None,
    graph_id: UUID | None = None,
) -> Channel:
    agentzero = await core_workspaces.get_agentzero_member_user(db, workspace_id)
    if agentzero is None:
        raise ValueError("AgentZero is not assigned")
    agentzero_member, agentzero_user = agentzero

    participant_ids = {
        member_participant_id(requester_member, requester_user.id),
        member_participant_id(agentzero_member, agentzero_user.id),
    }
    channel = await _find_consultation_channel(db, workspace_id, participant_ids, **query_filters)
    if channel is not None:
        return channel

    channel = Channel(
        workspace_id=workspace_id,
        name=channel_name,
        slug=await _generate_channel_slug(db, channel_slug_seed),
        channel_type="consultation",
        project_id=project_id,
        objective_id=objective_id,
        graph_id=graph_id,
    )
    db.add(channel)
    await db.flush()
    for participant_id in participant_ids:
        db.add(ChannelSubscription(workspace_id=workspace_id, channel_id=channel.id, participant_id=participant_id))
    await db.commit()
    await db.refresh(channel)
    return channel


async def _find_consultation_channel(db: AsyncSession, workspace_id: UUID, participant_ids: set[str], **filters) -> Channel | None:
    stmt = (
        select(Channel)
        .where(Channel.workspace_id == workspace_id, Channel.channel_type == "consultation", Channel.archived_at.is_(None))
        .order_by(Channel.created_at.desc())
    )
    for field, value in filters.items():
        stmt = stmt.where(getattr(Channel, field) == value)
    existing_rows = await db.execute(stmt)
    for channel in existing_rows.scalars():
        subscription_rows = await db.execute(
            select(ChannelSubscription.participant_id).where(
                ChannelSubscription.workspace_id == workspace_id,
                ChannelSubscription.channel_id == channel.id,
                ChannelSubscription.unsubscribed_at.is_(None),
            )
        )
        if participant_ids.issubset({row[0] for row in subscription_rows.all()}):
            return channel
    return None
