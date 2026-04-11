from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from libs.database import get_db
from libs.auth.backend.deps import get_current_user, get_workspace_member
from libs.auth.backend.models import User
from libs.participants import list_workspace_participants, member_participant_id, participant_kind
from modules.admin.backend.workspaces_models import WorkspaceMember

from . import channels_service as service
from . import notifications_service as notification_service
from .channels_models import Channel, ChannelSubscription
from .channels_schemas import (
    ChannelAssetBindingCreate,
    ChannelAssetBindingOut,
    ChannelCreate,
    ChannelUpdate,
    ChannelSubscriptionOut,
    ChannelSubscriptionUpdate,
    ChannelKnowledgeChangeResolveRequest,
    HandbookChatAskRequest,
    HandbookChatAskResponse,
    HandbookProposalResolveRequest,
    ChannelMessageCreate,
    ChannelMessageOut,
    ChannelOut,
    ChannelParticipantOut,
    DecisionEventCreate,
    DecisionEventOut,
    InboxItem,
    InboxStateUpdate,
    InboxSummary,
    ParticipantDeliveryPreferenceBundle,
    ParticipantDeliveryPreferenceOut,
    ParticipantDeliveryPreferenceUpdate,
    ParticipantMentionOption,
)


def _caller_participant_id(user: User, member: WorkspaceMember) -> str:
    """Return the participant_id for the calling workspace member."""
    return member_participant_id(member, user.id)


router = APIRouter(prefix="/workspaces", tags=["channels"])


async def _require_consultation_access(
    db: AsyncSession,
    workspace_id: UUID,
    channel: Channel,
    user: User,
    member: WorkspaceMember,
) -> None:
    if channel.channel_type != "consultation":
        return
    participant_id = _caller_participant_id(user, member)
    row = await db.execute(
        select(ChannelSubscription.id).where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id == channel.id,
            ChannelSubscription.participant_id == participant_id,
            ChannelSubscription.unsubscribed_at.is_(None),
        )
    )
    if row.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Channel not found")


