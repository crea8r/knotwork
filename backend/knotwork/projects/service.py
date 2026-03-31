from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.channels.models import Channel, ChannelAssetBinding
from knotwork.channels.service import _generate_channel_slug
from knotwork.graphs.models import Graph
from knotwork.knowledge.models import KnowledgeFile, KnowledgeFolder
from knotwork.knowledge.change_summary import generate_change_summary
from knotwork.knowledge.health import compute_health_score
from knotwork.knowledge.suggestions import generate_suggestions
from knotwork.knowledge.storage import get_storage_adapter
from knotwork.projects.models import Objective, Project, ProjectStatusUpdate
from knotwork.runs.models import Run
from knotwork.utils.slugs import make_slug_candidate, parse_uuid_ref
from knotwork.projects.schemas import (
    ObjectiveCreate,
    ObjectiveUpdate,
    ProjectCreate,
    ProjectDocumentCreate,
    ProjectDocumentRename,
    ProjectDocumentUpdate,
    ProjectUpdate,
    ProjectStatusUpdateCreate,
)


def _project_storage_key(workspace_id: UUID, project_id: UUID) -> str:
    return f"{workspace_id}:project:{project_id}"


def _count_tokens(content: str) -> int:
    return max(1, len(content) // 4)


def _extract_links(content: str) -> list[str]:
    return re.findall(r"\[\[([^\]]+)\]\]", content)


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
            slug=await _generate_channel_slug(db, project.title),
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


async def list_project_documents(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[KnowledgeFile]:
    result = await db.execute(
        select(KnowledgeFile)
        .where(KnowledgeFile.workspace_id == workspace_id, KnowledgeFile.project_id == project_id)
        .order_by(KnowledgeFile.path.asc())
    )
    return list(result.scalars())


async def list_project_folders(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[KnowledgeFolder]:
    result = await db.execute(
        select(KnowledgeFolder)
        .where(KnowledgeFolder.workspace_id == workspace_id, KnowledgeFolder.project_id == project_id)
        .order_by(KnowledgeFolder.path.asc())
    )
    return list(result.scalars())


async def create_project_folder(db: AsyncSession, workspace_id: UUID, project_id: UUID, path: str) -> KnowledgeFolder:
    result = await db.execute(
        select(KnowledgeFolder).where(
            KnowledgeFolder.workspace_id == workspace_id,
            KnowledgeFolder.project_id == project_id,
            KnowledgeFolder.path == path,
        )
    )
    folder = result.scalar_one_or_none()
    if folder is not None:
        return folder
    folder = KnowledgeFolder(workspace_id=workspace_id, project_id=project_id, path=path)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder


async def rename_project_folder(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    old_path: str,
    new_path: str,
) -> None:
    adapter = get_storage_adapter()
    prefix = old_path + "/"

    files_result = await db.execute(
        select(KnowledgeFile).where(
            KnowledgeFile.workspace_id == workspace_id,
            KnowledgeFile.project_id == project_id,
        )
    )
    for file in files_result.scalars().all():
        if file.path.startswith(prefix):
            new_file_path = new_path + "/" + file.path[len(prefix):]
            try:
                await adapter.move(_project_storage_key(workspace_id, project_id), file.path, new_file_path, "system")
            except Exception:
                pass
            file.path = new_file_path

    folders_result = await db.execute(
        select(KnowledgeFolder).where(
            KnowledgeFolder.workspace_id == workspace_id,
            KnowledgeFolder.project_id == project_id,
        )
    )
    for folder in folders_result.scalars().all():
        if folder.path == old_path:
            folder.path = new_path
        elif folder.path.startswith(prefix):
            folder.path = new_path + "/" + folder.path[len(prefix):]

    await db.commit()


async def delete_project_folder(db: AsyncSession, workspace_id: UUID, project_id: UUID, path: str) -> None:
    adapter = get_storage_adapter()
    prefix = path + "/"

    files_result = await db.execute(
        select(KnowledgeFile).where(
            KnowledgeFile.workspace_id == workspace_id,
            KnowledgeFile.project_id == project_id,
        )
    )
    for file in files_result.scalars().all():
        if file.path == path or file.path.startswith(prefix):
            try:
                await adapter.delete(_project_storage_key(workspace_id, project_id), file.path)
            except Exception:
                pass
            await db.delete(file)

    folders_result = await db.execute(
        select(KnowledgeFolder).where(
            KnowledgeFolder.workspace_id == workspace_id,
            KnowledgeFolder.project_id == project_id,
        )
    )
    paths_to_delete = [
        row.path for row in folders_result.scalars().all()
        if row.path == path or row.path.startswith(prefix)
    ]
    if paths_to_delete:
        await db.execute(
            delete(KnowledgeFolder).where(
                KnowledgeFolder.workspace_id == workspace_id,
                KnowledgeFolder.project_id == project_id,
                KnowledgeFolder.path.in_(paths_to_delete),
            )
        )
    await db.commit()


async def get_project_document(db: AsyncSession, workspace_id: UUID, project_id: UUID, path: str) -> KnowledgeFile | None:
    result = await db.execute(
        select(KnowledgeFile).where(
            KnowledgeFile.workspace_id == workspace_id,
            KnowledgeFile.project_id == project_id,
            KnowledgeFile.path == path,
        )
    )
    return result.scalar_one_or_none()


async def create_project_document(db: AsyncSession, workspace_id: UUID, project_id: UUID, data: ProjectDocumentCreate) -> KnowledgeFile:
    existing = await get_project_document(db, workspace_id, project_id, data.path)
    if existing is not None:
        raise ValueError(f'File "{data.path}" already exists')
    adapter = get_storage_adapter()
    version_id = await adapter.write(
        _project_storage_key(workspace_id, project_id),
        data.path,
        data.content,
        saved_by="system",
        change_summary=data.change_summary,
    )
    file = KnowledgeFile(
        workspace_id=workspace_id,
        project_id=project_id,
        path=data.path,
        title=(data.title or data.path.split("/")[-1]).strip(),
        raw_token_count=max(1, len(data.content) // 4),
        resolved_token_count=max(1, len(data.content) // 4),
        linked_paths=[],
        current_version_id=version_id,
    )
    db.add(file)
    await db.commit()
    await db.refresh(file)
    return file


async def update_project_document(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, path: str, data: ProjectDocumentUpdate
) -> KnowledgeFile:
    file = await get_project_document(db, workspace_id, project_id, path)
    if file is None:
        raise FileNotFoundError(path)
    adapter = get_storage_adapter()
    version_id = await adapter.write(
        _project_storage_key(workspace_id, project_id),
        path,
        data.content,
        saved_by="system",
        change_summary=data.change_summary,
    )
    file.current_version_id = version_id
    file.raw_token_count = max(1, len(data.content) // 4)
    file.resolved_token_count = file.raw_token_count
    await db.commit()
    await db.refresh(file)
    return file


async def rename_project_document(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, path: str, data: ProjectDocumentRename
) -> KnowledgeFile:
    file = await get_project_document(db, workspace_id, project_id, path)
    if file is None:
        raise FileNotFoundError(path)
    existing = await get_project_document(db, workspace_id, project_id, data.new_path)
    if existing is not None and existing.id != file.id:
        raise ValueError(f'File "{data.new_path}" already exists')
    adapter = get_storage_adapter()
    version_id = await adapter.move(
        _project_storage_key(workspace_id, project_id),
        path,
        data.new_path,
        "system",
    )
    file.path = data.new_path
    file.current_version_id = version_id
    await db.commit()
    await db.refresh(file)
    return file


async def delete_project_document(db: AsyncSession, workspace_id: UUID, project_id: UUID, path: str) -> None:
    file = await get_project_document(db, workspace_id, project_id, path)
    if file is None:
        raise FileNotFoundError(path)
    adapter = get_storage_adapter()
    await adapter.delete(_project_storage_key(workspace_id, project_id), path)
    await db.delete(file)
    await db.commit()


async def get_project_document_content(workspace_id: UUID, project_id: UUID, path: str):
    adapter = get_storage_adapter()
    return await adapter.read(_project_storage_key(workspace_id, project_id), path)


async def get_project_document_history(workspace_id: UUID, project_id: UUID, path: str):
    adapter = get_storage_adapter()
    return await adapter.history(_project_storage_key(workspace_id, project_id), path)


async def restore_project_document(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, path: str, version_id: str, restored_by: str
) -> KnowledgeFile:
    adapter = get_storage_adapter()
    new_version_id = await adapter.restore(_project_storage_key(workspace_id, project_id), path, version_id, restored_by)
    file = await get_project_document(db, workspace_id, project_id, path)
    if file is None:
        raise FileNotFoundError(path)
    fc = await adapter.read(_project_storage_key(workspace_id, project_id), path)
    file.raw_token_count = _count_tokens(fc.content)
    file.resolved_token_count = file.raw_token_count
    file.linked_paths = _extract_links(fc.content)
    file.current_version_id = new_version_id
    await db.commit()
    await db.refresh(file)
    return file


async def summarize_project_document_diff(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, path: str, content: str
) -> str:
    file = await get_project_document(db, workspace_id, project_id, path)
    if file is None:
        raise FileNotFoundError(path)
    adapter = get_storage_adapter()
    fc = await adapter.read(_project_storage_key(workspace_id, project_id), path)
    return await generate_change_summary(path, fc.content, content)


async def get_project_document_health(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, path: str
) -> float:
    file = await get_project_document(db, workspace_id, project_id, path)
    if file is None:
        raise FileNotFoundError(path)
    return await compute_health_score(file.id, db)


async def get_project_document_suggestions(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, path: str
) -> list[str]:
    file = await get_project_document(db, workspace_id, project_id, path)
    if file is None:
        raise FileNotFoundError(path)
    return await generate_suggestions(file.id, db)


async def render_project_context(db: AsyncSession, workspace_id: UUID, project_id: UUID | None) -> str:
    if project_id is None:
        return ""
    files = await list_project_documents(db, workspace_id, project_id)
    if not files:
        return ""
    adapter = get_storage_adapter()
    sections: list[str] = []
    for file in files:
        try:
            fc = await adapter.read(_project_storage_key(workspace_id, project_id), file.path)
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
    from knotwork.channels import service as channel_service

    await channel_service.ensure_workflow_channels(db, workspace_id)
    await channel_service.ensure_handbook_channel(db, workspace_id)
    await channel_service.ensure_bulletin_channel(db, workspace_id)
    await channel_service.ensure_default_channel_subscriptions(db, workspace_id)

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

    direct_rows = await db.execute(
        select(Channel.id).where(
            Channel.workspace_id == workspace_id,
            archive_filter,
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
            Channel.id.in_(channel_ids),
        )
        .order_by(Channel.archived_at.is_not(None).asc(), Channel.updated_at.desc(), Channel.created_at.desc())
    )
    return list(result.scalars())
