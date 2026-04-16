"""Agent-session packet assembly entrypoints."""

from .router import router
from .work_packets import build_work_packet

__all__ = ["build_work_packet", "router"]
