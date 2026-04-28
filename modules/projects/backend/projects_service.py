from __future__ import annotations
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import assets as core_assets
from core.api import channels as core_channels
from libs.slugs import make_slug_candidate, parse_uuid_ref
from modules.assets.backend.knowledge_models import KnowledgeFile
from modules.communication.backend.channels_models import Channel, ChannelAssetBinding
from modules.workflows.backend.graphs.models import Graph
from modules.workflows.backend.runs.models import Run

from .projects_models import Objective, Project, ProjectStatusUpdate
from .projects_schemas import (
    ObjectiveCreate,
    ObjectiveUpdate,
    ProjectCreate,
    ProjectUpdate,
    ProjectStatusUpdateCreate,
)


async def _get_project_channel_id(db: AsyncSession, project_id: UUID) -> UUID | None:
    result = await db.execute(
        select(Channel.id).where(Channel.project_id == project_id, Channel.channel_type == "project")
    )
    return result.scalar_one_or_none()


async def _get_objective_channel_id(db: AsyncSession, objective_id: UUID) -> UUID | None:
    result = await db.execute(
        select(Channel.id).where(Channel.objective_id == objective_id, Channel.channel_type == "objective")
    )
    return result.scalar_one_or_none()


async def _generate_project_slug(db: AsyncSession, title: str) -> str:
    while True:
        slug = make_slug_candidate(title, "project")
        existing = await db.execute(select(Project.id).where(Project.slug == slug))
        if existing.scalar_one_or_none() is None:
            return slug


async def _generate_objective_slug(db: AsyncSession, title: str, code: str | None = None) -> str:
    source = " ".join(part for part in (code, title) if part)
    while True:
        slug = make_slug_candidate(source, "objective")
        existing = await db.execute(select(Objective.id).where(Objective.slug == slug))
        if existing.scalar_one_or_none() is None:
            return slug


async def resolve_project_ref(db: AsyncSession, workspace_id: UUID, project_ref: str) -> Project | None:
    project_uuid = parse_uuid_ref(project_ref)
    stmt = select(Project).where(Project.workspace_id == workspace_id)
    if project_uuid is not None:
        stmt = stmt.where((Project.id == project_uuid) | (Project.slug == project_ref))
    else:
        stmt = stmt.where(Project.slug == project_ref)
    result = await db.execute(stmt.limit(1))
    return result.scalar_one_or_none()


async def resolve_objective_ref(db: AsyncSession, workspace_id: UUID, objective_ref: str) -> Objective | None:
    objective_uuid = parse_uuid_ref(objective_ref)
    stmt = select(Objective).where(Objective.workspace_id == workspace_id)
    if objective_uuid is not None:
        stmt = stmt.where((Objective.id == objective_uuid) | (Objective.slug == objective_ref))
    else:
        stmt = stmt.where(Objective.slug == objective_ref)
    result = await db.execute(stmt.limit(1))
    return result.scalar_one_or_none()


