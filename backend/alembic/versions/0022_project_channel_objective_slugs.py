"""add slugs for projects channels objectives

Revision ID: 0022_entity_slugs
Revises: 0021_drop_designer_chat_messages
Create Date: 2026-03-28
"""

from __future__ import annotations

import secrets
import string

import sqlalchemy as sa
from alembic import op
from sqlalchemy.sql import table, column


revision = "0022_entity_slugs"
down_revision = "0021_drop_designer_chat_messages"
branch_labels = None
depends_on = None


alphabet = string.ascii_lowercase + string.digits


def _slugify(value: str, fallback: str) -> str:
    import re

    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower().strip()).strip("-")
    return (slug[:72] or fallback).strip("-")


def _make_slug(value: str, fallback: str) -> str:
    suffix = "".join(secrets.choice(alphabet) for _ in range(4))
    return f"{_slugify(value, fallback)}-{suffix}"


def upgrade() -> None:
    op.add_column("projects", sa.Column("slug", sa.String(length=200), nullable=True))
    op.add_column("channels", sa.Column("slug", sa.String(length=200), nullable=True))
    op.add_column("objectives", sa.Column("slug", sa.String(length=200), nullable=True))

    bind = op.get_bind()
    projects = table("projects", column("id", sa.Uuid), column("title", sa.String), column("slug", sa.String))
    channels = table("channels", column("id", sa.Uuid), column("name", sa.String), column("slug", sa.String))
    objectives = table(
        "objectives",
        column("id", sa.Uuid),
        column("code", sa.String),
        column("title", sa.String),
        column("slug", sa.String),
    )

    used_project_slugs: set[str] = set()
    for row in bind.execute(sa.text("SELECT id, title FROM projects")):
      slug = _make_slug(row.title or "project", "project")
      while slug in used_project_slugs:
          slug = _make_slug(row.title or "project", "project")
      used_project_slugs.add(slug)
      bind.execute(projects.update().where(projects.c.id == row.id).values(slug=slug))

    used_channel_slugs: set[str] = set()
    for row in bind.execute(sa.text("SELECT id, name FROM channels")):
      slug = _make_slug(row.name or "channel", "channel")
      while slug in used_channel_slugs:
          slug = _make_slug(row.name or "channel", "channel")
      used_channel_slugs.add(slug)
      bind.execute(channels.update().where(channels.c.id == row.id).values(slug=slug))

    used_objective_slugs: set[str] = set()
    for row in bind.execute(sa.text("SELECT id, code, title FROM objectives")):
      source = " ".join(part for part in (row.code, row.title) if part)
      slug = _make_slug(source or "objective", "objective")
      while slug in used_objective_slugs:
          slug = _make_slug(source or "objective", "objective")
      used_objective_slugs.add(slug)
      bind.execute(objectives.update().where(objectives.c.id == row.id).values(slug=slug))

    op.alter_column("projects", "slug", nullable=False)
    op.alter_column("channels", "slug", nullable=False)
    op.alter_column("objectives", "slug", nullable=False)
    op.create_unique_constraint("uq_projects_slug", "projects", ["slug"])
    op.create_unique_constraint("uq_channels_slug", "channels", ["slug"])
    op.create_unique_constraint("uq_objectives_slug", "objectives", ["slug"])


def downgrade() -> None:
    op.drop_constraint("uq_objectives_slug", "objectives", type_="unique")
    op.drop_constraint("uq_channels_slug", "channels", type_="unique")
    op.drop_constraint("uq_projects_slug", "projects", type_="unique")
    op.drop_column("objectives", "slug")
    op.drop_column("channels", "slug")
    op.drop_column("projects", "slug")
