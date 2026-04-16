"""Distribution selection for backend model registration and router mounting."""

from collections.abc import Callable

from libs.config import settings

from distributions.chimera.backend.models import register_models as register_chimera_models
from distributions.chimera.backend.manifest import ENABLED_BACKEND_MODULES as CHIMERA_BACKEND_MODULES
from distributions.chimera.backend.routers import mount_routers as mount_chimera_routers
from distributions.manticore.backend.models import register_models as register_manticore_models
from distributions.manticore.backend.manifest import ENABLED_BACKEND_MODULES as MANTICORE_BACKEND_MODULES
from distributions.manticore.backend.routers import mount_routers as mount_manticore_routers


BackendMountRouters = Callable[..., None]
BackendRegisterModels = Callable[[], None]


_BACKEND_DISTRIBUTIONS: dict[str, tuple[BackendRegisterModels, BackendMountRouters]] = {
    "chimera": (register_chimera_models, mount_chimera_routers),
    "manticore": (register_manticore_models, mount_manticore_routers),
}

_BACKEND_DISTRIBUTION_MODULES: dict[str, tuple[str, ...]] = {
    "chimera": CHIMERA_BACKEND_MODULES,
    "manticore": MANTICORE_BACKEND_MODULES,
}


def get_active_backend_distribution() -> tuple[str, BackendRegisterModels, BackendMountRouters]:
    requested = settings.knotwork_distribution.strip().lower() or "chimera"
    register_models, mount_routers = _BACKEND_DISTRIBUTIONS.get(requested, _BACKEND_DISTRIBUTIONS["chimera"])
    resolved = requested if requested in _BACKEND_DISTRIBUTIONS else "chimera"
    return resolved, register_models, mount_routers


def get_active_backend_modules() -> tuple[str, ...]:
    requested = settings.knotwork_distribution.strip().lower() or "chimera"
    return _BACKEND_DISTRIBUTION_MODULES.get(requested, _BACKEND_DISTRIBUTION_MODULES["chimera"])
