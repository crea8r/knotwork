from __future__ import annotations

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from uuid import uuid4

from sqlalchemy import select


async def _create_user_and_member(db, workspace, *, email: str, name: str, role: str = "operator"):
    from knotwork.auth.models import User
    from knotwork.workspaces.models import WorkspaceMember

    user = User(email=email, name=name, hashed_password="!test")
    db.add(user)
    await db.flush()
    member = WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=role)
    db.add(member)
    await db.commit()
    await db.refresh(user)
    await db.refresh(member)
    return user, member


async def test_message_mention_creates_participant_scoped_inbox_item(db, workspace):
    from knotwork.channels.models import Channel
    from knotwork.channels.schemas import ChannelMessageCreate
    from knotwork.channels.service import create_message, inbox_items
    from knotwork.notifications.models import EventDelivery
    from knotwork.participants import human_participant_id

    author, _ = await _create_user_and_member(db, workspace, email="alice@example.com", name="Alice Example")
    mentioned, _ = await _create_user_and_member(db, workspace, email="bob@example.com", name="Bob Example")

    channel = Channel(workspace_id=workspace.id, name="general", channel_type="normal")
    db.add(channel)
    await db.commit()
    await db.refresh(channel)

    await create_message(
        db,
        workspace_id=workspace.id,
        channel_id=channel.id,
        data=ChannelMessageCreate(
            role="user",
            author_type="human",
            author_name=author.name,
            content="Need a review from @bob",
            metadata={"author_participant_id": human_participant_id(author.id)},
        ),
    )

    deliveries = list(
        (
            await db.execute(
                select(EventDelivery).where(
                    EventDelivery.participant_id == human_participant_id(mentioned.id),
                    EventDelivery.delivery_mean == "app",
                    EventDelivery.status == "sent",
                )
            )
        ).scalars()
    )
    assert len(deliveries) == 1

    inbox = await inbox_items(db, workspace.id, human_participant_id(mentioned.id))
    assert any(item["item_type"] == "mentioned_message" for item in inbox)
    assert not any(item["item_type"] == "mentioned_message" for item in await inbox_items(db, workspace.id, human_participant_id(author.id)))


async def test_addressed_escalation_only_reaches_target_participant(db, workspace):
    from knotwork.channels.models import Channel
    from knotwork.channels.service import inbox_items
    from knotwork.escalations.service import create_escalation
    from knotwork.notifications.models import EventDelivery
    from knotwork.participants import human_participant_id
    from knotwork.graphs.models import Graph
    from knotwork.runs.models import Run, RunNodeState

    owner, _ = await _create_user_and_member(db, workspace, email="owner@example.com", name="Owner", role="owner")
    target, _ = await _create_user_and_member(db, workspace, email="reviewer@example.com", name="Reviewer")

    graph = Graph(workspace_id=workspace.id, name="Review Flow", path="")
    db.add(graph)
    await db.flush()
    channel = Channel(workspace_id=workspace.id, name="wf: Review Flow", channel_type="workflow", graph_id=graph.id)
    db.add(channel)
    await db.flush()
    run = Run(workspace_id=workspace.id, graph_id=graph.id, graph_version_id=None, status="paused", input={})
    db.add(run)
    await db.flush()
    node_state = RunNodeState(run_id=run.id, node_id="review", status="paused")
    db.add(node_state)
    await db.commit()

    await create_escalation(
        db,
        run_id=run.id,
        run_node_state_id=node_state.id,
        workspace_id=workspace.id,
        type="human_checkpoint",
        context={
            "node_id": "review",
            "reason": "Need reviewer sign-off",
            "participant_id": human_participant_id(target.id),
        },
    )

    deliveries = list((await db.execute(select(EventDelivery))).scalars())
    assert len([d for d in deliveries if d.participant_id == human_participant_id(target.id) and d.delivery_mean == "app"]) == 1
    assert len([d for d in deliveries if d.participant_id == human_participant_id(owner.id) and d.delivery_mean == "app"]) == 0

    target_inbox = await inbox_items(db, workspace.id, human_participant_id(target.id))
    owner_inbox = await inbox_items(db, workspace.id, human_participant_id(owner.id))
    assert any(item["item_type"] == "escalation" for item in target_inbox)
    assert not any(item["item_type"] == "escalation" for item in owner_inbox)


