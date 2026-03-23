from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.channels.models import Channel, ChannelMessage, DecisionEvent
from knotwork.channels.schemas import ChannelCreate, ChannelMessageCreate, DecisionEventCreate
from knotwork.graphs.models import Graph
from knotwork.runs.models import RunHandbookProposal
from knotwork.escalations.models import Escalation


async def ensure_workflow_channels(db: AsyncSession, workspace_id: UUID) -> None:
    graph_rows = await db.execute(
        select(Graph.id, Graph.name).where(Graph.workspace_id == workspace_id)
    )
    graphs = list(graph_rows.all())

    existing_rows = await db.execute(
        select(Channel.graph_id).where(
            Channel.workspace_id == workspace_id,
            Channel.channel_type == "workflow",
            Channel.graph_id.is_not(None),
        )
    )
    existing_graph_ids = {row[0] for row in existing_rows.all() if row[0] is not None}

    created = False
    for graph_id, graph_name in graphs:
        if graph_id in existing_graph_ids:
            continue
        db.add(
            Channel(
                workspace_id=workspace_id,
                name=f"wf: {graph_name}",
                channel_type="workflow",
                graph_id=graph_id,
            )
        )
        created = True

    if created:
        await db.commit()


async def ensure_handbook_channel(db: AsyncSession, workspace_id: UUID) -> None:
    """Ensure one canonical handbook chat channel exists per workspace."""
    existing = await db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.name == "handbook-chat",
            Channel.archived_at.is_(None),
        )
    )
    channels = list(existing.scalars())
    if not channels:
        db.add(
            Channel(
                workspace_id=workspace_id,
                name="handbook-chat",
                channel_type="handbook",
                graph_id=None,
            )
        )
        await db.commit()
        return

    # Backward compatibility: migrate older handbook chat channels from normal -> handbook.
    updated = False
    for ch in channels:
        if ch.channel_type != "handbook":
            ch.channel_type = "handbook"
            updated = True
    if updated:
        await db.commit()


async def list_channels(db: AsyncSession, workspace_id: UUID) -> list[Channel]:
    await ensure_workflow_channels(db, workspace_id)
    await ensure_handbook_channel(db, workspace_id)
    result = await db.execute(
        select(Channel)
        .where(Channel.workspace_id == workspace_id, Channel.archived_at.is_(None))
        .where(Channel.channel_type.in_(("normal", "workflow", "handbook", "agent_main")))
        .order_by(Channel.channel_type.asc(), Channel.created_at.asc())
    )
    return list(result.scalars())


async def create_channel(db: AsyncSession, workspace_id: UUID, data: ChannelCreate) -> Channel:
    if data.channel_type == "workflow" and data.graph_id is None:
        raise ValueError("workflow channels require graph_id")
    if data.channel_type != "workflow" and data.graph_id is not None:
        raise ValueError("graph_id is only valid for workflow channels")
    ch = Channel(
        workspace_id=workspace_id,
        name=data.name.strip(),
        channel_type=data.channel_type,
        graph_id=data.graph_id,
    )
    db.add(ch)
    await db.commit()
    await db.refresh(ch)
    return ch


async def get_channel(db: AsyncSession, workspace_id: UUID, channel_id: UUID) -> Channel | None:
    ch = await db.get(Channel, channel_id)
    if not ch or ch.workspace_id != workspace_id or ch.archived_at is not None:
        return None
    return ch


async def list_messages(db: AsyncSession, workspace_id: UUID, channel_id: UUID) -> list[ChannelMessage]:
    result = await db.execute(
        select(ChannelMessage)
        .where(
            ChannelMessage.workspace_id == workspace_id,
            ChannelMessage.channel_id == channel_id,
        )
        .order_by(ChannelMessage.created_at.asc())
    )
    return list(result.scalars())


