from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.channels.models import Channel
from knotwork.graphs.models import Graph
from knotwork.knowledge.models import KnowledgeFile
from knotwork.knowledge.storage import get_storage_adapter
from knotwork.projects.models import Project, ProjectStatusUpdate, Task
from knotwork.runs.models import Run
from knotwork.projects.schemas import (
    ProjectCreate,
    ProjectDocumentCreate,
    ProjectDocumentUpdate,
    ProjectUpdate,
    ProjectStatusUpdateCreate,
    TaskCreate,
    TaskUpdate,
)


def _project_storage_key(workspace_id: UUID, project_id: UUID) -> str:
    return f"{workspace_id}:project:{project_id}"


async def _get_project_channel_id(db: AsyncSession, project_id: UUID) -> UUID | None:
    result = await db.execute(
        select(Channel.id).where(Channel.project_id == project_id, Channel.channel_type == "project")
    )
    return result.scalar_one_or_none()


async def _get_task_channel_id(db: AsyncSession, task_id: UUID) -> UUID | None:
    result = await db.execute(
        select(Channel.id).where(Channel.task_id == task_id, Channel.channel_type == "task")
    )
    return result.scalar_one_or_none()


async def list_projects(db: AsyncSession, workspace_id: UUID) -> list[dict]:
    rows = await db.execute(
        select(Project).where(Project.workspace_id == workspace_id).order_by(Project.updated_at.desc())
    )
    projects = list(rows.scalars())
    if not projects:
        return []
    project_ids = [p.id for p in projects]

    task_counts_q = await db.execute(
        select(Task.project_id, func.count(Task.id))
        .where(Task.project_id.in_(project_ids))
        .group_by(Task.project_id)
    )
    task_counts = {row[0]: int(row[1]) for row in task_counts_q.all()}

    open_counts_q = await db.execute(
        select(Task.project_id, func.count(Task.id))
        .where(Task.project_id.in_(project_ids), Task.status.in_(("open", "in_progress")))
        .group_by(Task.project_id)
    )
    open_counts = {row[0]: int(row[1]) for row in open_counts_q.all()}

    run_counts_q = await db.execute(
        select(Run.project_id, func.count(Run.id))
        .where(Run.project_id.in_(project_ids))
        .group_by(Run.project_id)
    )
    run_counts = {row[0]: int(row[1]) for row in run_counts_q.all()}

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
        out.append({
            **{c.key: getattr(project, c.key) for c in project.__table__.columns},
            "project_channel_id": await _get_project_channel_id(db, project.id),
            "task_count": task_counts.get(project.id, 0),
            "open_task_count": open_counts.get(project.id, 0),
            "run_count": run_counts.get(project.id, 0),
            "latest_status_update": latest_updates.get(project.id),
        })
    return out


