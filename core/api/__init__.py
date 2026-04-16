"""Core backend integration layer.

Module facades are lazily re-exported here for `from core.api import channels`
style imports. Bootstrap and agent-session entrypoints live in subpackages.
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
    raise AttributeError(f"module 'core.api' has no attribute {name!r}")


__all__ = sorted(_FACADE_MODULES)