async def list_projects(db: AsyncSession, workspace_id: UUID) -> list[dict]:
    rows = await db.execute(
        select(Project).where(Project.workspace_id == workspace_id).order_by(Project.updated_at.desc())
    )
    projects = list(rows.scalars())
    if not projects:
        return []
    project_ids = [p.id for p in projects]

    objective_counts_q = await db.execute(
        select(Objective.project_id, func.count(Objective.id))
        .where(Objective.project_id.in_(project_ids))
        .group_by(Objective.project_id)
    )
    objective_counts = {row[0]: int(row[1]) for row in objective_counts_q.all()}

    open_counts_q = await db.execute(
        select(Objective.project_id, func.count(Objective.id))
        .where(Objective.project_id.in_(project_ids), Objective.status.in_(("open", "in_progress")))
        .group_by(Objective.project_id)
    )
    open_counts = {row[0]: int(row[1]) for row in open_counts_q.all()}

    run_counts_q = await db.execute(
        select(Run.project_id, func.count(Run.id))
        .where(Run.project_id.in_(project_ids))
        .group_by(Run.project_id)
    )
    run_counts = {row[0]: int(row[1]) for row in run_counts_q.all()}

    objective_updates_q = await db.execute(
        select(Objective.project_id, func.max(Objective.updated_at))
        .where(Objective.project_id.in_(project_ids))
        .group_by(Objective.project_id)
    )
    objective_updates = {row[0]: row[1] for row in objective_updates_q.all() if row[0] is not None and row[1] is not None}

    channel_updates_q = await db.execute(
        select(Channel.project_id, func.max(Channel.updated_at))
        .where(Channel.project_id.in_(project_ids), Channel.archived_at.is_(None))
        .group_by(Channel.project_id)
    )
    channel_updates = {row[0]: row[1] for row in channel_updates_q.all() if row[0] is not None and row[1] is not None}

    status_updates_q = await db.execute(
        select(ProjectStatusUpdate.project_id, func.max(ProjectStatusUpdate.created_at))
        .where(ProjectStatusUpdate.project_id.in_(project_ids))
        .group_by(ProjectStatusUpdate.project_id)
    )
    status_updates = {row[0]: row[1] for row in status_updates_q.all() if row[0] is not None and row[1] is not None}

    updates_q = await db.execute(
        select(ProjectStatusUpdate)
        .where(ProjectStatusUpdate.project_id.in_(project_ids))
        .order_by(ProjectStatusUpdate.created_at.desc())
    )
    latest_updates: dict[UUID, ProjectStatusUpdate] = {}
    for update in updates_q.scalars():
        latest_updates.setdefault(update.project_id, update)

    out = []
    for project in projects:
        latest_activity_at = max(
            [
                project.updated_at,
                objective_updates.get(project.id, project.updated_at),
                channel_updates.get(project.id, project.updated_at),
                status_updates.get(project.id, project.updated_at),
            ]
        )
        out.append({
            **{c.key: getattr(project, c.key) for c in project.__table__.columns},
            "project_channel_id": await _get_project_channel_id(db, project.id),
            "objective_count": objective_counts.get(project.id, 0),
            "open_objective_count": open_counts.get(project.id, 0),
            "run_count": run_counts.get(project.id, 0),
            "latest_status_update": latest_updates.get(project.id),
            "latest_activity_at": latest_activity_at,
        })
    out.sort(key=lambda project: project["latest_activity_at"], reverse=True)
    return out


async def get_project(db: AsyncSession, workspace_id: UUID, project_ref: UUID | str) -> Project | None:
    if isinstance(project_ref, UUID):
        project = await db.get(Project, project_ref)
        if project is None or project.workspace_id != workspace_id:
            return None
        return project
    return await resolve_project_ref(db, workspace_id, project_ref)


async def create_project(db: AsyncSession, workspace_id: UUID, data: ProjectCreate) -> Project:
    project = Project(
        workspace_id=workspace_id,
        title=data.title.strip(),
        slug=await _generate_project_slug(db, data.title.strip()),
        description=data.description.strip(),
        status=data.status,
        deadline=data.deadline,
    )
    db.add(project)
    await db.flush()
    db.add(
        Channel(
            workspace_id=workspace_id,
            name=f"project: {project.title}",
            slug=await core_channels.generate_channel_slug(db, project.title),
            channel_type="project",
            project_id=project.id,
        )
    )
    await db.commit()
    await db.refresh(project)
    return project


async def update_project(db: AsyncSession, workspace_id: UUID, project_id: UUID, data: ProjectUpdate) -> Project | None:
    project = await get_project(db, workspace_id, project_id)
    if project is None:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    await db.commit()
    await db.refresh(project)
    return project


