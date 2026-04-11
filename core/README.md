# Core

Scope:
- application assembly
- entrypoints
- route and router composition
- runtime wiring
- cross-module orchestration
- MCP integration

Rules:
- keep `core` thin
- do not move product behavior here just because it is shared
- prefer modules for feature logic and libs for reusable primitives

Docs and tests:
- docs should go in the relevant `core/<area>/docs/` folder
- tests should go in the relevant `core/<area>/tests/` folder
