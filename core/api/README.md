# Core API

`core/api` is the backend integration layer.

What belongs here:
- app bootstrap and router assembly
- distribution selection
- health/runtime bootstrap
- thin cross-module facades used to avoid direct module-to-module imports
- orchestration that coordinates more than one module

What does not belong here:
- product-specific business rules
- module-owned validation
- module-owned mutation logic
- domain-specific normalization helpers

Practical rule:
- if logic only belongs to one module, keep it in that module and let `core/api`
  expose at most a thin wrapper
- if logic coordinates multiple modules, `core/api` may own it

Current file groups:
- bootstrap: `bootstrap/main.py`, `bootstrap/router.py`, `bootstrap/distribution.py`,
  `bootstrap/health.py`
- facades/orchestration: `facades/channels.py`, `facades/graphs.py`,
  `facades/knowledge.py`, `facades/projects.py`, `facades/public_workflows.py`,
  `facades/runs.py`, `facades/runtime.py`, `facades/workspaces.py`
- packet/session composition: `agent_sessions/work_packets.py`
- packet/session transport: `agent_sessions/router.py`

Compatibility notes:
- `from core.api import channels` still works via package re-exports
- bootstrap code should import from `core.api.bootstrap`
- agent work packet code should import from `core.api.agent_sessions`