async def list_objectives(db: AsyncSession, workspace_id: UUID, project_id: UUID | None = None) -> list[dict]:
    stmt = select(Objective).where(Objective.workspace_id == workspace_id)
    if project_id is None:
        stmt = stmt.where(Objective.project_id.is_(None))
    else:
        stmt = stmt.where(Objective.project_id == project_id)
    rows = await db.execute(stmt.order_by(Objective.updated_at.desc()))
    objectives = list(rows.scalars())
    if not objectives:
        return []
    objective_ids = [objective.id for objective in objectives]
    runs_q = await db.execute(
        select(Run.objective_id, func.count(Run.id), func.max(Run.created_at))
        .where(Run.objective_id.in_(objective_ids))
        .group_by(Run.objective_id)
    )
    run_counts = {row[0]: int(row[1]) for row in runs_q.all()}

    latest_run_rows = await db.execute(
        select(Run)
        .where(Run.objective_id.in_(objective_ids))
        .order_by(Run.created_at.desc())
    )
    latest_by_objective: dict[UUID, Run] = {}
    for run in latest_run_rows.scalars():
        if run.objective_id is not None:
            latest_by_objective.setdefault(run.objective_id, run)

    out = []
    for objective in objectives:
        project_slug = None
        if objective.project_id is not None:
            project_row = await db.get(Project, objective.project_id)
            project_slug = project_row.slug if project_row is not None else None
        out.append({
            **{c.key: getattr(objective, c.key) for c in objective.__table__.columns},
            "project_slug": project_slug,
            "channel_id": await _get_objective_channel_id(db, objective.id),
            "run_count": run_counts.get(objective.id, 0),
            "latest_run_id": latest_by_objective.get(objective.id).id if objective.id in latest_by_objective else None,
        })
    return out


async def get_objective(db: AsyncSession, workspace_id: UUID, objective_ref: UUID | str) -> dict | None:
    if isinstance(objective_ref, UUID):
        objective = await db.get(Objective, objective_ref)
    else:
        objective = await resolve_objective_ref(db, workspace_id, objective_ref)
    if objective is None or objective.workspace_id != workspace_id:
        return None
    rows = await list_objectives(db, workspace_id, objective.project_id)
    for row in rows:
        if str(row["id"]) == str(objective.id):
            return row
    return None


async def create_objective(db: AsyncSession, workspace_id: UUID, data: ObjectiveCreate) -> Objective:
    if data.project_id is not None:
        project = await get_project(db, workspace_id, data.project_id)
        if project is None:
            raise ValueError("Project not found")
    if data.parent_objective_id is not None:
        parent = await db.get(Objective, data.parent_objective_id)
        if parent is None or parent.workspace_id != workspace_id:
            raise ValueError("Parent objective not found")
        if parent.project_id != data.project_id:
            raise ValueError("Parent objective must belong to the same project")

    if data.origin_graph_id is not None:
        graph = await db.get(Graph, data.origin_graph_id)
        if graph is None or graph.workspace_id != workspace_id:
            raise ValueError("Workflow not found")
        if graph.project_id is not None and data.project_id != graph.project_id:
            raise ValueError("Project workflow can only spawn objectives into its own project")

    objective = Objective(
        workspace_id=workspace_id,
        project_id=data.project_id,
        parent_objective_id=data.parent_objective_id,
        code=(data.code or "").strip() or None,
        slug=await _generate_objective_slug(db, data.title.strip(), (data.code or "").strip() or None),
        title=data.title.strip(),
        description=(data.description or "").strip() or None,
        status=data.status,
        progress_percent=max(0, min(100, data.progress_percent)),
        status_summary=(data.status_summary or "").strip() or None,
        key_results=[item.strip() for item in data.key_results if item.strip()],
        owner_type=(data.owner_type or "").strip() or None,
        owner_name=(data.owner_name or "").strip() or None,
        deadline=data.deadline,
        origin_type=data.origin_type,
        origin_graph_id=data.origin_graph_id,
    )
    db.add(objective)
    await db.flush()
    db.add(
        Channel(
            workspace_id=workspace_id,
            name=f"objective: {objective.code or objective.title}",
            slug=await _generate_channel_slug(db, objective.code or objective.title),
            channel_type="objective",
            project_id=objective.project_id,
            objective_id=objective.id,
        )
    )
    await db.commit()
    await db.refresh(objective)
    return objective


