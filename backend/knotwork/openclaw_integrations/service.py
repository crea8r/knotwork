from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.openclaw_integrations.models import (
    OpenClawExecutionEvent,
    OpenClawExecutionTask,
    OpenClawHandshakeToken,
    OpenClawIntegration,
    OpenClawRemoteAgent,
)
from knotwork.openclaw_integrations.schemas import (
    HandshakeTokenCreateRequest,
    OpenClawDebugStateOut,
    OpenClawIntegrationDeleteOut,
    OpenClawIntegrationDebugState,
    HandshakeTokenOut,
    OpenClawTaskDebugItem,
    OpenClawIntegrationOut,
    OpenClawRemoteAgentOut,
    PluginHandshakeRequest,
    PluginHandshakeResponse,
    RegisterFromOpenClawRequest,
    RegisterFromOpenClawResponse,
)
from knotwork.workspaces.models import Workspace
from knotwork.registered_agents.models import RegisteredAgent

SESSION_EXECUTION_CONTRACT_OPERATIONS = ("create_session", "send_message", "sync_session")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_secret(prefix: str = "kwoc") -> str:
    return f"{prefix}_{secrets.token_urlsafe(24)}"


def _agent_session_name(
    agent_ref: str,
    run_id: UUID | None = None,
    mode: str = "run",
    workspace_id: UUID | None = None,
    agent_key: str | None = None,
    node_id: str | None = None,
) -> str:
    """
    Canonical OpenClaw session naming:
    - Main chat: knotwork:[agent-key]:[workspace-id]:main
    - Run chat:  knotwork:[agent-key]:[workspace-id]:run:[run_id]
    """
    agent_name = (agent_ref or "openclaw:agent").removeprefix("openclaw:")
    agent_part = (agent_key or agent_name or "agent").strip()
    if mode == "main":
        ws = str(workspace_id) if workspace_id is not None else "unknown-workspace"
        return f"knotwork:{agent_part}:{ws}:main"
    if mode == "handbook":
        ws = str(workspace_id) if workspace_id is not None else "unknown-workspace"
        return f"knotwork:{agent_part}:{ws}:handbook"
    run_part = str(run_id) if run_id is not None else "unknown"
    ws = str(workspace_id) if workspace_id is not None else "unknown-workspace"
    if run_part != "unknown":
        return f"knotwork:{agent_part}:{ws}:run:{run_part}"
    node_part = (node_id or "unknown-node").strip()
    return f"knotwork:{agent_part}:{ws}:node:{node_part}"


