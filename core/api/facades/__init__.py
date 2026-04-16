"""Thin cross-module API facades.

Keep facade modules lazy so importing one facade does not eagerly pull the
entire cross-module surface into partially initialized packages.
"""

from importlib import import_module

_FACADE_MODULES = {
    "channels",
    "graphs",
    "knowledge",
    "projects",
    "public_workflows",
    "runs",
    "runtime",
    "workspaces",
}


def __getattr__(name: str):
    if name in _FACADE_MODULES:
        return import_module(f"core.api.facades.{name}")
    raise AttributeError(f"module 'core.api.facades' has no attribute {name!r}")


__all__ = sorted(_FACADE_MODULES)
