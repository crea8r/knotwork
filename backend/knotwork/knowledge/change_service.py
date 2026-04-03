from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.channels import service as channel_service
from knotwork.channels.schemas import ChannelCreate, ChannelMessageCreate, DecisionEventCreate
from knotwork.knowledge import folder_service
from knotwork.knowledge import service as knowledge_service
from knotwork.knowledge.models import KnowledgeChange


def _change_channel_name(path: str) -> str:
    label = path.strip() or "knowledge change"
    return f"review: {label}"


async def create_knowledge_change(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    path: str,
    proposed_content: str,
    reason: str,
    run_id: str,
    node_id: str,
    agent_ref: str | None = None,
    source_channel_id: UUID | None = None,
    action_type: str = "update_content",
    target_type: str = "file",
    payload: dict | None = None,
) -> KnowledgeChange:
    project_id: UUID | None = None
    channel = await channel_service.create_channel(
        db,
        workspace_id,
        ChannelCreate(
            name=_change_channel_name(path),
            channel_type="normal",
        ),
    )

    change = KnowledgeChange(
        id=uuid4(),
        workspace_id=workspace_id,
        project_id=project_id,
        run_id=run_id,
        node_id=node_id,
        channel_id=channel.id,
        agent_ref=agent_ref,
        action_type=action_type,
        target_type=target_type,
        target_path=path,
        proposed_content=proposed_content,
        payload=payload or {},
        reason=reason,
        status="pending",
    )
    db.add(change)
    await db.flush()

    await channel_service.create_message(
        db,
        workspace_id,
        channel.id,
        ChannelMessageCreate(
            role="system",
            author_type="system",
            author_name="Knotwork",
            content=(
                f"Knowledge change proposed for `{path}`.\n\n"
                f"Reason:\n{reason}\n\n"
                f"Proposed content:\n\n{proposed_content}"
            ),
            run_id=run_id or None,
            node_id=node_id or None,
            metadata={
                "kind": "knowledge_change_created",
                "discussion_kind": "review",
                "proposal_id": str(change.id),
                "path": path,
                "action_type": action_type,
                "target_type": target_type,
                "source_channel_id": str(source_channel_id) if source_channel_id else None,
            },
        ),
    )
    await channel_service.create_decision(
        db,
        workspace_id,
        channel.id,
        DecisionEventCreate(
            decision_type="knowledge_change",
            actor_type="agent" if agent_ref else "system",
            actor_name=agent_ref or "Knotwork",
            run_id=run_id or None,
            payload={
                "proposal_id": str(change.id),
                "path": path,
                "reason": reason,
                "proposed_content": proposed_content,
                "action_type": action_type,
                "target_type": target_type,
                "payload": payload or {},
                "source_channel_id": str(source_channel_id) if source_channel_id else None,
            },
        ),
    )

    if target_type == "file":
        existing = await knowledge_service.get_file_by_path(db, workspace_id, path)
        if existing is not None:
            project_id = existing.project_id
            change.project_id = existing.project_id
            try:
                await channel_service.attach_asset_to_channel(
                    db,
                    workspace_id,
                    channel.id,
                    asset_type="file",
                    asset_id=str(existing.id),
                )
            except ValueError:
                pass
    elif target_type == "folder":
        folder = await folder_service.create_folder(db, workspace_id, path)
        if folder is not None:
            project_id = folder.project_id
            change.project_id = folder.project_id
            try:
                await channel_service.attach_asset_to_channel(
                    db,
                    workspace_id,
                    channel.id,
                    asset_type="folder",
                    asset_id=str(folder.id),
                )
            except ValueError:
                pass

    await db.commit()
    await db.refresh(change)
    return change
