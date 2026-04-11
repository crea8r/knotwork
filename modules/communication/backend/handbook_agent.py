from __future__ import annotations

import json
import logging
import re
from uuid import UUID
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from core.api import knowledge as core_knowledge

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
    _ = (db, workspace_id, message, core_knowledge, json, logger, re, uuid4, _SYSTEM)
    return {
        "reply": "Handbook agent editing is disabled in this build. Edit the file directly in Assets.",
        "proposal": None,
    }
