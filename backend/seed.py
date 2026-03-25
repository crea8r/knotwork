#!/usr/bin/env python3
"""
Seed script: create a default dev workspace + demo graph if none exists.
Upserts VITE_DEV_WORKSPACE_ID into the root .env so Vite and pydantic-settings
both pick it up from a single file.

Usage: .venv/bin/python seed.py
"""
import asyncio
from pathlib import Path

ROOT = Path(__file__).parent.parent

DEMO_GRAPH = {
    "nodes": [
        {
            "id": "agent-1",
            "type": "llm_agent",
            "name": "Analyse",
            "config": {
                "instructions": "You are a helpful assistant. Summarise the input clearly and concisely."
            },
        },
        {
            "id": "checkpoint-1",
            "type": "human_checkpoint",
            "name": "Review",
            "config": {
                "prompt_to_operator": "Please review the summary above and approve or edit."
            },
        },
    ],
    "edges": [
        {"id": "e1", "source": "agent-1", "target": "checkpoint-1", "type": "direct"}
    ],
    "entry_point": "agent-1",
}


async def main() -> None:
    # Import all models so FK resolution works
    import knotwork.auth.models          # noqa: F401
    import knotwork.workspaces.models    # noqa: F401
    import knotwork.graphs.models        # noqa: F401
    import knotwork.runs.models          # noqa: F401
    import knotwork.knowledge.models     # noqa: F401
    import knotwork.tools.models         # noqa: F401
    import knotwork.escalations.models   # noqa: F401
    import knotwork.ratings.models       # noqa: F401
    import knotwork.audit.models         # noqa: F401

    from sqlalchemy import select
    from knotwork.database import AsyncSessionLocal
    from knotwork.workspaces.models import Workspace
    from knotwork.graphs.models import Graph, GraphVersion
    from knotwork.utils.namegen import generate_name

    async with AsyncSessionLocal() as db:
        # Workspace
        result = await db.execute(select(Workspace).limit(1))
        ws = result.scalar_one_or_none()
        if ws is None:
            ws = Workspace(name="Dev Workspace", slug="dev")
            db.add(ws)
            await db.commit()
            await db.refresh(ws)
            print(f"Created workspace: {ws.id}")
        else:
            print(f"Using existing workspace: {ws.id}")

        # Demo graph
        result = await db.execute(
            select(Graph).where(Graph.workspace_id == ws.id).limit(1)
        )
        graph = result.scalar_one_or_none()
        if graph is None:
            graph = Graph(workspace_id=ws.id, name="Demo — Analyse & Review", path="building")
            db.add(graph)
            await db.flush()
            version = GraphVersion(graph_id=graph.id, definition=DEMO_GRAPH, version_name=generate_name())
            db.add(version)
            await db.commit()
            await db.refresh(graph)
            print(f"Created demo graph: {graph.id}")
        else:
            print(f"Demo graph already exists: {graph.id}")

    # Upsert VITE_DEV_WORKSPACE_ID in the root .env so both Vite and pydantic-settings
    # pick it up. We only write/update this one key and leave everything else intact.
    root_env = ROOT / ".env"
    key = "VITE_DEV_WORKSPACE_ID"
    value = str(ws.id)
    if root_env.exists():
        lines = root_env.read_text().splitlines(keepends=True)
        found = False
        new_lines = []
        for line in lines:
            if line.startswith(f"{key}=") or line.startswith(f"{key} ="):
                new_lines.append(f"{key}={value}\n")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"{key}={value}\n")
        root_env.write_text("".join(new_lines))
    else:
        root_env.write_text(f"{key}={value}\n")
    print(f"Updated {root_env} with {key}={value}")


asyncio.run(main())