async def test_unaddressed_escalation_falls_back_to_all_human_participants(db, workspace):
    from knotwork.channels.models import Channel
    from knotwork.escalations.service import create_escalation
    from knotwork.notifications.models import EventDelivery
    from knotwork.participants import human_participant_id
    from knotwork.graphs.models import Graph
    from knotwork.runs.models import Run, RunNodeState

    alice, _ = await _create_user_and_member(db, workspace, email="alice2@example.com", name="Alice Two")
    bob, _ = await _create_user_and_member(db, workspace, email="bob2@example.com", name="Bob Two")

    graph = Graph(workspace_id=workspace.id, name="Fallback Flow", path="")
    db.add(graph)
    await db.flush()
    channel = Channel(workspace_id=workspace.id, name="wf: Fallback Flow", channel_type="workflow", graph_id=graph.id)
    db.add(channel)
    await db.flush()
    run = Run(workspace_id=workspace.id, graph_id=graph.id, graph_version_id=None, status="paused", input={})
    db.add(run)
    await db.flush()
    node_state = RunNodeState(run_id=run.id, node_id="gate", status="paused")
    db.add(node_state)
    await db.commit()

    await create_escalation(
        db,
        run_id=run.id,
        run_node_state_id=node_state.id,
        workspace_id=workspace.id,
        type="human_checkpoint",
        context={"node_id": "gate", "reason": "Fallback review"},
    )

    deliveries = list((await db.execute(select(EventDelivery))).scalars())
    human_app_deliveries = {
        d.participant_id
        for d in deliveries
        if d.delivery_mean == "app" and d.status == "sent"
    }
    assert human_participant_id(alice.id) in human_app_deliveries
    assert human_participant_id(bob.id) in human_app_deliveries


async def test_unaddressed_escalation_prefers_subscribed_humans_in_channel(db, workspace):
    from knotwork.channels.models import Channel
    from knotwork.channels.service import set_channel_subscription
    from knotwork.escalations.service import create_escalation
    from knotwork.notifications.models import EventDelivery
    from knotwork.participants import human_participant_id
    from knotwork.graphs.models import Graph
    from knotwork.runs.models import Run, RunNodeState

    alice, _ = await _create_user_and_member(db, workspace, email="sub-a@example.com", name="Sub Alice")
    bob, _ = await _create_user_and_member(db, workspace, email="sub-b@example.com", name="Sub Bob")

    graph = Graph(workspace_id=workspace.id, name="Scoped Flow", path="")
    db.add(graph)
    await db.flush()
    channel = Channel(workspace_id=workspace.id, name="wf: Scoped Flow", channel_type="workflow", graph_id=graph.id)
    db.add(channel)
    await db.flush()
    run = Run(workspace_id=workspace.id, graph_id=graph.id, graph_version_id=None, status="paused", input={})
    db.add(run)
    await db.flush()
    node_state = RunNodeState(run_id=run.id, node_id="gate", status="paused")
    db.add(node_state)
    await db.commit()

    await set_channel_subscription(db, workspace.id, channel.id, human_participant_id(bob.id), subscribed=False)

    await create_escalation(
        db,
        run_id=run.id,
        run_node_state_id=node_state.id,
        workspace_id=workspace.id,
        type="human_checkpoint",
        context={"node_id": "gate", "reason": "Scoped review"},
    )

    deliveries = list((await db.execute(select(EventDelivery))).scalars())
    human_app_deliveries = {
        d.participant_id
        for d in deliveries
        if d.delivery_mean == "app" and d.status == "sent"
    }
    assert human_participant_id(alice.id) in human_app_deliveries
    assert human_participant_id(bob.id) not in human_app_deliveries


async def test_invitation_requires_workspace_email_config(db, workspace):
    from knotwork.workspaces.invitations.schemas import CreateInvitationRequest
    from knotwork.workspaces.invitations.service import create_invitation

    owner, _ = await _create_user_and_member(db, workspace, email="owner2@example.com", name="Owner Two", role="owner")

    try:
        await create_invitation(
            db,
            workspace_id=workspace.id,
            invited_by_user_id=owner.id,
            req=CreateInvitationRequest(email="new-user@example.com", role="operator"),
        )
    except HTTPException as exc:
        assert exc.status_code == 409
        assert exc.detail == "Invitations require workspace email configuration."
    else:
        raise AssertionError("Expected invitation creation to require workspace email config")


