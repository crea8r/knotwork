import libs.auth.backend.models  # noqa: F401
import libs.audit.backend.models  # noqa: F401
import modules.admin.backend.invitations_models  # noqa: F401
import modules.admin.backend.workspaces_models  # noqa: F401
import modules.assets.backend.knowledge_models  # noqa: F401
import modules.communication.backend.channels_models  # noqa: F401
import modules.workflows.backend.runs.escalations_models  # noqa: F401
import modules.communication.backend.notifications_models  # noqa: F401
import modules.projects.backend.projects_models  # noqa: F401
import modules.workflows.backend.graphs.models  # noqa: F401
import modules.workflows.backend.public_workflows.models  # noqa: F401
import modules.workflows.backend.runs.models  # noqa: F401

from .manifest import ENABLED_BACKEND_FEATURES, ENABLED_BACKEND_MODULES

_ALWAYS_REGISTER_SHARED_MODELS = ("auth", "audit")
_REGISTERED_MODULES = set(ENABLED_BACKEND_MODULES)
_REGISTERED_FEATURES = set(ENABLED_BACKEND_FEATURES)


def register_models() -> None:
    """Force import of all Chimera ORM models for metadata registration."""
    if "admin" not in _REGISTERED_MODULES:
        raise RuntimeError("chimera requires admin models")
    if "assets" not in _REGISTERED_MODULES:
        raise RuntimeError("chimera requires assets models")
    if "communication" not in _REGISTERED_MODULES:
        raise RuntimeError("chimera requires communication models")
    if "projects" not in _REGISTERED_MODULES:
        raise RuntimeError("chimera requires project models")
    if "workflows" not in _REGISTERED_MODULES:
        raise RuntimeError("chimera requires workflow models")
    if "public_workflows" not in _REGISTERED_FEATURES:
        raise RuntimeError("chimera requires public workflow models")
    return None
