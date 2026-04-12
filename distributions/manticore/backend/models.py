import libs.auth.backend.models  # noqa: F401
import libs.audit.backend.models  # noqa: F401
import modules.admin.backend.invitations_models  # noqa: F401
import modules.admin.backend.workspaces_models  # noqa: F401
import modules.assets.backend.knowledge_models  # noqa: F401
import modules.communication.backend.channels_models  # noqa: F401
import modules.communication.backend.escalations_models  # noqa: F401
import modules.communication.backend.notifications_models  # noqa: F401
import modules.projects.backend.projects_models  # noqa: F401
import modules.workflows.backend.graphs_models  # noqa: F401
import modules.workflows.backend.public_workflows_models  # noqa: F401
import modules.workflows.backend.ratings_models  # noqa: F401
import modules.workflows.backend.runs_models  # noqa: F401
import modules.workflows.backend.tools_models  # noqa: F401

from .manifest import ENABLED_BACKEND_FEATURES, ENABLED_BACKEND_MODULES

_REGISTERED_MODULES = set(ENABLED_BACKEND_MODULES)
_REGISTERED_FEATURES = set(ENABLED_BACKEND_FEATURES)


def register_models() -> None:
    """Force import of all Manticore ORM models for metadata registration."""
    if "admin" not in _REGISTERED_MODULES:
        raise RuntimeError("manticore requires admin models")
    if "assets" not in _REGISTERED_MODULES:
        raise RuntimeError("manticore requires assets models")
    if "workflows" not in _REGISTERED_MODULES:
        raise RuntimeError("manticore requires workflow models")
    if "public_workflows" not in _REGISTERED_FEATURES:
        raise RuntimeError("manticore requires public workflow models")
    if "ratings" not in _REGISTERED_FEATURES:
        raise RuntimeError("manticore requires ratings models")
    if "tools" not in _REGISTERED_FEATURES:
        raise RuntimeError("manticore requires tool models")
    return None
