from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.deps import get_current_user, get_workspace_member
from knotwork.auth.models import User
from knotwork.channels import service
from knotwork.channels.schemas import (
    ChannelAssetBindingCreate,
    ChannelAssetBindingOut,
    ChannelCreate,
    ChannelUpdate,
    ChannelSubscriptionOut,
    ChannelSubscriptionUpdate,
    HandbookChatAskRequest,
    HandbookChatAskResponse,
    HandbookProposalResolveRequest,
    ChannelMessageCreate,
    ChannelMessageOut,
    ChannelOut,
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
from knotwork.database import get_db
from knotwork.notifications import service as notification_service
from knotwork.participants import list_workspace_participants, member_participant_id, participant_kind


def _caller_participant_id(user: User, member: WorkspaceMember) -> str:
    """Return the participant_id for the calling workspace member."""
    return member_participant_id(member, user.id)
from knotwork.workspaces.models import WorkspaceMember


router = APIRouter(prefix="/workspaces", tags=["channels"])


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
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    try:
        ch = await service.create_channel(db, workspace_id, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return ChannelOut.model_validate(ch)


@router.get("/{workspace_id}/channels/{channel_ref}", response_model=ChannelOut)
async def get_channel(
    workspace_id: UUID,
    channel_ref: str,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")
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
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")
    rows = await service.list_messages(db, workspace_id, ch.id)
    return [ChannelMessageOut.model_validate(r) for r in rows]


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
    payload = data
    if data.author_type == "human":
        payload = data.model_copy(
            update={
                "author_name": user.name,
                "metadata": {
                    **(data.metadata or {}),
                    "author_participant_id": _caller_participant_id(user, member),
                },
            }
        )
    msg = await service.create_message(db, workspace_id, ch.id, payload)
    return ChannelMessageOut.model_validate(msg)


@router.get("/{workspace_id}/channels/{channel_ref}/decisions", response_model=list[DecisionEventOut])
async def list_decisions(
    workspace_id: UUID,
    channel_ref: str,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_ref)
    if not ch:
        raise HTTPException(404, "Channel not found")
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
    from knotwork.channels.handbook_agent import ask_handbook_agent

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
    from knotwork.channels.models import DecisionEvent
    from knotwork.knowledge import service as knowledge_service

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
    rows = await service.inbox_items(
        db,
        workspace_id,
        participant_id,
        archived=delivery.archived_at is not None,
    )
    for row in rows:
        if row.get("delivery_id") == str(delivery.id):
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
