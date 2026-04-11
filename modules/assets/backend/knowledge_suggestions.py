"""
Knowledge improvement suggestions are disabled in this build.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .knowledge_models import KnowledgeFile, KnowledgeHealthLog

async def generate_suggestions(file_id: UUID, db: AsyncSession) -> list[str]:
    """
    Generate Mode B improvement suggestions for a knowledge file.

    Returns up to 3 suggestions, or [] on any error.
    """
    _ = (file_id, db, KnowledgeFile, KnowledgeHealthLog, select)
    return []