async def get_project(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> Project | None:
    project = await db.get(Project, project_id)
    if project is None or project.workspace_id != workspace_id:
        return None
    return project


async def create_project(db: AsyncSession, workspace_id: UUID, data: ProjectCreate) -> Project:
    project = Project(
        workspace_id=workspace_id,
        title=data.title.strip(),
        objective=data.objective.strip(),
        status=data.status,
        deadline=data.deadline,
    )
    db.add(project)
    await db.flush()
    db.add(
        Channel(
            workspace_id=workspace_id,
            name=f"project: {project.title}",
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


async def list_tasks(db: AsyncSession, workspace_id: UUID, project_id: UUID | None = None) -> list[dict]:
    stmt = select(Task).where(Task.workspace_id == workspace_id)
    if project_id is None:
        stmt = stmt.where(Task.project_id.is_(None))
    else:
        stmt = stmt.where(Task.project_id == project_id)
    rows = await db.execute(stmt.order_by(Task.updated_at.desc()))
    tasks = list(rows.scalars())
    if not tasks:
        return []
    task_ids = [t.id for t in tasks]
    runs_q = await db.execute(
        select(Run.task_id, func.count(Run.id), func.max(Run.created_at))
        .where(Run.task_id.in_(task_ids))
        .group_by(Run.task_id)
    )
    run_counts = {row[0]: int(row[1]) for row in runs_q.all()}

    latest_run_rows = await db.execute(
        select(Run)
        .where(Run.task_id.in_(task_ids))
        .order_by(Run.created_at.desc())
    )
    latest_by_task: dict[UUID, Run] = {}
    for run in latest_run_rows.scalars():
        if run.task_id is not None:
            latest_by_task.setdefault(run.task_id, run)

    out = []
    for task in tasks:
        out.append({
            **{c.key: getattr(task, c.key) for c in task.__table__.columns},
            "channel_id": await _get_task_channel_id(db, task.id),
            "run_count": run_counts.get(task.id, 0),
            "latest_run_id": latest_by_task.get(task.id).id if task.id in latest_by_task else None,
        })
    return out


async def get_task(db: AsyncSession, workspace_id: UUID, task_id: UUID) -> dict | None:
    task = await db.get(Task, task_id)
    if task is None or task.workspace_id != workspace_id:
        return None
    rows = await list_tasks(db, workspace_id, task.project_id)
    for row in rows:
        if str(row["id"]) == str(task_id):
            return row
    return None


async def create_task(db: AsyncSession, workspace_id: UUID, data: TaskCreate) -> Task:
    if data.project_id is not None:
        project = await get_project(db, workspace_id, data.project_id)
        if project is None:
            raise ValueError("Project not found")
    if data.parent_task_id is not None:
        parent = await db.get(Task, data.parent_task_id)
        if parent is None or parent.workspace_id != workspace_id:
            raise ValueError("Parent objective not found")
        if parent.project_id != data.project_id:
            raise ValueError("Parent objective must belong to the same project")

    if data.origin_graph_id is not None:
        graph = await db.get(Graph, data.origin_graph_id)
        if graph is None or graph.workspace_id != workspace_id:
            raise ValueError("Workflow not found")
        if graph.project_id is not None and data.project_id != graph.project_id:
            raise ValueError("Project workflow can only spawn tasks into its own project")

    task = Task(
        workspace_id=workspace_id,
        project_id=data.project_id,
        parent_task_id=data.parent_task_id,
        code=(data.code or "").strip() or None,
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
    db.add(task)
    await db.flush()
    db.add(
        Channel(
            workspace_id=workspace_id,
            name=f"objective: {task.code or task.title}",
            channel_type="task",
            project_id=task.project_id,
            task_id=task.id,
        )
    )
    await db.commit()
    await db.refresh(task)
    return task


async def update_task(db: AsyncSession, workspace_id: UUID, task_id: UUID, data: TaskUpdate) -> Task | None:
    task = await db.get(Task, task_id)
    if task is None or task.workspace_id != workspace_id:
        return None
    payload = data.model_dump(exclude_unset=True)
    if "project_id" in payload and payload["project_id"] is not None:
        project = await get_project(db, workspace_id, payload["project_id"])
        if project is None:
            raise ValueError("Project not found")
        if task.origin_graph_id is not None:
            graph = await db.get(Graph, task.origin_graph_id)
            if graph and graph.project_id is not None and graph.project_id != payload["project_id"]:
                raise ValueError("Task spawned from a project workflow cannot move to another project")
    if "parent_task_id" in payload:
        parent_task_id = payload["parent_task_id"]
        if parent_task_id is not None:
            parent = await db.get(Task, parent_task_id)
            if parent is None or parent.workspace_id != workspace_id:
                raise ValueError("Parent objective not found")
            target_project_id = payload.get("project_id", task.project_id)
            if parent.project_id != target_project_id:
                raise ValueError("Parent objective must belong to the same project")
            if str(parent.id) == str(task.id):
                raise ValueError("Objective cannot be its own parent")
    if "progress_percent" in payload and payload["progress_percent"] is not None:
        payload["progress_percent"] = max(0, min(100, payload["progress_percent"]))
    if "key_results" in payload and payload["key_results"] is not None:
        payload["key_results"] = [item.strip() for item in payload["key_results"] if item.strip()]
    for key in ("code", "status_summary", "owner_type", "owner_name"):
        if key in payload:
            payload[key] = (payload[key] or "").strip() or None
    for field, value in payload.items():
        setattr(task, field, value)
    await db.execute(
        select(Channel).where(Channel.task_id == task.id)
    )
    result = await db.execute(select(Channel).where(Channel.task_id == task.id))
    channel = result.scalar_one_or_none()
    if channel is not None:
        channel.project_id = task.project_id
        channel.name = f"objective: {task.code or task.title}"
    await db.commit()
    await db.refresh(task)
    return task


async def list_project_documents(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[KnowledgeFile]:
    result = await db.execute(
        select(KnowledgeFile)
        .where(KnowledgeFile.workspace_id == workspace_id, KnowledgeFile.project_id == project_id)
        .order_by(KnowledgeFile.path.asc())
    )
    return list(result.scalars())


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


async def get_project_document_content(workspace_id: UUID, project_id: UUID, path: str):
    adapter = get_storage_adapter()
    return await adapter.read(_project_storage_key(workspace_id, project_id), path)


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
    tasks = await list_tasks(db, workspace_id, project_id)
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
    blocked_tasks = [task for task in tasks if task["status"] == "blocked"]
    return {
        "project": project_row,
        "tasks": tasks,
        "recent_runs": recent_runs,
        "blocked_tasks": blocked_tasks,
        "latest_status_update": project_row["latest_status_update"] if project_row else None,
    }
