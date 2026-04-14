#!/usr/bin/env python3
"""Create or reuse owner user, but always create a fresh workspace for installer bootstrap."""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from libs.auth.backend.models import User
from libs.auth.backend.service import set_user_password
from libs.database import AsyncSessionLocal
from modules.admin.backend.workspaces_guide import DEFAULT_GUIDE_MD
from modules.admin.backend.workspaces_models import Workspace, WorkspaceMember
from modules.communication.backend import channels_service as channel_service


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
    ap.add_argument("--owner-password", default="")
    ap.add_argument("--workspace-name", default="")
    ap.add_argument("--workspace-slug", default="")
    args = ap.parse_args()

    owner_name = args.owner_name.strip()
    owner_email = args.owner_email.strip().lower()
    owner_password = args.owner_password.strip() or "admin"
    uses_default_password = owner_password == "admin"
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
            )
            set_user_password(user, owner_password, must_change_password=uses_default_password)
            db.add(user)
            await db.flush()
            created_user = True
        else:
            if not user.name.strip():
                user.name = owner_name
            set_user_password(user, owner_password, must_change_password=uses_default_password)

        slug = await _ensure_unique_slug(db, workspace_slug)
        workspace = Workspace(
            id=uuid4(),
            name=workspace_name,
            slug=slug,
            guide_md=DEFAULT_GUIDE_MD,
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

        await db.flush()
        await channel_service.ensure_bulletin_channel(db, workspace.id)
        await channel_service.ensure_default_channel_subscriptions(db, workspace.id)
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
            "uses_default_password": uses_default_password,
        }))


if __name__ == "__main__":
    asyncio.run(main())
