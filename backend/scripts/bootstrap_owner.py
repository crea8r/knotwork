#!/usr/bin/env python3
"""Create or reuse owner user + workspace membership for installer bootstrap."""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from uuid import uuid4

from sqlalchemy import and_, select

from knotwork.auth.models import User
from knotwork.database import AsyncSessionLocal
from knotwork.workspaces.models import Workspace, WorkspaceMember


def _slugify(text: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", text.strip().lower()).strip("-")
    return base or "workspace"


async def _ensure_unique_slug(db, wanted: str) -> str:
    slug = wanted
    idx = 2
    while True:
        q = await db.execute(select(Workspace.id).where(Workspace.slug == slug).limit(1))
        if q.scalar_one_or_none() is None:
            return slug
        slug = f"{wanted}-{idx}"
        idx += 1


async def main() -> None:
    ap = argparse.ArgumentParser(description="Bootstrap owner user/workspace for fresh install.")
    ap.add_argument("--owner-name", required=True)
    ap.add_argument("--owner-email", required=True)
    ap.add_argument("--workspace-name", default="")
    ap.add_argument("--workspace-slug", default="")
    args = ap.parse_args()

    owner_name = args.owner_name.strip()
    owner_email = args.owner_email.strip().lower()
    workspace_name = (args.workspace_name or f"{owner_name}'s Workspace").strip()
    workspace_slug = (args.workspace_slug or _slugify(workspace_name)).strip()

    if not owner_name:
        raise SystemExit("owner-name is required")
    if "@" not in owner_email:
        raise SystemExit("owner-email must be a valid email")

    async with AsyncSessionLocal() as db:
        user_q = await db.execute(select(User).where(User.email == owner_email).limit(1))
        user = user_q.scalar_one_or_none()
        created_user = False
        if user is None:
            user = User(
                id=uuid4(),
                email=owner_email,
                name=owner_name,
                hashed_password="!no-password",
            )
            db.add(user)
            await db.flush()
            created_user = True
        elif not user.name.strip():
            user.name = owner_name

        member_q = await db.execute(
            select(WorkspaceMember, Workspace)
            .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
            .where(WorkspaceMember.user_id == user.id)
            .where(WorkspaceMember.role == "owner")
            .order_by(Workspace.created_at.asc())
            .limit(1)
        )
        row = member_q.first()
        created_workspace = False
        created_membership = False

        if row is None:
            slug = await _ensure_unique_slug(db, workspace_slug)
            workspace = Workspace(
                id=uuid4(),
                name=workspace_name,
                slug=slug,
            )
            db.add(workspace)
            await db.flush()

            member = WorkspaceMember(
                id=uuid4(),
                workspace_id=workspace.id,
                user_id=user.id,
                role="owner",
            )
            db.add(member)
            created_workspace = True
            created_membership = True
        else:
            member, workspace = row
            if member.role != "owner":
                member.role = "owner"

        await db.commit()

        print(json.dumps({
            "owner_user_id": str(user.id),
            "owner_email": owner_email,
            "workspace_id": str(workspace.id),
            "workspace_name": workspace.name,
            "workspace_slug": workspace.slug,
            "created_user": created_user,
            "created_workspace": created_workspace,
            "created_membership": created_membership,
        }))


if __name__ == "__main__":
    asyncio.run(main())
