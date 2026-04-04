from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.models import User
from knotwork.workspaces.models import WorkspaceMember


MENTION_RE = re.compile(r"(?<!\w)@([A-Za-z0-9._-]+)")


def human_participant_id(user_id: UUID) -> str:
    return f"human:{user_id}"


def agent_participant_id(agent_id: UUID) -> str:
    return f"agent:{agent_id}"


def member_participant_id(member: WorkspaceMember, user_id: UUID) -> str:
    if member.kind == "agent":
        return agent_participant_id(member.id)
    return human_participant_id(user_id)


def participant_kind(participant_id: str) -> str:
    return participant_id.split(":", 1)[0] if ":" in participant_id else "unknown"


def parse_participant_id(participant_id: str) -> tuple[str, str]:
    if ":" not in participant_id:
        raise ValueError(f"Invalid participant id: {participant_id}")
    return tuple(participant_id.split(":", 1))  # type: ignore[return-value]


def mention_tokens(text: str) -> list[str]:
    return [token.lower() for token in MENTION_RE.findall(text or "")]


def _normalize_alias(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = re.sub(r"[^a-z0-9._-]+", "", value.strip().lower())
    return cleaned or None


def _name_aliases(value: str | None) -> set[str]:
    aliases: set[str] = set()
    if not value:
        return aliases
    parts = re.split(r"[^A-Za-z0-9._-]+", value.strip().lower())
    joined = _normalize_alias(value.replace(" ", ""))
    if joined:
        aliases.add(joined)
    for part in parts:
        alias = _normalize_alias(part)
        if alias:
            aliases.add(alias)
    return aliases


def _preferred_human_handle(user_name: str | None, email: str | None) -> str | None:
    email_local = (email or "").split("@", 1)[0]
    email_alias = _normalize_alias(email_local)
    if email_alias:
        return email_alias
    aliases = sorted(_name_aliases(user_name))
    return aliases[0] if aliases else None


def _preferred_agent_handle(display_name: str | None, agent_ref: str | None) -> str | None:
    aliases = _name_aliases(display_name)
    ref_alias = _normalize_alias((agent_ref or "").split(":", 1)[-1])
    if ref_alias:
        aliases.add(ref_alias)
    ordered = sorted(aliases)
    return ordered[0] if ordered else None


async def list_workspace_human_participants(
    db: AsyncSession, workspace_id: UUID
) -> list[dict]:
    rows = await db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.kind == "human",
            WorkspaceMember.access_disabled_at.is_(None),
        )
    )
    out: list[dict] = []
    for member, user in rows.all():
        aliases = _name_aliases(user.name)
        email_local = (user.email or "").split("@", 1)[0]
        email_alias = _normalize_alias(email_local)
        if email_alias:
            aliases.add(email_alias)
        out.append(
            {
                "participant_id": human_participant_id(user.id),
                "user_id": user.id,
                "display_name": user.name,
                "mention_handle": _preferred_human_handle(user.name, user.email),
                "email": user.email,
                "role": member.role,
                "kind": "human",
                "aliases": aliases,
            }
        )
    return out


async def list_workspace_agent_participants(
    db: AsyncSession, workspace_id: UUID
) -> list[dict]:
    rows = await db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.kind == "agent",
            WorkspaceMember.access_disabled_at.is_(None),
        )
    )
    out: list[dict] = []
    for member, user in rows.all():
        config = member.agent_config or {}
        agent_ref = config.get("agent_ref") or ""
        aliases = _name_aliases(user.name)
        ref_alias = _normalize_alias(
            agent_ref.split(":", 1)[-1] if ":" in agent_ref else agent_ref
        )
        if ref_alias:
            aliases.add(ref_alias)
        out.append(
            {
                "participant_id": agent_participant_id(member.id),
                "member_id": member.id,
                "display_name": user.name,
                "mention_handle": _preferred_agent_handle(user.name, agent_ref),
                "provider": config.get("provider"),
                "kind": "agent",
                "aliases": aliases,
            }
        )
    return out


async def resolve_mentioned_participants(
    db: AsyncSession, workspace_id: UUID, text: str
) -> list[dict]:
    tokens = set(mention_tokens(text))
    if not tokens:
        return []

    participants = await list_workspace_participants(db, workspace_id)

    matched: list[dict] = []
    for participant in participants:
        if tokens.intersection(participant.get("aliases") or set()):
            matched.append(participant)
    return matched


async def list_workspace_participants(
    db: AsyncSession, workspace_id: UUID
) -> list[dict]:
    rows = await db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.access_disabled_at.is_(None),
        )
    )
    participants: list[dict] = []
    for member, user in rows.all():
        config = member.agent_config or {}
        agent_ref = str(config.get("agent_ref") or "")
        aliases = _name_aliases(user.name)
        email_local = (user.email or "").split("@", 1)[0]
        email_alias = _normalize_alias(email_local)
        if email_alias:
            aliases.add(email_alias)
        ref_alias = _normalize_alias(
            agent_ref.split(":", 1)[-1] if ":" in agent_ref else agent_ref
        )
        if ref_alias:
            aliases.add(ref_alias)
        participants.append(
            {
                "participant_id": member_participant_id(member, user.id),
                "member_id": member.id,
                "user_id": user.id,
                "display_name": user.name,
                "mention_handle": (
                    _preferred_agent_handle(user.name, agent_ref)
                    if member.kind == "agent"
                    else _preferred_human_handle(user.name, user.email)
                ),
                "email": user.email,
                "provider": config.get("provider"),
                "role": member.role,
                "kind": member.kind,
                "aliases": aliases,
            }
        )
    participants.sort(key=lambda participant: str(participant.get("display_name") or "").lower())
    return participants
