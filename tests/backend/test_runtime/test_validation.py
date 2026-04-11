from modules.workflows.backend.runtime.validation import validate_graph


def test_validate_graph_allows_bridge_backed_agent_refs() -> None:
    definition = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start", "config": {}},
            {
                "id": "agent-1",
                "type": "agent",
                "name": "OpenClaw node",
                "agent_ref": "openclaw",
                "operator_id": "agent:openclaw-1",
                "supervisor_id": "human:123",
                "config": {},
            },
            {"id": "end", "type": "end", "name": "End", "config": {}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "agent-1", "type": "direct"},
            {"id": "e2", "source": "agent-1", "target": "end", "type": "direct"},
        ],
    }

    errors = validate_graph(definition)

    assert not any("unsupported agent_ref" in error for error in errors)


def test_validate_graph_requires_operator_assignment() -> None:
    definition = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start", "config": {}},
            {
                "id": "agent-1",
                "type": "agent",
                "name": "Assigned node",
                "agent_ref": "openclaw",
                "supervisor_id": "human:123",
                "config": {},
            },
            {"id": "end", "type": "end", "name": "End", "config": {}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "agent-1", "type": "direct"},
            {"id": "e2", "source": "agent-1", "target": "end", "type": "direct"},
        ],
    }

    errors = validate_graph(definition)

    assert any('Node "Assigned node" is missing an operator' in error for error in errors)