async def create_message(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    data: ChannelMessageCreate,
) -> ChannelMessage:
    msg = ChannelMessage(
        workspace_id=workspace_id,
        channel_id=channel_id,
        role=data.role,
        author_type=data.author_type,
        author_name=data.author_name,
        content=data.content,
        run_id=data.run_id,
        node_id=data.node_id,
        metadata_=data.metadata,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return msg


async def list_decisions(db: AsyncSession, workspace_id: UUID, channel_id: UUID) -> list[DecisionEvent]:
    result = await db.execute(
        select(DecisionEvent)
        .where(
            DecisionEvent.workspace_id == workspace_id,
            DecisionEvent.channel_id == channel_id,
        )
        .order_by(DecisionEvent.created_at.asc())
    )
    return list(result.scalars())


async def create_decision(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID | None,
    data: DecisionEventCreate,
) -> DecisionEvent:
    event = DecisionEvent(
        workspace_id=workspace_id,
        channel_id=channel_id,
        run_id=data.run_id,
        escalation_id=data.escalation_id,
        decision_type=data.decision_type,
        actor_type=data.actor_type,
        actor_name=data.actor_name,
        payload=data.payload,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def inbox_items(db: AsyncSession, workspace_id: UUID) -> list[dict]:
    out: list[dict] = []

    esc_result = await db.execute(
        select(Escalation)
        .where(Escalation.workspace_id == workspace_id, Escalation.status == "open")
        .order_by(Escalation.created_at.desc())
        .limit(100)
    )
    for esc in esc_result.scalars():
        ctx = esc.context or {}
        node_id = str(ctx.get("node_id") or "node")
        out.append(
            {
                "id": f"esc:{esc.id}",
                "item_type": "escalation",
                "title": f"Escalation: {node_id}",
                "subtitle": str(ctx.get("reason") or esc.type),
                "status": esc.status,
                "run_id": esc.run_id,
                "escalation_id": esc.id,
                "proposal_id": None,
                "due_at": esc.timeout_at,
                "created_at": esc.created_at,
            }
        )

    proposal_result = await db.execute(
        select(RunHandbookProposal)
        .where(RunHandbookProposal.status == "pending")
        .order_by(RunHandbookProposal.created_at.desc())
        .limit(100)
    )
    for p in proposal_result.scalars():
        out.append(
            {
                "id": f"proposal:{p.id}",
                "item_type": "handbook_proposal",
                "title": f"Handbook proposal: {p.path}",
                "subtitle": p.reason[:140],
                "status": p.status,
                "run_id": p.run_id,
                "escalation_id": None,
                "proposal_id": p.id,
                "due_at": None,
                "created_at": p.created_at,
            }
        )

    out.sort(key=lambda item: item["created_at"], reverse=True)
    return out


async def find_workflow_channel_for_run(db: AsyncSession, run_id: str) -> UUID | None:
    from knotwork.runs.models import Run

    run = await db.get(Run, run_id)
    if not run:
        return None
    result = await db.execute(
        select(Channel.id).where(
            Channel.workspace_id == run.workspace_id,
            Channel.channel_type == "workflow",
            Channel.graph_id == run.graph_id,
            Channel.archived_at.is_(None),
        )
    )
    row = result.first()
    return row[0] if row else None


async def find_run_channel_for_run(db: AsyncSession, run_id: str) -> UUID | None:
    result = await db.execute(
        select(Channel.id).where(
            Channel.channel_type == "run",
            Channel.name == f"run:{run_id}",
            Channel.archived_at.is_(None),
        )
    )
    row = result.first()
    return row[0] if row else None


async def get_or_create_run_channel(
    db: AsyncSession,
    workspace_id: UUID,
    run_id: str,
    graph_id: UUID | None = None,
) -> Channel:
    existing = await db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.channel_type == "run",
            Channel.name == f"run:{run_id}",
            Channel.archived_at.is_(None),
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        return row

    row = Channel(
        workspace_id=workspace_id,
        name=f"run:{run_id}",
        channel_type="run",
        graph_id=graph_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def get_or_create_agent_main_channel(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    display_name: str,
) -> Channel:
    name = f"agent-main:{agent_id}"
    existing = await db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.channel_type == "agent_main",
            Channel.name == name,
            Channel.archived_at.is_(None),
        ).limit(1)
    )
    row = existing.scalar_one_or_none()
    if row:
        return row

    row = Channel(
        workspace_id=workspace_id,
        name=name,
        channel_type="agent_main",
        graph_id=None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    await create_message(
        db,
        workspace_id,
        row.id,
        ChannelMessageCreate(
            role="system",
            author_type="system",
            author_name="Knotwork",
            content=f"Main session chat for agent: {display_name}",
            metadata={"kind": "main_session_init", "agent_id": str(agent_id)},
        ),
    )
    return row