async def update_objective(db: AsyncSession, workspace_id: UUID, objective_id: UUID, data: ObjectiveUpdate) -> Objective | None:
    objective = await db.get(Objective, objective_id)
    if objective is None or objective.workspace_id != workspace_id:
        return None
    payload = data.model_dump(exclude_unset=True)
    if "project_id" in payload and payload["project_id"] is not None:
        project = await get_project(db, workspace_id, payload["project_id"])
        if project is None:
            raise ValueError("Project not found")
        if objective.origin_graph_id is not None:
            graph = await db.get(Graph, objective.origin_graph_id)
            if graph and graph.project_id is not None and graph.project_id != payload["project_id"]:
                raise ValueError("Objective spawned from a project workflow cannot move to another project")
    if "parent_objective_id" in payload:
        parent_objective_id = payload["parent_objective_id"]
        if parent_objective_id is not None:
            parent = await db.get(Objective, parent_objective_id)
            if parent is None or parent.workspace_id != workspace_id:
                raise ValueError("Parent objective not found")
            target_project_id = payload.get("project_id", objective.project_id)
            if parent.project_id != target_project_id:
                raise ValueError("Parent objective must belong to the same project")
            if str(parent.id) == str(objective.id):
                raise ValueError("Objective cannot be its own parent")
    if "progress_percent" in payload and payload["progress_percent"] is not None:
        payload["progress_percent"] = max(0, min(100, payload["progress_percent"]))
    if "key_results" in payload and payload["key_results"] is not None:
        payload["key_results"] = [item.strip() for item in payload["key_results"] if item.strip()]
    for key in ("code", "status_summary", "owner_type", "owner_name"):
        if key in payload:
            payload[key] = (payload[key] or "").strip() or None
    for field, value in payload.items():
        setattr(objective, field, value)
    result = await db.execute(select(Channel).where(Channel.objective_id == objective.id))
    channel = result.scalar_one_or_none()
    if channel is not None:
        channel.project_id = objective.project_id
        channel.name = f"objective: {objective.code or objective.title}"
        channel.channel_type = "objective"
    await db.commit()
    await db.refresh(objective)
    return objective


async def render_project_context(db: AsyncSession, workspace_id: UUID, project_id: UUID | None) -> str:
    if project_id is None:
        return ""
    files = await core_assets.list_files(db, workspace_id, project_id=project_id)
    if not files:
        return ""
    sections: list[str] = []
    for file in files:
        try:
            fc = await core_assets.read_file_content(workspace_id, file.path, project_id=project_id)
        except FileNotFoundError:
            continue
        sections.append(f"## {file.path}\n\n{fc.content}")
    return "\n\n---\n\n".join(sections)


async def create_project_status_update(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, data: ProjectStatusUpdateCreate
) -> ProjectStatusUpdate:
    update = ProjectStatusUpdate(
        workspace_id=workspace_id,
        project_id=project_id,
        author_type=data.author_type,
        author_name=data.author_name,
        summary=data.summary.strip(),
    )
    db.add(update)
    await db.commit()
    await db.refresh(update)
    return update


