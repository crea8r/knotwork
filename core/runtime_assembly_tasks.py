from __future__ import annotations

import importlib.util
from pathlib import Path


_SOURCE = Path(__file__).resolve().parent / "runtime-assembly" / "tasks.py"
_SPEC = importlib.util.spec_from_file_location("core_runtime_assembly_tasks_impl", _SOURCE)
if _SPEC is None or _SPEC.loader is None:
    raise ImportError(f"Unable to load runtime assembly worker module from {_SOURCE}")

_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)

execute_run = _MODULE.execute_run
resume_run = _MODULE.resume_run
check_escalation_timeouts = _MODULE.check_escalation_timeouts
worker_heartbeat = _MODULE.worker_heartbeat
WorkerSettings = _MODULE.WorkerSettings

__all__ = [
    "execute_run",
    "resume_run",
    "check_escalation_timeouts",
    "worker_heartbeat",
    "WorkerSettings",
]
