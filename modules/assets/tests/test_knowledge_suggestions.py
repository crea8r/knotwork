from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from modules.assets.backend.knowledge_models import KnowledgeFile
from modules.assets.backend.knowledge_suggestions import generate_suggestions


@pytest.mark.asyncio
async def test_suggestions_file_not_found_returns_empty(db: AsyncSession):
    assert await generate_suggestions(uuid4(), db) == []


@pytest.mark.asyncio
async def test_suggestions_disabled_for_existing_file(db: AsyncSession, workspace):
    file = KnowledgeFile(
        workspace_id=workspace.id,
        path="shared/guide.md",
        title="Guide",
        raw_token_count=50,
        resolved_token_count=50,
        linked_paths=[],
    )
    db.add(file)
    await db.commit()
    await db.refresh(file)

    assert await generate_suggestions(file.id, db) == []
