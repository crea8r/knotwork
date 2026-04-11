"""
Folder management endpoints.

GET    /workspaces/{id}/knowledge/folders          — list all folders
POST   /workspaces/{id}/knowledge/folders          — create folder
DELETE /workspaces/{id}/knowledge/folders?path=    — delete folder + contents
PATCH  /workspaces/{id}/knowledge/folders?path=    — rename folder
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from libs.database import get_db

from . import knowledge_folder_service as svc
from .knowledge_schemas import CreateFolderRequest, KnowledgeFolderOut, RenameFolderRequest

router = APIRouter(prefix="/workspaces", tags=["knowledge-folders"])


@router.get("/{workspace_id}/knowledge/folders", response_model=list[KnowledgeFolderOut])
async def list_folders(workspace_id: UUID, db: AsyncSession = Depends(get_db)):
    return await svc.list_folders(db, workspace_id)


@router.post("/{workspace_id}/knowledge/folders", response_model=KnowledgeFolderOut, status_code=201)
async def create_folder(
    workspace_id: UUID,
    body: CreateFolderRequest,
    db: AsyncSession = Depends(get_db),
):
    path = body.path.strip("/")
    if not path:
        raise HTTPException(400, "Folder path cannot be empty")
    return await svc.create_folder(db, workspace_id, path)


@router.delete("/{workspace_id}/knowledge/folders", status_code=204)
async def delete_folder(
    workspace_id: UUID,
    path: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    await svc.delete_folder(db, workspace_id, path)


@router.patch("/{workspace_id}/knowledge/folders", status_code=204)
async def rename_folder(
    workspace_id: UUID,
    path: str = Query(...),
    body: RenameFolderRequest = ...,
    db: AsyncSession = Depends(get_db),
):
    """Rename or move a folder to a full new path."""
    new_path = body.new_path.strip("/")
    if not new_path:
        raise HTTPException(400, "Folder path cannot be empty")
    if new_path == path:
        return
    await svc.rename_folder(db, workspace_id, path, new_path)
