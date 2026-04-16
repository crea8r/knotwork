from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from . import service as graphs_service
from . import version_service as graphs_version_service


def _normalize_graph_node(node: dict) -> dict:
    return {
        **node,
        "config": dict(node.get("config") or {}) if isinstance(node.get("config"), dict) else {},
    }


def _normalize_graph_edge(edge: dict) -> dict:
    return {
        **edge,
        "type": str(edge.get("type") or "direct"),
        "condition_label": str(edge.get("condition_label") or "").strip() or None,
    }


def _normalize_input_field(field: dict) -> dict:
    field_type = str(field.get("type") or "text")
    return {
        "name": str(field.get("name") or ""),
        "label": str(field.get("label") or ""),
        "description": str(field.get("description") or ""),
        "required": bool(field.get("required", True)),
        "type": field_type if field_type in {"text", "textarea", "number"} else "text",
    }


def _clone_definition(definition: dict | None) -> dict:
    base = definition if isinstance(definition, dict) else {}
    return {
        "nodes": [_normalize_graph_node(node) for node in base.get("nodes") or [] if isinstance(node, dict)],
        "edges": [_normalize_graph_edge(edge) for edge in base.get("edges") or [] if isinstance(edge, dict)],
        "entry_point": str(base.get("entry_point")) if isinstance(base.get("entry_point"), str) else None,
        "input_schema": [_normalize_input_field(field) for field in base.get("input_schema") or [] if isinstance(field, dict)],
    }


def _ensure_boundary_nodes(definition: dict) -> dict:
    nodes = definition["nodes"]
    edges = definition["edges"]
    has_start = any(node.get("id") == "start" and node.get("type") == "start" for node in nodes)
    has_end = any(node.get("id") == "end" and node.get("type") == "end" for node in nodes)
    work_nodes = [node for node in nodes if node.get("type") not in {"start", "end"}]
    if not work_nodes:
        return definition
    if not has_start:
        nodes.insert(0, {"id": "start", "type": "start", "name": "Start", "config": {}})
    if not has_end:
        nodes.append({"id": "end", "type": "end", "name": "End", "config": {}})
    if work_nodes and not any(edge.get("source") == "start" for edge in edges):
        first_work_node = str(work_nodes[0].get("id") or "")
        if first_work_node:
            edges.insert(
                0,
                {"id": f"e-start-{first_work_node}", "source": "start", "target": first_work_node, "type": "direct"},
            )
    end_incoming = {edge.get("source") for edge in edges if edge.get("target") == "end"}
    work_outgoing: dict[str, int] = {}
    for edge in edges:
        source = str(edge.get("source") or "")
        if source and source not in {"start", "end"}:
            work_outgoing[source] = work_outgoing.get(source, 0) + 1
    for node in nodes:
        node_id = str(node.get("id") or "")
        node_type = str(node.get("type") or "")
        if node_type in {"start", "end"}:
            continue
        if work_outgoing.get(node_id, 0) == 0 and node_id not in end_incoming:
            edges.append({"id": f"e-{node_id}-end", "source": node_id, "target": "end", "type": "direct"})
    return definition


def apply_graph_delta(current_definition: dict | None, delta_input: dict) -> dict:
    definition = _clone_definition(current_definition)
    nodes_by_id = {str(node["id"]): node for node in definition["nodes"]}
    edges_by_id = {str(edge["id"]): edge for edge in definition["edges"]}

    for node_id in delta_input.get("remove_nodes") or []:
        nodes_by_id.pop(str(node_id), None)
    for node in delta_input.get("add_nodes") or []:
        if isinstance(node, dict):
            nodes_by_id[str(node["id"])] = _normalize_graph_node(node)
    for update in delta_input.get("update_nodes") or []:
        if not isinstance(update, dict) or "id" not in update:
            continue
        existing = dict(
            nodes_by_id.get(str(update["id"]))
            or {
                "id": str(update["id"]),
                "type": "agent",
                "name": str(update["id"]),
                "config": {},
            }
        )
        if isinstance(update.get("config"), dict):
            existing["config"] = {**dict(existing.get("config") or {}), **update["config"]}
        for key in (
            "name",
            "type",
            "note",
            "agent_ref",
            "trust_level",
            "registered_agent_id",
            "operator_id",
            "supervisor_id",
        ):
            if key in update:
                existing[key] = update[key]
        nodes_by_id[str(update["id"])] = existing

    for edge_id in delta_input.get("remove_edges") or []:
        edges_by_id.pop(str(edge_id), None)
    for edge in delta_input.get("add_edges") or []:
        if isinstance(edge, dict):
            edges_by_id[str(edge["id"])] = _normalize_graph_edge(edge)

    definition["nodes"] = list(nodes_by_id.values())
    definition["edges"] = [
        edge
        for edge in edges_by_id.values()
        if str(edge.get("source") or "") in nodes_by_id and str(edge.get("target") or "") in nodes_by_id
    ]
    if "set_entry_point" in delta_input:
        definition["entry_point"] = (
            str(delta_input.get("set_entry_point")) if isinstance(delta_input.get("set_entry_point"), str) else None
        )
    if isinstance(delta_input.get("set_input_schema"), list):
        definition["input_schema"] = [
            _normalize_input_field(field)
            for field in delta_input["set_input_schema"]
            if isinstance(field, dict)
        ]
    normalized = _ensure_boundary_nodes(definition)
    return {
        "nodes": normalized["nodes"],
        "edges": normalized["edges"],
        "entry_point": normalized["entry_point"],
        "input_schema": normalized["input_schema"],
    }


async def update_root_draft(
    db: AsyncSession,
    graph_id: UUID,
    definition: dict,
    created_by: UUID | None = None,
):
    return await graphs_version_service.upsert_draft(db, graph_id, None, definition, created_by=created_by)


async def apply_delta_to_root_draft(
    db: AsyncSession,
    graph_id: UUID,
    delta: dict,
    created_by: UUID | None = None,
):
    root_draft = await graphs_service.get_any_draft(db, graph_id)
    current_definition = root_draft.definition if root_draft is not None else None
    next_definition = apply_graph_delta(current_definition, delta)
    return await update_root_draft(db, graph_id, next_definition, created_by=created_by)
