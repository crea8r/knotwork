import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from time import monotonic

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from libs.database import AsyncSessionLocal

_STARTED_AT = datetime.now(timezone.utc)
_START_MONOTONIC = monotonic()
_INSTALLATION_ID: str = ""
_SCHEMA_VERSION: str = ""


async def _read_worker_status() -> dict:
    try:
        import redis.asyncio as aioredis
        from libs.config import settings as _s

        r = aioredis.from_url(_s.redis_url)
        val = await r.get("knotwork:worker:heartbeat")
        await r.aclose()
        if val:
            age = int(time.time() - float(val.decode()))
            return {"alive": age < 90, "last_seen_seconds_ago": age}
        return {"alive": False, "last_seen_seconds_ago": None}
    except Exception:
        return {"alive": None, "last_seen_seconds_ago": None}


async def read_schema_version() -> str:
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
            val = result.scalar()
            return str(val) if val else "none"
    except Exception:
        return "none"


def load_or_create_installation_id() -> str:
    id_path = Path(os.getcwd()) / "data" / ".installation_id"
    id_path.parent.mkdir(parents=True, exist_ok=True)
    if id_path.exists():
        val = id_path.read_text().strip()
        if val:
            return val
    val = str(uuid.uuid4())
    id_path.write_text(val)
    return val


def initialize_health_state(*, installation_id: str, schema_version: str) -> None:
    global _INSTALLATION_ID, _SCHEMA_VERSION
    _INSTALLATION_ID = installation_id
    _SCHEMA_VERSION = schema_version


def register_health_route(app: FastAPI) -> None:
    @app.get("/health")
    async def healthcheck():
        db_start = monotonic()
        db_status = "ok"
        db_error = None
        try:
            async with AsyncSessionLocal() as db:
                await db.execute(text("SELECT 1"))
        except Exception as exc:  # pragma: no cover - defensive for runtime checks
            db_status = "error"
            db_error = str(exc)
        db_latency_ms = round((monotonic() - db_start) * 1000, 2)

        now = datetime.now(timezone.utc)
        uptime_seconds = round(monotonic() - _START_MONOTONIC, 2)
        worker = await _read_worker_status()
        payload = {
            "service": "knotwork-api",
            "status": "ok" if db_status == "ok" else "degraded",
            "version": app.version,
            "installation_id": _INSTALLATION_ID,
            "schema_version": _SCHEMA_VERSION,
            "worker": worker,
            "now_utc": now.isoformat(),
            "started_at_utc": _STARTED_AT.isoformat(),
            "uptime_seconds": uptime_seconds,
            "checks": {
                "database": {
                    "status": db_status,
                    "latency_ms": db_latency_ms,
                    "error": db_error,
                },
            },
        }
        status_code = 200 if db_status == "ok" else 503
        return JSONResponse(status_code=status_code, content=payload)
