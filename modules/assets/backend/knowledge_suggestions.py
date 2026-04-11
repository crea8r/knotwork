"""
Mode B: LLM-generated knowledge improvement suggestions.

Looks at file content + health signals and returns up to 3 actionable suggestions.
Fails silently — returns [] if LLM is unavailable or returns malformed output.
"""
from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .knowledge_models import KnowledgeFile, KnowledgeHealthLog
from .storage import get_storage_adapter

_PROMPT = """You are a knowledge quality analyst for a business process handbook.
A knowledge file used by AI agents is shown below.

Health score: {health_score:.1f}/5.0 — token count: {token_count}, \
confidence signal: {confidence:.1f}/5, escalation signal: {escalation:.1f}/5, \
rating signal: {rating:.1f}/5

File path: {path}
---
{content}
---

Give up to 3 specific, actionable suggestions to improve this file's quality as an \
AI agent context source. Focus on: clarity, completeness, removing ambiguity, examples.
Respond with only a JSON array of strings. Example: ["Add examples for X", "Clarify Y rule"]"""


async def generate_suggestions(file_id: UUID, db: AsyncSession) -> list[str]:
    """
    Generate Mode B improvement suggestions for a knowledge file.

    Returns up to 3 suggestions, or [] on any error.
    """
    file = await db.get(KnowledgeFile, file_id)
    if file is None:
        return []

    # Get latest health log for signal breakdown
    log_result = await db.execute(
        select(KnowledgeHealthLog)
        .where(KnowledgeHealthLog.file_id == file_id)
        .order_by(KnowledgeHealthLog.computed_at.desc())
        .limit(1)
    )
    log = log_result.scalars().first()

    adapter = get_storage_adapter()
    try:
        fc = await adapter.read(str(file.workspace_id), file.path)
        content = fc.content[:2000]  # cap to avoid huge prompts
    except FileNotFoundError:
        content = "(file content not available)"

    health = file.health_score or 0.0
    conf = log.confidence_score if log else 0.0
    esc = log.escalation_score if log else 0.0
    rating = log.rating_score if log else 0.0

    prompt = _PROMPT.format(
        health_score=health,
        token_count=file.raw_token_count,
        confidence=conf,
        escalation=esc,
        rating=rating,
        path=file.path,
        content=content,
    )

    try:
        from langchain_openai import ChatOpenAI

        from libs.config import settings
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, api_key=settings.openai_api_key)
        response = await llm.ainvoke(prompt)
        suggestions = json.loads(response.content)
        if isinstance(suggestions, list):
            return [str(s) for s in suggestions[:3]]
    except Exception:
        pass

    return []
