from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from mcp.server.fastmcp import Context, FastMCP


@dataclass(frozen=True, slots=True)
class KnotworkMCPRuntime:
    client_from_context: Callable[[Context | None], Any]
    request: Callable[..., Awaitable[Any]]
    json_text: Callable[[Any], str]


ModuleMCPRegistrar = Callable[[FastMCP, KnotworkMCPRuntime], None]
