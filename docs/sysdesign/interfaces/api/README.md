# REST API

All HTTP endpoints. Backend `router.py` files must stay in sync with these contracts.

- **Live Swagger UI** — `/docs` on the FastAPI app.
- **Live OpenAPI JSON** — `/openapi.json` on the FastAPI app.
- **Checked-in baseline** — `openapi-baseline.json`, exported from the app with `python3 backend/scripts/export_openapi_baseline.py`.

- **core.md** — Auth, workspaces, graphs, registered agents, proposals. The primary reference.
- **runs.md** — Run trigger, status polling, node state inspection, abort, delete.
- **knowledge-realtime.md** — Handbook CRUD, upload, health, suggestions, WebSocket events.
- **agents-settings-profile.md** — S8 expansion: capability refresh, preflight runs, activation lifecycle, usage history.

The OpenAPI baseline is the review anchor for S12 section 7. MCP planning should start from this baseline, then group operations into coherent chat-friendly tools and resources instead of assuming a perfect 1:1 mapping from REST endpoints.
