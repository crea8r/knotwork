"""Built-in tool registry.

Builtins are registered via @register() in each sub-module.
execute_builtin() dispatches to the matching function by slug.
"""
from __future__ import annotations

from knotwork.tools.schemas import BuiltinToolInfo

_REGISTRY: dict[str, dict] = {}


def register(slug: str, name: str, description: str, params: list[dict]):
    """Decorator that registers a coroutine as a named builtin tool."""

    def decorator(fn):
        _REGISTRY[slug] = {
            "fn": fn,
            "info": BuiltinToolInfo(
                slug=slug,
                name=name,
                category="builtin",
                description=description,
                parameters=params,
            ),
        }
        return fn

    return decorator


def list_builtins() -> list[BuiltinToolInfo]:
    _load_all()
    return [v["info"] for v in _REGISTRY.values()]


async def execute_builtin(slug: str, input_data: dict) -> dict:
    _load_all()
    entry = _REGISTRY.get(slug)
    if not entry:
        raise ValueError(f"Unknown builtin slug: {slug!r}")
    return await entry["fn"](**input_data)


def _load_all() -> None:
    """Import all builtin sub-modules to trigger @register() calls."""
    import knotwork.tools.builtins.web   # noqa: F401
    import knotwork.tools.builtins.http  # noqa: F401
    import knotwork.tools.builtins.calc  # noqa: F401