async def get_latest_project_status_update(
    db: AsyncSession, workspace_id: UUID, project_id: UUID
) -> ProjectStatusUpdate | None:
    result = await db.execute(
        select(ProjectStatusUpdate)
        .where(ProjectStatusUpdate.workspace_id == workspace_id, ProjectStatusUpdate.project_id == project_id)
        .order_by(ProjectStatusUpdate.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_project_dashboard(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> dict | None:
    project = await get_project(db, workspace_id, project_id)
    if project is None:
        return None
    projects = await list_projects(db, workspace_id)
    project_row = next((row for row in projects if str(row["id"]) == str(project_id)), None)
    objectives = await list_objectives(db, workspace_id, project_id)
    recent_runs_q = await db.execute(
        select(Run)
        .where(Run.workspace_id == workspace_id, Run.project_id == project_id)
        .order_by(Run.created_at.desc())
        .limit(10)
    )
    recent_runs = [
        {c.key: getattr(run, c.key) for c in run.__table__.columns}
        for run in recent_runs_q.scalars()
    ]
    blocked_objectives = [objective for objective in objectives if objective["status"] == "blocked"]
    return {
        "project": project_row,
        "objectives": objectives,
        "recent_runs": recent_runs,
        "blocked_objectives": blocked_objectives,
        "latest_status_update": project_row["latest_status_update"] if project_row else None,
    }


async def list_project_channels(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    *,
    include_archived: bool = False,
) -> list[Channel]:
    await core_channels.ensure_default_workspace_channels(db, workspace_id)

    project = await get_project(db, workspace_id, project_id)
    if project is None:
        return []

    objective_ids = [row[0] for row in (await db.execute(
        select(Objective.id).where(
            Objective.workspace_id == workspace_id,
            Objective.project_id == project_id,
        )
    )).all()]
    graph_ids = [str(row[0]) for row in (await db.execute(
        select(Graph.id).where(
            Graph.workspace_id == workspace_id,
            Graph.project_id == project_id,
        )
    )).all()]
    run_ids = [row[0] for row in (await db.execute(
        select(Run.id).where(
            Run.workspace_id == workspace_id,
            Run.project_id == project_id,
        )
    )).all()]
    file_ids = [str(row[0]) for row in (await db.execute(
        select(KnowledgeFile.id).where(
            KnowledgeFile.workspace_id == workspace_id,
            KnowledgeFile.project_id == project_id,
        )
    )).all()]

    channel_ids: set[UUID] = set()

    archive_filter = True if include_archived else Channel.archived_at.is_(None)
    non_asset_chat_filter = ~or_(
        Channel.name == "project assets",
        Channel.name.like("folder: %"),
        Channel.name.like("file: %"),
        Channel.name.like("workflow: %"),
    )

    direct_rows = await db.execute(
        select(Channel.id).where(
            Channel.workspace_id == workspace_id,
            archive_filter,
            non_asset_chat_filter,
            Channel.project_id == project_id,
            Channel.channel_type.in_(("project", "normal", "objective")),
        )
    )
    channel_ids.update(row[0] for row in direct_rows.all())

    if objective_ids:
        objective_rows = await db.execute(
            select(Channel.id).where(
                Channel.workspace_id == workspace_id,
                archive_filter,
                Channel.channel_type == "objective",
                Channel.objective_id.in_(objective_ids),
            )
        )
        channel_ids.update(row[0] for row in objective_rows.all())

    if graph_ids:
        workflow_rows = await db.execute(
            select(Channel.id).where(
                Channel.workspace_id == workspace_id,
                archive_filter,
                Channel.channel_type == "workflow",
                Channel.graph_id.in_(graph_ids),
            )
        )
        channel_ids.update(row[0] for row in workflow_rows.all())

    if run_ids:
        run_rows = await db.execute(
            select(Channel.id).where(
                Channel.workspace_id == workspace_id,
                archive_filter,
                Channel.channel_type == "run",
                Channel.name.in_([f"run:{run_id}" for run_id in run_ids]),
            )
        )
        channel_ids.update(row[0] for row in run_rows.all())

    if graph_ids or run_ids or file_ids:
        binding_base = select(ChannelAssetBinding.channel_id).join(
            Channel,
            Channel.id == ChannelAssetBinding.channel_id,
        ).where(
            Channel.workspace_id == workspace_id,
            archive_filter,
            non_asset_chat_filter,
            Channel.channel_type == "normal",
            ChannelAssetBinding.workspace_id == workspace_id,
        )
        if graph_ids:
            workflow_binding_rows = await db.execute(
                binding_base.where(
                    ChannelAssetBinding.asset_type == "workflow",
                    ChannelAssetBinding.asset_id.in_(graph_ids),
                )
            )
            channel_ids.update(row[0] for row in workflow_binding_rows.all())
        if run_ids:
            run_binding_rows = await db.execute(
                binding_base.where(
                    ChannelAssetBinding.asset_type == "run",
                    ChannelAssetBinding.asset_id.in_(run_ids),
                )
            )
            channel_ids.update(row[0] for row in run_binding_rows.all())
        if file_ids:
            file_binding_rows = await db.execute(
                binding_base.where(
                    ChannelAssetBinding.asset_type == "file",
                    ChannelAssetBinding.asset_id.in_(file_ids),
                )
            )
            channel_ids.update(row[0] for row in file_binding_rows.all())

    if not channel_ids:
        return []

    result = await db.execute(
        select(Channel)
        .where(
            Channel.workspace_id == workspace_id,
            archive_filter,
            non_asset_chat_filter,
            Channel.id.in_(channel_ids),
        )
        .order_by(Channel.archived_at.is_not(None).asc(), Channel.updated_at.desc(), Channel.created_at.desc())
    )
    return list(result.scalars())
