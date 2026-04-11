from __future__ import annotations

from pathlib import Path


ROOT = Path("/Users/hieu/Work/crea8r/knotwork")


FILES_AND_FORBIDDEN_IMPORTS = {
    "modules/workflows/backend/runs_service.py": (
        "from modules.workflows.backend.graphs_service import",
        "from modules.workflows.backend.runtime.validation import",
        "from modules.communication.backend import channels_service",
        "from knotwork.",
    ),
    "modules/workflows/backend/graphs_service.py": (
        "from modules.communication.backend.channels_service import _generate_channel_slug",
        "from modules.communication.backend import channels_service",
        "from knotwork.",
    ),
    "modules/workflows/backend/graphs_version_service.py": (
        "from modules.communication.backend import channels_service",
        "from knotwork.",
    ),
    "modules/assets/backend/knowledge_service.py": (
        "from modules.communication.backend import channels_service",
        "from knotwork.",
    ),
    "modules/assets/backend/knowledge_change_service.py": (
        "from modules.communication.backend import channels_service",
        "from knotwork.",
    ),
    "modules/projects/backend/projects_service.py": (
        "from modules.communication.backend.channels_service import _generate_channel_slug",
        "from modules.communication.backend import channels_service",
        "from knotwork.",
    ),
    "modules/communication/backend/escalations_service.py": (
        "from modules.communication.backend import channels_service",
        "from knotwork.",
    ),
    "modules/workflows/backend/runtime/runner.py": (
        "from modules.communication.backend import channels_service",
        "from knotwork.",
    ),
    "modules/workflows/backend/runtime/nodes/agent.py": (
        "from modules.communication.backend import channels_service",
        "from knotwork.",
    ),
    "modules/workflows/backend/runtime/adapters/openai_adapter.py": (
        "from modules.projects.backend.projects_service import render_project_context",
        "from knotwork.",
    ),
    "modules/workflows/backend/runtime/adapters/claude.py": (
        "from modules.projects.backend.projects_service import render_project_context",
        "from knotwork.",
    ),
    "modules/workflows/backend/public_workflows_service.py": (
        "from modules.workflows.backend.runs_service import create_run",
        "from knotwork.",
    ),
    "modules/communication/backend/handbook_agent.py": (
        "from modules.assets.backend import knowledge_service",
        "from knotwork.",
    ),
    "modules/workflows/backend/designer_agent.py": (
        "from modules.communication.backend.channels_service import create_message",
        "from knotwork.",
    ),
    "modules/admin/backend/workspaces_skills_router.py": (
        "from modules.communication.backend import channels_service as",
        "from modules.assets.backend import knowledge_service as",
        "from knotwork.",
    ),
    "modules/communication/backend/escalations_router.py": (
        "from modules.communication.backend.channels_service import (",
        "from modules.workflows.backend.public_workflows_service import notify_public_run_aborted",
        "from knotwork.",
    ),
    "modules/assets/backend/knowledge_router.py": (
        "from modules.projects.backend import projects_service",
        "from knotwork.",
    ),
}


def test_cross_module_calls_use_core_api_mediation_layer() -> None:
    for relative_path, forbidden_imports in FILES_AND_FORBIDDEN_IMPORTS.items():
        content = (ROOT / relative_path).read_text()
        for forbidden in forbidden_imports:
            assert forbidden not in content, f"{relative_path} should use core.api instead of `{forbidden}`"