async def test_invitation_uses_workspace_resend_config(db, workspace, monkeypatch):
    from knotwork.workspaces.invitations.schemas import CreateInvitationRequest
    from knotwork.workspaces.invitations.service import create_invitation

    owner, _ = await _create_user_and_member(db, workspace, email="owner3@example.com", name="Owner Three", role="owner")
    workspace.resend_api_key = "re_workspace_test"
    workspace.email_from = "workspace@example.com"
    await db.commit()

    captured: dict = {}

    async def _send_ok(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr("knotwork.workspaces.invitations.service.send_email", _send_ok)

    invite = await create_invitation(
        db,
        workspace_id=workspace.id,
        invited_by_user_id=owner.id,
        req=CreateInvitationRequest(email="invitee@example.com", role="operator"),
    )

    assert invite.email == "invitee@example.com"
    assert captured["to_address"] == "invitee@example.com"
    assert captured["from_address"] == "workspace@example.com"
    assert captured["api_key"] == "re_workspace_test"


async def test_email_delivery_is_throttled_per_channel_event_type(db, workspace, monkeypatch):
    from knotwork.channels.models import Channel
    from knotwork.channels.schemas import ChannelMessageCreate
    from knotwork.channels.service import create_message
    from knotwork.notifications.models import EventDelivery
    from knotwork.participants import human_participant_id

    author, _ = await _create_user_and_member(db, workspace, email="throttle-author@example.com", name="Throttle Author")
    target, _ = await _create_user_and_member(db, workspace, email="throttle-target@example.com", name="Throttle Target")
    workspace.resend_api_key = "re_workspace_test"
    workspace.email_from = "workspace@example.com"
    await db.commit()

    sent_calls: list[dict] = []

    async def _send_ok(**kwargs):
        sent_calls.append(kwargs)

    monkeypatch.setattr("knotwork.notifications.channels.email.send", _send_ok)

    from knotwork.notifications.service import update_participant_preference

    await update_participant_preference(
        db,
        workspace.id,
        human_participant_id(target.id),
        "mentioned_message",
        email_enabled=True,
    )

    channel = Channel(workspace_id=workspace.id, name="throttle-channel", channel_type="normal")
    db.add(channel)
    await db.commit()
    await db.refresh(channel)

    for body in ("First @throttle-target", "Second @throttle-target"):
        await create_message(
            db,
            workspace_id=workspace.id,
            channel_id=channel.id,
            data=ChannelMessageCreate(
                role="user",
                author_type="human",
                author_name=author.name,
                content=body,
                metadata={"author_participant_id": human_participant_id(author.id)},
            ),
        )

    email_deliveries = list(
        (
            await db.execute(
                select(EventDelivery).where(
                    EventDelivery.participant_id == human_participant_id(target.id),
                    EventDelivery.delivery_mean == "email",
                )
            )
        ).scalars()
    )
    assert len(sent_calls) == 1
    assert len(email_deliveries) == 2
    assert {delivery.status for delivery in email_deliveries} == {"sent", "skipped"}


async def test_localhost_auth_prefers_valid_jwt_over_default_account(db, workspace, monkeypatch):
    from knotwork.auth.deps import get_current_user
    from knotwork.auth.service import create_access_token
    from knotwork.config import settings

    default_user, _ = await _create_user_and_member(db, workspace, email="default@example.com", name="Default User")
    switched_user, _ = await _create_user_and_member(db, workspace, email="switched@example.com", name="Switched User")

    monkeypatch.setattr(settings, "frontend_url", "http://localhost:3100")
    monkeypatch.setattr(settings, "auth_dev_bypass_user_id", str(default_user.id))

    creds = HTTPAuthorizationCredentials(
        scheme="Bearer",
        credentials=create_access_token(switched_user.id),
    )

    current = await get_current_user(creds=creds, db=db)
    assert current.id == switched_user.id


async def test_localhost_auth_falls_back_to_default_account_on_invalid_token(db, workspace, monkeypatch):
    from knotwork.auth.deps import get_current_user
    from knotwork.config import settings

    default_user, _ = await _create_user_and_member(db, workspace, email="default2@example.com", name="Default Two")

    monkeypatch.setattr(settings, "frontend_url", "http://localhost:3100")
    monkeypatch.setattr(settings, "auth_dev_bypass_user_id", str(default_user.id))

    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="not-a-real-token")
    current = await get_current_user(creds=creds, db=db)
    assert current.id == default_user.id