@router.get("/{workspace_id}/channels", response_model=list[ChannelOut])
async def list_channels(
    workspace_id: UUID,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    rows = await service.list_channels(db, workspace_id)
    return [ChannelOut.model_validate(r) for r in rows]


@router.get("/{workspace_id}/participants", response_model=list[ParticipantMentionOption])
async def list_participants(
    workspace_id: UUID,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    rows = await list_workspace_participants(db, workspace_id)
    return [ParticipantMentionOption.model_validate(row) for row in rows]


@router.post("/{workspace_id}/channels", response_model=ChannelOut, status_code=201)
async def create_channel(
    workspace_id: UUID,
    data: ChannelCreate,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    try:
        ch = await service.create_channel(
            db,
            workspace_id,
            data,
            initial_participant_id=_caller_participant_id(user, member),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return ChannelOut.model_validate(ch)


@router.get("/{workspace_id}/channels/{channel_ref}", response_model=ChannelOut)
async def get_channel(
    workspace_id: UUID,
    channel_ref: str,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")
    await _require_consultation_access(db, workspace_id, ch, user, member)
    return ChannelOut.model_validate(ch)


@router.post("/{workspace_id}/objectives/{objective_id}/agentzero-consultation", response_model=ChannelOut, status_code=201)
async def get_objective_agentzero_consultation(
    workspace_id: UUID,
    objective_id: UUID,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    try:
        ch = await service.get_or_create_objective_agentzero_consultation(
            db,
            workspace_id,
            objective_id,
            requester_member=member,
            requester_user=user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return ChannelOut.model_validate(ch)


@router.post("/{workspace_id}/graphs/{graph_id}/agentzero-consultation", response_model=ChannelOut, status_code=201)
async def get_graph_agentzero_consultation(
    workspace_id: UUID,
    graph_id: UUID,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    try:
        ch = await service.get_or_create_graph_agentzero_consultation(
            db,
            workspace_id,
            graph_id,
            requester_member=member,
            requester_user=user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return ChannelOut.model_validate(ch)


@router.get("/{workspace_id}/channels/asset-chat/resolve", response_model=ChannelOut)
async def get_asset_chat_channel(
    workspace_id: UUID,
    asset_type: str = Query(...),
    path: str | None = Query(None),
    asset_id: str | None = Query(None),
    project_id: UUID | None = Query(None),
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    try:
        ch = await service.get_or_create_asset_chat_channel(
            db,
            workspace_id,
            asset_type=asset_type,
            path=path,
            asset_id=asset_id,
            project_id=project_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return ChannelOut.model_validate(ch)


@router.patch("/{workspace_id}/channels/{channel_ref}", response_model=ChannelOut)
async def update_channel(
    workspace_id: UUID,
    channel_ref: str,
    data: ChannelUpdate,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    try:
        ch = await service.update_channel(db, workspace_id, channel_ref, data)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not ch:
        raise HTTPException(404, "Channel not found")
    return ChannelOut.model_validate(ch)


@router.get("/{workspace_id}/channels/{channel_ref}/assets", response_model=list[ChannelAssetBindingOut])
async def get_channel_assets(
    workspace_id: UUID,
    channel_ref: str,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")
    rows = await service.list_channel_asset_bindings(db, workspace_id, ch.id)
    return [ChannelAssetBindingOut.model_validate(row) for row in rows]


@router.post("/{workspace_id}/channels/{channel_ref}/assets", response_model=ChannelAssetBindingOut, status_code=201)
async def attach_channel_asset(
    workspace_id: UUID,
    channel_ref: str,
    data: ChannelAssetBindingCreate,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")
    try:
        binding = await service.attach_asset_to_channel(
            db,
            workspace_id,
            ch.id,
            asset_type=data.asset_type,
            asset_id=data.asset_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    rows = await service.list_channel_asset_bindings(db, workspace_id, ch.id)
    row = next((item for item in rows if item["id"] == str(binding.id)), None)
    if row is None:
        raise HTTPException(500, "Attached asset could not be loaded")
    return ChannelAssetBindingOut.model_validate(row)


@router.delete("/{workspace_id}/channels/{channel_ref}/assets/{binding_id}", status_code=204)
async def remove_channel_asset(
    workspace_id: UUID,
    channel_ref: str,
    binding_id: UUID,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")
    try:
        await service.detach_asset_binding(db, workspace_id, ch.id, binding_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@router.get("/{workspace_id}/channels/{channel_ref}/messages", response_model=list[ChannelMessageOut])
async def list_messages(
    workspace_id: UUID,
    channel_ref: str,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")
    await _require_consultation_access(db, workspace_id, ch, user, member)
    rows = await service.list_messages(db, workspace_id, ch.id)
    return [ChannelMessageOut.model_validate(r) for r in rows]


@router.get("/{workspace_id}/channels/{channel_ref}/participants", response_model=list[ChannelParticipantOut])
async def list_channel_participants(
    workspace_id: UUID,
    channel_ref: str,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    try:
        rows = await service.list_channel_participants(db, workspace_id, ch.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return [ChannelParticipantOut.model_validate(row) for row in rows]


@router.patch("/{workspace_id}/channels/{channel_ref}/participants/{participant_id:path}", response_model=ChannelParticipantOut)
async def update_channel_participant(
    workspace_id: UUID,
    channel_ref: str,
    participant_id: str,
    data: ChannelSubscriptionUpdate,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    caller_participant_id = _caller_participant_id(user, member)
    if participant_id != caller_participant_id and not data.subscribed and member.role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can remove other channel participants")

    participants = await list_workspace_participants(db, workspace_id)
    if not any(row["participant_id"] == participant_id for row in participants):
        raise HTTPException(status_code=404, detail="Participant not found")

    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    try:
        await service.set_channel_subscription(
            db,
            workspace_id,
            ch.id,
            participant_id,
            subscribed=data.subscribed,
        )
        rows = await service.list_channel_participants(db, workspace_id, ch.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    row = next((item for item in rows if item["participant_id"] == participant_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="Participant not found")
    return ChannelParticipantOut.model_validate(row)


@router.post("/{workspace_id}/channels/{channel_ref}/messages", response_model=ChannelMessageOut, status_code=201)
async def create_message(
    workspace_id: UUID,
    channel_ref: str,
    data: ChannelMessageCreate,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")
    await _require_consultation_access(db, workspace_id, ch, user, member)
    payload_update = {
        "metadata": {
            **(data.metadata or {}),
            "author_participant_id": _caller_participant_id(user, member),
        },
    }
    if data.author_type == "human":
        payload_update["author_name"] = user.name
    payload = data.model_copy(update=payload_update)
    msg = await service.create_message(db, workspace_id, ch.id, payload)
    return ChannelMessageOut.model_validate(msg)


@router.get("/{workspace_id}/channels/{channel_ref}/decisions", response_model=list[DecisionEventOut])
async def list_decisions(
    workspace_id: UUID,
    channel_ref: str,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")
    await _require_consultation_access(db, workspace_id, ch, user, member)
    rows = await service.list_decisions(db, workspace_id, ch.id)
    return [DecisionEventOut.model_validate(r) for r in rows]


@router.post("/{workspace_id}/channels/{channel_ref}/decisions", response_model=DecisionEventOut, status_code=201)
async def create_decision(
    workspace_id: UUID,
    channel_ref: str,
    data: DecisionEventCreate,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")
    event = await service.create_decision(db, workspace_id, ch.id, data)
    return DecisionEventOut.model_validate(event)


@router.post(
    "/{workspace_id}/channels/{channel_ref}/handbook/ask",
    response_model=HandbookChatAskResponse,
)
async def ask_handbook_chat(
    workspace_id: UUID,
    channel_ref: str,
    body: HandbookChatAskRequest,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    from .handbook_agent import ask_handbook_agent

    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")
    if ch.channel_type != "handbook":
        raise HTTPException(400, "Channel is not a handbook channel")

    user_text = body.message.strip()
    if not user_text:
        raise HTTPException(400, "message is required")

    await service.create_message(
        db,
        workspace_id,
        ch.id,
        ChannelMessageCreate(
            role="user",
            author_type="human",
            author_name=user.name,
            content=user_text,
            metadata={
                "intent": "handbook_edit_request",
                "author_participant_id": _caller_participant_id(user, member),
            },
        ),
    )

    result = await ask_handbook_agent(db, workspace_id, user_text)

    await service.create_message(
        db,
        workspace_id,
        ch.id,
        ChannelMessageCreate(
            role="assistant",
            author_type="agent",
            author_name="Knotwork Agent",
            content=result["reply"],
            metadata={"source": "handbook_agent"},
        ),
    )

    proposal_id: str | None = None
    proposal = result.get("proposal")
    if isinstance(proposal, dict):
        proposal_id = str(proposal.get("proposal_id"))
        await service.create_decision(
            db,
            workspace_id,
            ch.id,
            DecisionEventCreate(
                decision_type="knowledge_change",
                actor_type="agent",
                actor_name="Knotwork Agent",
                payload=proposal,
            ),
        )
    else:
        await service.create_decision(
            db,
            workspace_id,
            ch.id,
            DecisionEventCreate(
                decision_type="handbook_change_requested",
                actor_type="human",
                actor_name=user.name,
                payload={"request": user_text},
            ),
        )

    return HandbookChatAskResponse(reply=result["reply"], proposal_id=proposal_id)


@router.post("/{workspace_id}/channels/{channel_ref}/handbook/proposals/{proposal_id}/resolve")
async def resolve_handbook_knowledge_change_legacy(
    workspace_id: UUID,
    channel_ref: str,
    proposal_id: str,
    body: HandbookProposalResolveRequest,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    return await resolve_knowledge_change(
        workspace_id=workspace_id,
        channel_ref=channel_ref,
        proposal_id=proposal_id,
        body=body,
        _member=_member,
        db=db,
    )


@router.post("/{workspace_id}/channels/{channel_ref}/knowledge/changes/{proposal_id}/resolve")
async def resolve_knowledge_change(
    workspace_id: UUID,
    channel_ref: str,
    proposal_id: str,
    body: HandbookProposalResolveRequest,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    from .channels_models import DecisionEvent
    from modules.assets.backend import knowledge_service

    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")
    if ch.channel_type != "handbook":
        raise HTTPException(400, "Channel is not a handbook channel")

    rows = await db.execute(
        select(DecisionEvent)
        .where(
            DecisionEvent.workspace_id == workspace_id,
            DecisionEvent.channel_id == ch.id,
            DecisionEvent.decision_type == "knowledge_change",
        )
        .order_by(DecisionEvent.created_at.desc())
    )
    target: DecisionEvent | None = None
    for event in rows.scalars():
        payload = event.payload or {}
        if str(payload.get("proposal_id")) == proposal_id:
            target = event
            break

    if not target:
        raise HTTPException(404, "Proposal not found")

    payload = dict(target.payload or {})
    if payload.get("status") != "pending":
        raise HTTPException(409, f"Proposal is already {payload.get('status')}")

    if body.resolution in ("accept_output", "override_output"):
        path = str(payload.get("path") or "").strip()
        content = (body.final_content or str(payload.get("proposed_content") or "")).strip()
        reason = str(payload.get("reason") or "Approved from handbook chat").strip()
        if not path or not content:
            raise HTTPException(400, "Proposal payload is invalid")

        existing = await knowledge_service.get_file_by_path(db, workspace_id, path)
        if existing:
            await knowledge_service.update_file(
                db,
                workspace_id,
                path,
                content,
                updated_by="handbook_chat",
                change_summary=f"Handbook chat: {reason[:80]}",
            )
        else:
            title = path.split("/")[-1].replace("-", " ").replace("_", " ").title()
            await knowledge_service.create_file(
                db,
                workspace_id,
                path,
                title,
                content,
                created_by="handbook_chat",
                change_summary=f"Handbook chat: {reason[:80]}",
            )
        payload["status"] = "approved"
        payload["final_content"] = content
    else:
        payload["status"] = "aborted"

    target.payload = payload
    await db.commit()
    await db.refresh(target)

    await service.create_message(
        db,
        workspace_id,
        ch.id,
        ChannelMessageCreate(
            role="assistant",
            author_type="agent",
            author_name="Knotwork Agent",
            content=(
                f"Proposal {proposal_id} approved and applied to {payload.get('path')}."
                if payload["status"] == "approved"
                else f"Proposal {proposal_id} was aborted."
            ),
            metadata={"source": "handbook_agent"},
        ),
    )

    return {"status": payload["status"], "proposal_id": proposal_id}


@router.post("/{workspace_id}/channels/{channel_ref}/knowledge/changes/{proposal_id}/review")
async def resolve_inline_knowledge_change(
    workspace_id: UUID,
    channel_ref: str,
    proposal_id: UUID,
    body: ChannelKnowledgeChangeResolveRequest,
    user: User = Depends(get_current_user),
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    from modules.assets.backend.knowledge_change_service import update_inline_proposal_message
    from modules.assets.backend.knowledge_models import KnowledgeChange
    from modules.assets.backend.knowledge_proposals_router import _apply_change

    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")

    change = await db.get(KnowledgeChange, proposal_id)
    if not change or change.workspace_id != workspace_id or change.channel_id != ch.id:
        raise HTTPException(404, "Knowledge change not found")
    if change.status != "pending":
        raise HTTPException(409, f"Knowledge change is already {change.status}")

    if body.resolution == "approve":
        await _apply_change(db, workspace_id, change, body.final_content)
        change.status = "approved"
        change.reviewed_at = datetime.now(timezone.utc)
        await update_inline_proposal_message(
            db,
            channel_id=ch.id,
            proposal_id=change.id,
            updates={
                "status": "approved",
                "final_content": body.final_content or change.proposed_content,
            },
        )
        await db.commit()
        await db.refresh(change)
        await service.create_message(
            db,
            workspace_id,
            ch.id,
            ChannelMessageCreate(
                role="system",
                author_type="system",
                author_name="Knotwork",
                content=f"Approved and applied the knowledge change for `{change.target_path}`.",
                metadata={
                    "kind": "knowledge_change_resolved",
                    "proposal_id": str(change.id),
                    "status": "approved",
                },
            ),
        )
        await db.commit()
        return {"status": "approved", "proposal_id": str(change.id)}

    comment = (body.comment or "").strip()
    if not comment:
        raise HTTPException(400, "comment is required when requesting an edit")
    change.status = "needs_revision"
    change.reviewed_at = datetime.now(timezone.utc)
    await update_inline_proposal_message(
        db,
        channel_id=ch.id,
        proposal_id=change.id,
        updates={
            "status": "needs_revision",
            "revision_request_comment": comment,
            "revision_requested_by": user.name,
        },
    )
    await db.commit()
    await db.refresh(change)
    await service.create_message(
        db,
        workspace_id,
        ch.id,
        ChannelMessageCreate(
            role="user",
            author_type="human",
            author_name=user.name,
            content=comment,
            metadata={
                "kind": "knowledge_change_revision_requested",
                "proposal_id": str(change.id),
                "path": change.target_path,
            },
        ),
    )
    await db.commit()
    return {"status": "needs_revision", "proposal_id": str(change.id)}


@router.get("/{workspace_id}/inbox", response_model=list[InboxItem])
async def get_inbox(
    workspace_id: UUID,
    archived: bool = Query(False),
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    participant_id = _caller_participant_id(user, member)
    rows = await service.inbox_items(db, workspace_id, participant_id, archived=archived)
    return [InboxItem.model_validate(r) for r in rows]


@router.get("/{workspace_id}/inbox/summary", response_model=InboxSummary)
async def get_inbox_summary(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    summary = await service.inbox_summary(db, workspace_id, _caller_participant_id(user, member))
    return InboxSummary.model_validate(summary)


@router.post("/{workspace_id}/inbox/read-all", response_model=InboxSummary)
async def mark_inbox_read_all(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    participant_id = _caller_participant_id(user, member)
    await notification_service.mark_all_app_deliveries_read(
        db,
        workspace_id=workspace_id,
        participant_id=participant_id,
    )
    summary = await service.inbox_summary(db, workspace_id, participant_id)
    return InboxSummary.model_validate(summary)


@router.patch("/{workspace_id}/inbox/deliveries/{delivery_id}", response_model=InboxItem)
async def update_inbox_delivery_state(
    workspace_id: UUID,
    delivery_id: UUID,
    data: InboxStateUpdate,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    participant_id = _caller_participant_id(user, member)
    delivery = await notification_service.update_delivery_state(
        db,
        workspace_id=workspace_id,
        participant_id=participant_id,
        delivery_id=delivery_id,
        read=data.read,
        archived=data.archived,
    )
    if delivery is None:
        raise HTTPException(status_code=404, detail="Inbox delivery not found")
    row = await service.inbox_item_by_delivery_id(
        db,
        workspace_id=workspace_id,
        participant_id=participant_id,
        delivery_id=delivery.id,
    )
    if row is not None:
        return InboxItem.model_validate(row)
    raise HTTPException(status_code=404, detail="Inbox item not found")


@router.get("/{workspace_id}/channels/subscriptions/me", response_model=list[ChannelSubscriptionOut])
async def get_my_channel_subscriptions(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    rows = await service.list_channel_subscriptions(db, workspace_id, _caller_participant_id(user, member))
    return [
        ChannelSubscriptionOut(
            channel_id=row.channel_id,
            participant_id=row.participant_id,
            subscribed=row.unsubscribed_at is None,
            subscribed_at=row.subscribed_at,
            unsubscribed_at=row.unsubscribed_at,
        )
        for row in rows
    ]


@router.patch("/{workspace_id}/channels/{channel_ref}/subscription", response_model=ChannelSubscriptionOut)
async def update_my_channel_subscription(
    workspace_id: UUID,
    channel_ref: str,
    data: ChannelSubscriptionUpdate,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    try:
        row = await service.set_channel_subscription(
            db,
            workspace_id,
            ch.id,
            _caller_participant_id(user, member),
            subscribed=data.subscribed,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return ChannelSubscriptionOut(
        channel_id=row.channel_id,
        participant_id=row.participant_id,
        subscribed=row.unsubscribed_at is None,
        subscribed_at=row.subscribed_at,
        unsubscribed_at=row.unsubscribed_at,
    )


@router.get("/{workspace_id}/participants/{participant_id}/delivery-preferences", response_model=ParticipantDeliveryPreferenceBundle)
async def get_participant_delivery_preferences(
    workspace_id: UUID,
    participant_id: str,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    current_participant_id = _caller_participant_id(user, member)
    if member.role != "owner" and participant_id != current_participant_id:
        raise HTTPException(status_code=403, detail="Only owners can inspect other participants")
    participants = await list_workspace_participants(db, workspace_id)
    participant = next((row for row in participants if row["participant_id"] == participant_id), None)
    if participant is None:
        raise HTTPException(status_code=404, detail="Participant not found")
    prefs = await notification_service.get_or_build_participant_preferences(db, workspace_id, participant_id)
    return ParticipantDeliveryPreferenceBundle(
        participant_id=participant_id,
        kind=participant_kind(participant_id),  # type: ignore[arg-type]
        display_name=str(participant.get("display_name") or participant_id),
        event_types=[ParticipantDeliveryPreferenceOut.model_validate(pref) for pref in prefs],
    )


@router.patch("/{workspace_id}/participants/{participant_id}/delivery-preferences/{event_type}", response_model=ParticipantDeliveryPreferenceOut)
async def update_participant_delivery_preference(
    workspace_id: UUID,
    participant_id: str,
    event_type: str,
    data: ParticipantDeliveryPreferenceUpdate,
    user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    current_participant_id = _caller_participant_id(user, member)
    if member.role != "owner" and participant_id != current_participant_id:
        raise HTTPException(status_code=403, detail="Only owners can update other participants")
    pref = await notification_service.update_participant_preference(
        db,
        workspace_id=workspace_id,
        participant_id=participant_id,
        event_type=event_type,
        app_enabled=data.app_enabled,
        email_enabled=data.email_enabled,
        push_enabled=data.push_enabled,
        email_address=data.email_address,
    )
    return ParticipantDeliveryPreferenceOut.model_validate(pref)
