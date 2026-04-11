from __future__ import annotations

from modules.workflows.backend.runtime.validation import validate_graph as _validate_graph


def validate_graph(definition: dict) -> list[str]:
    return _validate_graph(definition)