async def test_inbox_summary_and_archive_state(db, workspace):
    from knotwork.channels.models import Channel
    from knotwork.channels.schemas import ChannelMessageCreate
    from knotwork.channels.service import create_message, inbox_items, inbox_summary
    from knotwork.notifications.models import EventDelivery
    from knotwork.notifications.service import update_delivery_state
    from knotwork.participants import human_participant_id

    author, _ = await _create_user_and_member(db, workspace, email="arch-author@example.com", name="Arch Author")
    mentioned, _ = await _create_user_and_member(db, workspace, email="arch-target@example.com", name="Arch Target")

    channel = Channel(workspace_id=workspace.id, name="archive-test", channel_type="normal")
    db.add(channel)
    await db.commit()
    await db.refresh(channel)

    await create_message(
        db,
        workspace_id=workspace.id,
        channel_id=channel.id,
        data=ChannelMessageCreate(
            role="user",
            author_type="human",
            author_name=author.name,
            content="Review this @arch-target",
            metadata={"author_participant_id": human_participant_id(author.id)},
        ),
    )

    delivery = (
        await db.execute(
            select(EventDelivery).where(
                EventDelivery.participant_id == human_participant_id(mentioned.id),
                EventDelivery.delivery_mean == "app",
            )
        )
    ).scalar_one()

    summary = await inbox_summary(db, workspace.id, human_participant_id(mentioned.id))
    assert summary["unread_count"] == 1
    assert summary["active_count"] == 1
    assert summary["archived_count"] == 0

    await update_delivery_state(
        db,
        workspace_id=workspace.id,
        participant_id=human_participant_id(mentioned.id),
        delivery_id=delivery.id,
        archived=True,
    )

    active_items = await inbox_items(db, workspace.id, human_participant_id(mentioned.id), archived=False)
    archived_items = await inbox_items(db, workspace.id, human_participant_id(mentioned.id), archived=True)
    assert active_items == []
    assert len(archived_items) == 1
    assert archived_items[0]["archived_at"] is not None


async def test_participant_preferences_and_channel_subscriptions(db, workspace):
    from knotwork.channels.models import Channel
    from knotwork.channels.service import list_channel_subscriptions, set_channel_subscription
    from knotwork.notifications.service import get_or_build_participant_preferences, update_participant_preference
    from knotwork.participants import human_participant_id

    user, _ = await _create_user_and_member(db, workspace, email="prefs@example.com", name="Prefs User")

    channel = Channel(workspace_id=workspace.id, name="prefs-channel", channel_type="normal")
    db.add(channel)
    await db.commit()
    await db.refresh(channel)

    prefs = await get_or_build_participant_preferences(db, workspace.id, human_participant_id(user.id))
    mention_pref = next(pref for pref in prefs if pref["event_type"] == "mentioned_message")
    assert mention_pref["app_enabled"] is True
    assert mention_pref["plugin_enabled"] is False

    updated = await update_participant_preference(
        db,
        workspace.id,
        human_participant_id(user.id),
        "mentioned_message",
        email_enabled=True,
        email_address="prefs@example.com",
    )
    assert updated.email_enabled is True
    assert updated.email_address == "prefs@example.com"

    subs_before = await list_channel_subscriptions(db, workspace.id, human_participant_id(user.id))
    assert any(sub.channel_id == channel.id and sub.unsubscribed_at is None for sub in subs_before)

    sub = await set_channel_subscription(
        db,
        workspace.id,
        channel.id,
        human_participant_id(user.id),
        subscribed=False,
    )
    assert sub.unsubscribed_at is not None


async def test_unfollowed_channel_stops_channel_deliveries(db, workspace):
    from knotwork.channels.models import Channel
    from knotwork.channels.schemas import ChannelMessageCreate
    from knotwork.channels.service import create_message, set_channel_subscription, inbox_items
    from knotwork.notifications.models import EventDelivery
    from knotwork.participants import human_participant_id

    author, _ = await _create_user_and_member(db, workspace, email="mute-author@example.com", name="Mute Author")
    target, _ = await _create_user_and_member(db, workspace, email="mute-target@example.com", name="Mute Target")

    channel = Channel(workspace_id=workspace.id, name="mute-channel", channel_type="normal")
    db.add(channel)
    await db.commit()
    await db.refresh(channel)

    await set_channel_subscription(
        db,
        workspace.id,
        channel.id,
        human_participant_id(target.id),
        subscribed=False,
    )

    await create_message(
        db,
        workspace_id=workspace.id,
        channel_id=channel.id,
        data=ChannelMessageCreate(
            role="user",
            author_type="human",
            author_name=author.name,
            content="Hello @mute-target",
            metadata={"author_participant_id": human_participant_id(author.id)},
        ),
    )

    deliveries = list(
        (
            await db.execute(
                select(EventDelivery).where(
                    EventDelivery.participant_id == human_participant_id(target.id),
                    EventDelivery.delivery_mean == "app",
                )
            )
        ).scalars()
    )
    assert deliveries == []
    inbox = await inbox_items(db, workspace.id, human_participant_id(target.id))
    assert inbox == []



