def build_server(*args, **kwargs):
    from core.mcp.server import build_server as _build_server

    return _build_server(*args, **kwargs)


__all__ = ["build_server"]
