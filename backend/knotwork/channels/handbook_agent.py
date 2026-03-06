from __future__ import annotations

import json
import logging
import re
from uuid import UUID
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.knowledge import service as knowledge_service

logger = logging.getLogger(__name__)

_SYSTEM = """\
You are Knotwork Handbook Agent.
You help users maintain the company handbook by proposing concrete file edits.

You can:
- create new files
- rewrite existing files
- move/split/merge content by proposing the resulting target file content

Always return strict JSON:
{
  "reply": "human-readable reply",
  "proposal": {
    "path": "handbook/path.md",
    "reason": "why this update is needed",
    "proposed_content": "full markdown content"
  } | null
}

Rules:
- If user asks for a content change, include one proposal.
- If user asks a pure question, proposal can be null.
- Keep reply concise and actionable.
"""


async def ask_handbook_agent(
    db: AsyncSession,
    workspace_id: UUID,
    message: str,
) -> dict:
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_openai import ChatOpenAI
    from knotwork.config import settings

    files = await knowledge_service.list_files(db, workspace_id=workspace_id)

    # Include structure + as much content as fits a reasonable prompt budget.
    segments: list[str] = []
    budget = 120_000
    used = 0
    for f in files:
        content = ""
        try:
            adapter = knowledge_service.get_storage_adapter()
            fc = await adapter.read(str(workspace_id), f.path)
            content = fc.content
        except Exception:
            content = ""
        block = (
            f"PATH: {f.path}\n"
            f"TITLE: {f.title}\n"
            f"CONTENT:\n{content}\n"
            f"{'-' * 40}\n"
        )
        if used + len(block) > budget:
            break
        segments.append(block)
        used += len(block)

    handbook_context = "".join(segments) if segments else "(No handbook files yet)"
    system = f"{_SYSTEM}\n\nCurrent handbook snapshot:\n{handbook_context}"

    try:
        llm = ChatOpenAI(
            model="gpt-4o-mini",
            temperature=0,
            api_key=settings.openai_api_key,
            model_kwargs={"response_format": {"type": "json_object"}},
        )
        response = await llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=message),
        ])
        raw = str(response.content).strip()
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw).strip()
    except Exception as exc:
        logger.warning("handbook agent call failed: %s", exc)
        return {"reply": "I could not process this request right now. Please try again.", "proposal": None}
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise ValueError("not a dict")
    except Exception:
        logger.warning("handbook agent returned non-json: %s", raw)
        return {"reply": "I could not produce a structured update. Please rephrase.", "proposal": None}

    reply = str(parsed.get("reply") or "").strip()
    proposal = parsed.get("proposal")
    if not isinstance(proposal, dict):
        proposal = None
    else:
        path = str(proposal.get("path") or "").strip()
        reason = str(proposal.get("reason") or "").strip()
        proposed_content = str(proposal.get("proposed_content") or "").strip()
        if not path or not reason or not proposed_content:
            proposal = None
        else:
            proposal = {
                "proposal_id": str(uuid4()),
                "path": path,
                "reason": reason,
                "proposed_content": proposed_content,
                "status": "pending",
            }

    return {"reply": reply or "I reviewed your request.", "proposal": proposal}