async def create_handshake_token(
    db: AsyncSession,
    workspace_id: UUID,
    req: HandshakeTokenCreateRequest,
) -> HandshakeTokenOut:
    _ = req
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    token = f"kw_oc_{secrets.token_urlsafe(24)}"
    # Temporary policy: fixed 1-year token lifetime.
    # Security hardening/rotation policy will be revisited in a later session.
    expires_at = _now() + timedelta(days=365)
    row = OpenClawHandshakeToken(
        id=uuid4(),
        workspace_id=workspace_id,
        token=token,
        expires_at=expires_at,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Handshake token could not be created.") from exc
    except (OperationalError, ProgrammingError) as exc:
        await db.rollback()
        raise HTTPException(
            status_code=503,
            detail="OpenClaw token storage is not initialized. Run migrations and restart backend.",
        ) from exc
    return HandshakeTokenOut(workspace_id=workspace_id, token=token, expires_at=expires_at)


async def plugin_handshake(
    db: AsyncSession,
    req: PluginHandshakeRequest,
) -> PluginHandshakeResponse:
    token_row = await db.execute(
        select(OpenClawHandshakeToken).where(OpenClawHandshakeToken.token == req.token)
    )
    token = token_row.scalar_one_or_none()
    if token is None:
        raise HTTPException(status_code=401, detail="Invalid handshake token")
    now = _now()
    # Timezone-safe: SQLite may return naive datetimes even for timezone=True columns.
    expires_at = token.expires_at
    cmp_now = now if expires_at.tzinfo is not None else now.replace(tzinfo=None)
    if expires_at < cmp_now:
        raise HTTPException(status_code=401, detail="Handshake token expired")

    integration_q = await db.execute(
        select(OpenClawIntegration).where(
            and_(
                OpenClawIntegration.workspace_id == token.workspace_id,
                OpenClawIntegration.plugin_instance_id == req.plugin_instance_id,
            )
        )
    )
    integration = integration_q.scalar_one_or_none()

    # Allow token reuse only for the same workspace+plugin_instance pair after first link.
    if token.used_at is not None and integration is None:
        raise HTTPException(status_code=409, detail="Handshake token already used")

    if integration is None:
        integration = OpenClawIntegration(
            id=uuid4(),
            workspace_id=token.workspace_id,
            plugin_instance_id=req.plugin_instance_id,
            openclaw_workspace_id=req.openclaw_workspace_id,
            plugin_version=req.plugin_version,
            integration_secret=_new_secret(),
            status="connected",
            connected_at=now,
            last_seen_at=now,
            metadata_json=req.metadata or {},
            updated_at=now,
        )
        db.add(integration)
        await db.flush()
    else:
        integration.openclaw_workspace_id = req.openclaw_workspace_id
        integration.plugin_version = req.plugin_version
        integration.status = "connected"
        integration.last_seen_at = now
        integration.metadata_json = req.metadata or integration.metadata_json
        integration.updated_at = now

    # upsert remote agents snapshot
    synced = 0
    for ra in req.agents:
        existing_q = await db.execute(
            select(OpenClawRemoteAgent).where(
                and_(
                    OpenClawRemoteAgent.workspace_id == token.workspace_id,
                    OpenClawRemoteAgent.integration_id == integration.id,
                    OpenClawRemoteAgent.remote_agent_id == ra.remote_agent_id,
                )
            )
        )
        existing = existing_q.scalar_one_or_none()
        if existing is None:
            existing = OpenClawRemoteAgent(
                id=uuid4(),
                workspace_id=token.workspace_id,
                integration_id=integration.id,
                remote_agent_id=ra.remote_agent_id,
                slug=ra.slug,
                display_name=ra.display_name,
                description=ra.description,
                tools_json=ra.tools,
                constraints_json=ra.constraints,
                is_active=True,
                last_synced_at=now,
            )
            db.add(existing)
        else:
            existing.slug = ra.slug
            existing.display_name = ra.display_name
            existing.description = ra.description
            existing.tools_json = ra.tools
            existing.constraints_json = ra.constraints
            existing.is_active = True
            existing.last_synced_at = now
        synced += 1

    token.used_at = now
    await db.commit()

    return PluginHandshakeResponse(
        integration_id=integration.id,
        workspace_id=token.workspace_id,
        accepted=True,
        synced_agents=synced,
        integration_secret=integration.integration_secret,
    )


async def list_integrations(db: AsyncSession, workspace_id: UUID) -> list[OpenClawIntegrationOut]:
    rows = await db.execute(
        select(OpenClawIntegration)
        .where(OpenClawIntegration.workspace_id == workspace_id)
        .order_by(OpenClawIntegration.updated_at.desc())
    )
    return [
        OpenClawIntegrationOut(
            id=i.id,
            workspace_id=i.workspace_id,
            plugin_instance_id=i.plugin_instance_id,
            openclaw_workspace_id=i.openclaw_workspace_id,
            plugin_version=i.plugin_version,
            status=i.status,
            connected_at=i.connected_at,
            last_seen_at=i.last_seen_at,
            created_at=i.created_at,
            updated_at=i.updated_at,
        )
        for i in rows.scalars()
    ]


async def delete_integration(
    db: AsyncSession,
    workspace_id: UUID,
    integration_id: UUID,
) -> OpenClawIntegrationDeleteOut:
    integration = await db.get(OpenClawIntegration, integration_id)
    if integration is None or integration.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Integration not found")

    rows = await db.execute(
        select(RegisteredAgent)
        .where(RegisteredAgent.workspace_id == workspace_id)
        .where(RegisteredAgent.provider == "openclaw")
        .where(RegisteredAgent.openclaw_integration_id == integration.id)
        .where(RegisteredAgent.status != "archived")
    )
    registered_agents = list(rows.scalars())
    now = _now()
    for agent in registered_agents:
        agent.status = "archived"
        agent.is_active = False
        agent.archived_at = now
        agent.updated_at = now

    await db.delete(integration)
    await db.commit()

    return OpenClawIntegrationDeleteOut(
        integration_id=integration_id,
        plugin_instance_id=integration.plugin_instance_id,
        archived_registered_agent_count=len(registered_agents),
    )


async def get_debug_state(db: AsyncSession, workspace_id: UUID) -> OpenClawDebugStateOut:
    integration_rows = await db.execute(
        select(OpenClawIntegration)
        .where(OpenClawIntegration.workspace_id == workspace_id)
        .order_by(OpenClawIntegration.updated_at.desc())
    )
    integrations = list(integration_rows.scalars())

    integration_states: list[OpenClawIntegrationDebugState] = []
    for integ in integrations:
        counts_q = await db.execute(
            select(OpenClawExecutionTask.status, func.count(OpenClawExecutionTask.id))
            .where(OpenClawExecutionTask.integration_id == integ.id)
            .group_by(OpenClawExecutionTask.status)
        )
        counts = {row[0]: int(row[1]) for row in counts_q.all()}

        latest_task_q = await db.execute(
            select(OpenClawExecutionTask.created_at)
            .where(OpenClawExecutionTask.integration_id == integ.id)
            .order_by(OpenClawExecutionTask.created_at.desc())
            .limit(1)
        )
        latest_task_created_at = latest_task_q.scalar_one_or_none()

        oldest_pending_q = await db.execute(
            select(OpenClawExecutionTask.created_at)
            .where(OpenClawExecutionTask.integration_id == integ.id)
            .where(OpenClawExecutionTask.status == "pending")
            .order_by(OpenClawExecutionTask.created_at.asc())
            .limit(1)
        )
        oldest_pending_task_at = oldest_pending_q.scalar_one_or_none()

        integration_states.append(
            OpenClawIntegrationDebugState(
                integration_id=integ.id,
                plugin_instance_id=integ.plugin_instance_id,
                status=integ.status,
                connected_at=integ.connected_at,
                last_seen_at=integ.last_seen_at,
                pending_count=counts.get("pending", 0),
                claimed_count=counts.get("claimed", 0),
                completed_count=counts.get("completed", 0),
                failed_count=counts.get("failed", 0),
                escalated_count=counts.get("escalated", 0),
                latest_task_created_at=latest_task_created_at,
                oldest_pending_task_at=oldest_pending_task_at,
            )
        )

    recent_tasks_q = await db.execute(
        select(OpenClawExecutionTask)
        .where(OpenClawExecutionTask.workspace_id == workspace_id)
        .order_by(OpenClawExecutionTask.created_at.desc())
        .limit(30)
    )
    recent_tasks_rows = list(recent_tasks_q.scalars())
    recent_tasks: list[OpenClawTaskDebugItem] = []
    for task in recent_tasks_rows:
        ev_stats_q = await db.execute(
            select(func.count(OpenClawExecutionEvent.id), func.max(OpenClawExecutionEvent.created_at))
            .where(OpenClawExecutionEvent.task_id == task.id)
        )
        ev_count, ev_latest = ev_stats_q.one()
        recent_tasks.append(
            OpenClawTaskDebugItem(
                task_id=task.id,
                integration_id=task.integration_id,
                status=task.status,
                node_id=task.node_id,
                run_id=task.run_id,
                agent_ref=task.agent_ref,
                created_at=task.created_at,
                claimed_at=task.claimed_at,
                completed_at=task.completed_at,
                failed_at=task.completed_at if task.status == "failed" else None,
                updated_at=task.updated_at,
                error_message=task.error_message,
                event_count=int(ev_count or 0),
                latest_event_at=ev_latest,
            )
        )

    return OpenClawDebugStateOut(
        workspace_id=workspace_id,
        now_utc=_now(),
        integrations=integration_states,
        recent_tasks=recent_tasks,
    )


async def list_remote_agents(
    db: AsyncSession, workspace_id: UUID, integration_id: UUID
) -> list[OpenClawRemoteAgentOut]:
    integration = await db.get(OpenClawIntegration, integration_id)
    if integration is None or integration.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Integration not found")

    rows = await db.execute(
        select(OpenClawRemoteAgent)
        .where(OpenClawRemoteAgent.workspace_id == workspace_id)
        .where(OpenClawRemoteAgent.integration_id == integration_id)
        .order_by(OpenClawRemoteAgent.display_name.asc())
    )

    return [
        OpenClawRemoteAgentOut(
            id=r.id,
            workspace_id=r.workspace_id,
            integration_id=r.integration_id,
            remote_agent_id=r.remote_agent_id,
            slug=r.slug,
            display_name=r.display_name,
            description=r.description,
            tools=r.tools_json or [],
            constraints=r.constraints_json or {},
            is_active=r.is_active,
            last_synced_at=r.last_synced_at,
        )
        for r in rows.scalars()
    ]


async def register_from_remote_agent(
    db: AsyncSession,
    workspace_id: UUID,
    req: RegisterFromOpenClawRequest,
) -> RegisterFromOpenClawResponse:
    integration = await db.get(OpenClawIntegration, req.integration_id)
    if integration is None or integration.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Integration not found")

    remote_q = await db.execute(
        select(OpenClawRemoteAgent).where(
            and_(
                OpenClawRemoteAgent.workspace_id == workspace_id,
                OpenClawRemoteAgent.integration_id == req.integration_id,
                OpenClawRemoteAgent.remote_agent_id == req.remote_agent_id,
            )
        )
    )
    remote = remote_q.scalar_one_or_none()
    if remote is None:
        raise HTTPException(status_code=404, detail="Remote OpenClaw agent not found")

    display_name = (req.display_name or remote.display_name).strip()
    agent_ref = f"openclaw:{remote.slug}"

    exists_q = await db.execute(
        select(RegisteredAgent).where(
            and_(
                RegisteredAgent.workspace_id == workspace_id,
                RegisteredAgent.provider == "openclaw",
                RegisteredAgent.openclaw_integration_id == req.integration_id,
                RegisteredAgent.openclaw_remote_agent_id == req.remote_agent_id,
                RegisteredAgent.status != "archived",
            )
        )
    )
    existing = exists_q.scalar_one_or_none()
    if existing:
        return RegisterFromOpenClawResponse(
            registered_agent_id=existing.id,
            display_name=existing.display_name,
            agent_ref=existing.agent_ref,
        )

    now = _now()
    ra = RegisteredAgent(
        id=uuid4(),
        workspace_id=workspace_id,
        display_name=display_name,
        provider="openclaw",
        agent_ref=agent_ref,
        status="inactive",
        is_active=False,
        capability_freshness="needs_refresh",
        preflight_status="never_run",
        openclaw_integration_id=req.integration_id,
        openclaw_remote_agent_id=req.remote_agent_id,
        updated_at=now,
        created_at=now,
    )
    db.add(ra)
    await db.commit()

    return RegisterFromOpenClawResponse(
        registered_agent_id=ra.id,
        display_name=ra.display_name,
        agent_ref=ra.agent_ref,
    )


async def resolve_plugin_integration(
    db: AsyncSession, plugin_instance_id: str, integration_secret: str
) -> OpenClawIntegration:
    row = await db.execute(
        select(OpenClawIntegration).where(
            and_(
                OpenClawIntegration.plugin_instance_id == plugin_instance_id,
                OpenClawIntegration.integration_secret == integration_secret,
            )
        )
    )
    integration = row.scalar_one_or_none()
    if integration is None:
        raise HTTPException(status_code=401, detail="Invalid plugin credentials")
    integration.last_seen_at = _now()
    integration.updated_at = _now()
    await db.commit()
    return integration


async def plugin_pull_task(
    db: AsyncSession,
    plugin_instance_id: str,
    integration_secret: str,
) -> dict:
    integration = await resolve_plugin_integration(db, plugin_instance_id, integration_secret)

    # Recover tasks stuck in claimed (plugin crashed or command hang) so UX does not stall forever.
    # Threshold is 15 min — 3× the adapter heartbeat interval (5 min). As long as the
    # Knotwork adapter is alive it touches task.updated_at every 5 min, so this recovery
    # only fires when both the adapter AND the plugin have been silent for 15 min.
    stale_before = _now() - timedelta(minutes=15)
    stale_q = await db.execute(
        select(OpenClawExecutionTask)
        .where(OpenClawExecutionTask.integration_id == integration.id)
        .where(OpenClawExecutionTask.status == "claimed")
        .where(OpenClawExecutionTask.updated_at < stale_before)
    )
    stale_tasks = list(stale_q.scalars())
    for stale in stale_tasks:
        stale.status = "failed"
        stale.error_message = "Plugin task timeout while waiting for OpenClaw result"
        stale.completed_at = _now()
        stale.updated_at = _now()
        db.add(
            OpenClawExecutionEvent(
                id=uuid4(),
                workspace_id=stale.workspace_id,
                task_id=stale.id,
                event_type="failed",
                payload_json={"error": stale.error_message},
                created_at=_now(),
            )
        )
    if stale_tasks:
        await db.commit()

    task_q = await db.execute(
        select(OpenClawExecutionTask)
        .where(OpenClawExecutionTask.integration_id == integration.id)
        .where(OpenClawExecutionTask.status == "pending")
        .order_by(OpenClawExecutionTask.created_at.asc())
        .limit(1)
    )
    task = task_q.scalar_one_or_none()
    if task is None:
        return {"task": None}

    task.status = "claimed"
    task.claimed_at = _now()
    task.updated_at = _now()
    await db.commit()

    mode = "main" if str(task.node_id).startswith("agent_main") else "run"
    agent_key = task.agent_ref.removeprefix("openclaw:")
    ra_id_q = await db.execute(
        select(RegisteredAgent.id)
        .where(RegisteredAgent.workspace_id == task.workspace_id)
        .where(RegisteredAgent.agent_ref == task.agent_ref)
        .where(RegisteredAgent.openclaw_integration_id == integration.id)
        .where(RegisteredAgent.openclaw_remote_agent_id == task.remote_agent_id)
        .order_by(RegisteredAgent.updated_at.desc())
        .limit(1)
    )
    ra_id = ra_id_q.scalar_one_or_none()
    if ra_id is not None:
        agent_key = str(ra_id)
    return {
        "task": {
            "task_id": str(task.id),
            "workspace_id": str(task.workspace_id),
            "run_id": str(task.run_id) if task.run_id is not None else None,
            "node_id": task.node_id,
            "agent_ref": task.agent_ref,
            "agent_key": agent_key,
            "remote_agent_id": task.remote_agent_id,
            "session_name": _agent_session_name(
                task.agent_ref,
                task.run_id,
                mode=mode,
                workspace_id=task.workspace_id,
                agent_key=agent_key,
                node_id=task.node_id,
            ),
            "system_prompt": task.system_prompt,
            "user_prompt": task.user_prompt,
            "session_token": task.session_token,
            "attachments": task.attachments_json or [],
            "execution_contract": {
                "type": "session",
                "operations": list(SESSION_EXECUTION_CONTRACT_OPERATIONS),
            },
        }
    }


async def plugin_submit_task_event(
    db: AsyncSession,
    task_id: UUID,
    plugin_instance_id: str,
    integration_secret: str,
    event_type: str,
    payload: dict,
) -> dict:
    integration = await resolve_plugin_integration(db, plugin_instance_id, integration_secret)

    task = await db.get(OpenClawExecutionTask, task_id)
    if task is None or task.integration_id != integration.id:
        raise HTTPException(status_code=404, detail="Task not found")

    now = _now()
    ev = OpenClawExecutionEvent(
        id=uuid4(),
        workspace_id=task.workspace_id,
        task_id=task.id,
        event_type=event_type,
        payload_json=payload or {},
        created_at=now,
    )
    db.add(ev)

    if event_type == "completed":
        task.status = "completed"
        task.output_text = str((payload or {}).get("output") or "")
        task.next_branch = (payload or {}).get("next_branch")
        task.completed_at = now
    elif event_type == "escalation":
        task.status = "escalated"
        task.escalation_question = str((payload or {}).get("question") or "")
        task.escalation_options_json = (payload or {}).get("options") or []
        # Preserve the full agent message body so the debug panel can show it.
        full_msg = (payload or {}).get("message")
        if full_msg:
            task.output_text = str(full_msg)
        task.completed_at = now
    elif event_type == "failed":
        task.status = "failed"
        task.error_message = str((payload or {}).get("error") or "plugin execution failed")
        task.completed_at = now
        # Keep runtime state consistent even if the worker loop is stale or interrupted.
        if task.run_id is not None:
            from knotwork.runs.models import Run, RunNodeState

            ns_q = await db.execute(
                select(RunNodeState)
                .where(RunNodeState.run_id == task.run_id)
                .where(RunNodeState.node_id == task.node_id)
                .where(RunNodeState.status == "running")
                .order_by(RunNodeState.started_at.desc())
                .limit(1)
            )
            ns = ns_q.scalar_one_or_none()
            if ns is not None:
                ns.status = "failed"
                ns.error = ns.error or task.error_message
                ns.completed_at = ns.completed_at or now

            run = await db.get(Run, task.run_id)
            if run is not None and run.status == "running":
                run.status = "failed"
                run.error = run.error or f"Node failed: {task.error_message}"
                run.completed_at = run.completed_at or now

    task.updated_at = now
    await db.commit()

    return {"ok": True, "task_status": task.status}