async def test_attaching_completed_run_is_rejected(db, workspace):
    from knotwork.channels.models import Channel
    from knotwork.channels.service import attach_asset_to_channel
    from knotwork.runs.models import Run

    channel = Channel(workspace_id=workspace.id, name="assets", channel_type="normal")
    db.add(channel)
    await db.flush()
    run = Run(workspace_id=workspace.id, graph_id=uuid4(), graph_version_id=None, status="completed", input={})
    db.add(run)
    await db.commit()

    try:
        await attach_asset_to_channel(db, workspace.id, channel.id, asset_type="run", asset_id=str(run.id))
    except ValueError as exc:
        assert str(exc) == "Completed or failed runs cannot be attached"
    else:
        raise AssertionError("Expected terminal runs to be rejected")


async def test_workflow_binding_auto_attaches_new_runs(db, workspace):
    from datetime import datetime, timezone

    from knotwork.channels.models import Channel
    from knotwork.channels.service import attach_asset_to_channel, list_channel_asset_bindings, list_messages
    from knotwork.graphs.models import Graph, GraphVersion
    from knotwork.runs.schemas import RunCreate
    from knotwork.runs.service import create_run

    graph = Graph(workspace_id=workspace.id, name="Asset Flow", path="asset-flow")
    db.add(graph)
    await db.flush()
    version = GraphVersion(
        graph_id=graph.id,
        definition={
            "nodes": [
                {"id": "start", "type": "start", "name": "Start", "config": {}},
                {"id": "end", "type": "end", "name": "End", "config": {}},
            ],
            "edges": [{"id": "e1", "source": "start", "target": "end", "type": "direct"}],
            "entry_point": "start",
        },
        version_id="v00000001",
        version_name="first-pass",
        version_created_at=datetime.now(timezone.utc),
    )
    db.add(version)
    channel = Channel(workspace_id=workspace.id, name="ops-chat", channel_type="normal")
    db.add(channel)
    await db.commit()

    await attach_asset_to_channel(db, workspace.id, channel.id, asset_type="workflow", asset_id=str(graph.id))
    run = await create_run(db, workspace.id, graph.id, RunCreate(name="Asset Run", input={}))

    bindings = await list_channel_asset_bindings(db, workspace.id, channel.id)
    assert any(binding["asset_type"] == "workflow" and binding["asset_id"] == str(graph.id) for binding in bindings)
    assert any(binding["asset_type"] == "run" and binding["asset_id"] == str(run.id) for binding in bindings)

    messages = await list_messages(db, workspace.id, channel.id)
    assert any("New run created from attached workflow" in message.content for message in messages)


async def test_file_binding_emits_channel_message_on_update(db, workspace, monkeypatch, tmp_path):
    from knotwork.channels.models import Channel
    from knotwork.channels.service import attach_asset_to_channel, list_messages
    from knotwork.knowledge.service import create_file, update_file
    from knotwork.knowledge.storage.local_fs import LocalFSAdapter

    monkeypatch.setattr("knotwork.knowledge.service.get_storage_adapter", lambda: LocalFSAdapter(tmp_path / "knowledge"))

    channel = Channel(workspace_id=workspace.id, name="docs-chat", channel_type="normal")
    db.add(channel)
    await db.commit()
    await db.refresh(channel)

    file = await create_file(
        db,
        workspace.id,
        path="docs/spec.md",
        title="Spec",
        content="# Spec\n",
        created_by="tester",
    )
    await attach_asset_to_channel(db, workspace.id, channel.id, asset_type="file", asset_id=str(file.id))
    await update_file(
        db,
        workspace.id,
        path="docs/spec.md",
        content="# Spec\nUpdated\n",
        updated_by="tester",
    )

    messages = await list_messages(db, workspace.id, channel.id)
    assert any(message.content == f"File modified: {file.path}" for message in messages)
