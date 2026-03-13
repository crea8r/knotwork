#!/usr/bin/env python3
"""Import selected default workflow templates into a workspace.

Usage examples:
  python scripts/import_default_workflows.py --list
  python scripts/import_default_workflows.py --workspace-id <uuid> --interactive
  python scripts/import_default_workflows.py --workspace-id <uuid> --workflow-id simple-writing
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import and_, select

from knotwork.database import AsyncSessionLocal
from knotwork.graphs.models import Graph, GraphVersion
from knotwork.knowledge import service as knowledge_service
from knotwork.knowledge.models import KnowledgeFile
from knotwork.runtime.knowledge_loader import load_knowledge_tree
from knotwork.workspaces.models import Workspace


CATALOG_PATH = Path(__file__).resolve().parents[1] / "knotwork" / "bootstrap" / "default_workflows.json"


def load_catalog() -> list[dict[str, Any]]:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Import default workflow templates into a workspace.")
    p.add_argument("--workspace-id", type=str, help="Target workspace UUID.")
    p.add_argument("--workflow-id", action="append", default=[], help="Template id to import (repeatable).")
    p.add_argument("--list", action="store_true", help="List available templates and exit.")
    p.add_argument("--interactive", action="store_true", help="Prompt for template selection.")
    p.add_argument("--allow-duplicates", action="store_true", help="Import even if same-name graph exists.")
    p.add_argument(
        "--skip-handbook",
        action="store_true",
        help="Do not import handbook dependencies referenced by workflow knowledge_paths.",
    )
    p.add_argument(
        "--overwrite-handbook",
        action="store_true",
        help="Overwrite existing handbook files in target workspace when importing dependencies.",
    )
    return p.parse_args()


def list_templates(catalog: list[dict[str, Any]]) -> None:
    print("Available default workflows:")
    for idx, item in enumerate(catalog, start=1):
        print(f"{idx}. {item['id']} :: {item['name']} (source={item['source_graph_id']})")


def interactive_select(catalog: list[dict[str, Any]]) -> list[str]:
    list_templates(catalog)
    raw = input("Select templates by number (comma-separated), blank = none: ").strip()
    if not raw:
        return []
    out: list[str] = []
    id_map = {str(i): row["id"] for i, row in enumerate(catalog, start=1)}
    for part in [p.strip() for p in raw.split(",")]:
        if part in id_map:
            out.append(id_map[part])
    return out


def _derive_title(path: str) -> str:
    stem = Path(path).stem
    return stem.replace("-", " ").replace("_", " ").strip().title() or path


def _extract_knowledge_refs(definition: dict[str, Any]) -> set[str]:
    refs: set[str] = set()
    for node in definition.get("nodes", []):
        if not isinstance(node, dict):
            continue
        cfg = node.get("config") or {}
        if not isinstance(cfg, dict):
            continue
        paths = cfg.get("knowledge_paths") or cfg.get("knowledge_files") or []
        if not isinstance(paths, list):
            continue
        for raw in paths:
            if not isinstance(raw, str):
                continue
            ref = raw.strip().lstrip("/")
            if ref:
                refs.add(ref)
    return refs


async def _resolve_root_knowledge_paths(
    db,
    source_workspace_id: UUID,
    refs: set[str],
) -> tuple[list[str], dict[str, str], list[str]]:
    rows = await db.execute(
        select(KnowledgeFile.path, KnowledgeFile.title).where(KnowledgeFile.workspace_id == source_workspace_id)
    )
    files = list(rows.all())
    source_paths = {str(p): str(t) for p, t in files}
    resolved: set[str] = set()
    unresolved: list[str] = []

    for ref in sorted(refs):
        matched = False
        if ref in source_paths:
            resolved.add(ref)
            matched = True
        alt = ref if ref.endswith(".md") else f"{ref}.md"
        if alt in source_paths:
            resolved.add(alt)
            matched = True

        prefix = ref.rstrip("/") + "/"
        folder_hits = [p for p in source_paths if p.startswith(prefix)]
        if folder_hits:
            resolved.update(folder_hits)
            matched = True

        if not matched:
            unresolved.append(ref)

    return sorted(resolved), source_paths, unresolved


async def _import_handbook_dependencies(
    db,
    workflow_row: dict[str, Any],
    target_workspace_id: UUID,
    overwrite_handbook: bool,
) -> tuple[int, int, list[str]]:
    source_workspace_id = UUID(workflow_row["source_workspace_id"])
    refs = _extract_knowledge_refs(workflow_row["definition"])
    if not refs:
        return 0, 0, []

    roots, source_title_map, unresolved = await _resolve_root_knowledge_paths(
        db=db,
        source_workspace_id=source_workspace_id,
        refs=refs,
    )
    if not roots:
        return 0, 0, unresolved

    tree = await load_knowledge_tree(roots, str(source_workspace_id))
    imported = 0
    skipped = 0
    for fragment in tree.fragments:
        existing = await knowledge_service.get_file_by_path(db, target_workspace_id, fragment.path)
        if existing is not None and not overwrite_handbook:
            skipped += 1
            continue

        title = source_title_map.get(fragment.path) or _derive_title(fragment.path)
        if existing is None:
            await knowledge_service.create_file(
                db=db,
                workspace_id=target_workspace_id,
                path=fragment.path,
                title=title,
                content=fragment.content,
                created_by="bootstrap:default-workflow-import",
                change_summary=f"Imported dependency from template {workflow_row['id']}",
            )
        else:
            await knowledge_service.update_file(
                db=db,
                workspace_id=target_workspace_id,
                path=fragment.path,
                content=fragment.content,
                updated_by="bootstrap:default-workflow-import",
                change_summary=f"Overwritten by template {workflow_row['id']}",
            )
        imported += 1

    unresolved.extend(tree.missing_links)
    return imported, skipped, sorted(set(unresolved))


async def import_templates(
    workspace_id: UUID,
    selected_ids: list[str],
    catalog: list[dict[str, Any]],
    allow_duplicates: bool,
    skip_handbook: bool,
    overwrite_handbook: bool,
) -> None:
    selected = [row for row in catalog if row["id"] in selected_ids]
    if not selected:
        print("No templates selected; nothing imported.")
        return

    async with AsyncSessionLocal() as db:
        ws = await db.get(Workspace, workspace_id)
        if ws is None:
            raise SystemExit(f"Workspace not found: {workspace_id}")

        imported = 0
        skipped = 0
        handbook_imported = 0
        handbook_skipped = 0
        unresolved_refs: list[str] = []
        for row in selected:
            exists = await db.execute(
                select(Graph.id).where(
                    and_(
                        Graph.workspace_id == workspace_id,
                        Graph.name == row["name"],
                    )
                ).limit(1)
            )
            if exists.scalar_one_or_none() and not allow_duplicates:
                skipped += 1
                print(f"Skip existing graph name: {row['name']}")
                continue

            graph = Graph(
                id=uuid4(),
                workspace_id=workspace_id,
                name=row["name"],
                description=row.get("description"),
                status="draft",
            )
            db.add(graph)
            await db.flush()

            db.add(
                GraphVersion(
                    id=uuid4(),
                    graph_id=graph.id,
                    definition=row["definition"],
                    note=f"Imported from default template {row['id']} (source {row['source_graph_id']})",
                )
            )
            if not skip_handbook:
                dep_imported, dep_skipped, dep_unresolved = await _import_handbook_dependencies(
                    db=db,
                    workflow_row=row,
                    target_workspace_id=workspace_id,
                    overwrite_handbook=overwrite_handbook,
                )
                handbook_imported += dep_imported
                handbook_skipped += dep_skipped
                unresolved_refs.extend(dep_unresolved)
            imported += 1
            print(f"Imported: {row['id']} -> graph_id={graph.id}")

        await db.commit()
        print(
            "Done. "
            f"workflows_imported={imported} workflows_skipped={skipped} "
            f"handbook_imported={handbook_imported} handbook_skipped={handbook_skipped}"
        )
        if unresolved_refs:
            print("Unresolved handbook refs:")
            for ref in sorted(set(unresolved_refs)):
                print(f"- {ref}")


async def main() -> None:
    catalog = load_catalog()
    args = parse_args()

    if args.list:
        list_templates(catalog)
        return

    selected_ids: list[str] = list(dict.fromkeys(args.workflow_id))
    if args.interactive:
        selected_ids = list(dict.fromkeys(interactive_select(catalog)))

    if not args.workspace_id:
        raise SystemExit("--workspace-id is required unless --list is used")

    unknown = [wid for wid in selected_ids if wid not in {r["id"] for r in catalog}]
    if unknown:
        raise SystemExit(f"Unknown workflow id(s): {', '.join(unknown)}")

    await import_templates(
        workspace_id=UUID(args.workspace_id),
        selected_ids=selected_ids,
        catalog=catalog,
        allow_duplicates=args.allow_duplicates,
        skip_handbook=args.skip_handbook,
        overwrite_handbook=args.overwrite_handbook,
    )


if __name__ == "__main__":
    asyncio.run(main())
