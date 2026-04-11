from __future__ import annotations

import re
import secrets

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .graphs_models import Graph, GraphVersion


def _slugify(name: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '-', (name or 'workflow').lower().strip())
    return slug.strip('-')[:60] or 'workflow'


def generate_public_slug(name: str) -> str:
    return f"{_slugify(name)}-{secrets.token_hex(2)}"


async def ensure_graph_slug(db: AsyncSession, graph: Graph) -> str:
    """Set graph.slug if not already set. Caller must commit."""
    if graph.slug:
        return graph.slug
    graph.slug = generate_public_slug(graph.name)
    await db.flush()
    return graph.slug


async def resolve_version_by_slugs(
    db: AsyncSession, graph_slug: str, version_slug: str
) -> tuple[Graph, GraphVersion]:
    """Resolve /public/workflows/{graph_slug}/{version_slug}."""
    rows = await db.execute(select(Graph).where(Graph.slug == graph_slug))
    graph = rows.scalar_one_or_none()
    if graph is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    rows = await db.execute(
        select(GraphVersion).where(
            GraphVersion.graph_id == graph.id,
            GraphVersion.version_slug == version_slug,
        )
    )
    version = rows.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return graph, version


async def resolve_default_version_by_graph_slug(
    db: AsyncSession, graph_slug: str
) -> tuple[Graph, GraphVersion]:
    """Resolve /public/workflows/{graph_slug} → default version."""
    rows = await db.execute(select(Graph).where(Graph.slug == graph_slug))
    graph = rows.scalar_one_or_none()
    if graph is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if not graph.production_version_id:
        raise HTTPException(status_code=404, detail="No default version set")
    version = await db.get(GraphVersion, graph.production_version_id)
    if version is None or version.version_slug is None:
        raise HTTPException(status_code=404, detail="Default version has no public link")
    return graph, version
