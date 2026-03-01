# S6 Spec — Tool Registry + Notifications

## What Was Built

### Tool Registry (backend)
- **`tools/schemas.py`** — `ToolCreate`, `ToolUpdate`, `ToolResponse`, `BuiltinToolInfo`, `ToolTestRequest`, `ToolTestResponse`
- **`tools/service.py`** — full CRUD (`list_tools`, `create_tool`, `get_tool`, `update_tool`, `delete_tool`) + `execute_tool` dispatcher
- **`tools/builtins/__init__.py`** — `@register()` decorator registry, `list_builtins()`, `execute_builtin(slug, input_data)`
- **`tools/builtins/web.py`** — `web.search` (DuckDuckGo Instant Answer API), `web.fetch`
- **`tools/builtins/http.py`** — `http.request` (generic GET/POST/PUT/DELETE)
- **`tools/builtins/calc.py`** — `calc` (safe AST arithmetic evaluator)
- **`tools/router.py`** — full HTTP layer replacing stubs:
  - `GET /workspaces/{ws}/tools/builtins`
  - `GET /workspaces/{ws}/tools`
  - `POST /workspaces/{ws}/tools`
  - `GET /workspaces/{ws}/tools/{id}`
  - `PATCH /workspaces/{ws}/tools/{id}`
  - `DELETE /workspaces/{ws}/tools/{id}`
  - `POST /workspaces/{ws}/tools/{id}/test`

### Tool Executor Node (runtime)
- **`runtime/nodes/tool_executor.py`** — full implementation replacing stub:
  - Loads `Tool` from DB by `tool_id` in node config
  - Applies `input_map` (tool_param → state_key) to build tool input
  - Invokes `execute_tool()` (builtin or HTTP)
  - Applies `output_map` (state_key ← tool_output_key) to update state
  - Writes `RunNodeState` and publishes WebSocket event
- **`runtime/engine.py`** — wired: `ntype == "tool_executor"` now dispatches to `make_tool_executor_node()`

### Notifications (backend)
- **`notifications/models.py`** — `NotificationPreference` (per-workspace toggles + channel config), `NotificationLog` (outbound audit trail)
- **`notifications/schemas.py`** — `NotificationPreferenceResponse`, `NotificationPreferenceUpdate`, `NotificationLogEntry`
- **`notifications/service.py`** — `get_or_create_preferences`, `update_preferences`, `list_notification_log`, `log_notification`
- **`notifications/channels/email.py`** — SMTP send (TLS/SSL, port 587/465)
- **`notifications/channels/telegram.py`** — Telegram Bot API `sendMessage`
- **`notifications/channels/whatsapp.py`** — Phase 1: generates `wa.me` deep link, logs it
- **`notifications/dispatcher.py`** — loads prefs, iterates channels, logs each attempt
- **`notifications/router.py`**:
  - `GET  /workspaces/{ws}/notification-preferences`
  - `PATCH /workspaces/{ws}/notification-preferences`
  - `GET  /workspaces/{ws}/notification-log`
- **`escalations/service.py`** — `create_escalation()` now calls `dispatch()` after commit (fire-and-forget, errors swallowed)
- **`main.py`** — registered `notifications_router`; added `notifications.models` import for ORM metadata

### Frontend
- **`api/tools.ts`** — `useTools`, `useBuiltinTools`, `useCreateTool`, `useDeleteTool`, `useTestTool`
- **`api/notifications.ts`** — `useNotifPreferences`, `useUpdateNotifPreferences`, `useNotifLog`
- **`pages/ToolsPage.tsx`** — real API, built-in section + workspace tools section, inline Test button with result preview
- **`pages/SettingsPage.tsx`** — notifications tab wired to real API; live channel toggles; notification log table
- **`mocks/index.ts`** — removed `MOCK_TOOLS` and `MOCK_NOTIF_PREFS` (S6 data is real now)

## Key Decisions

1. **Built-in registry via `@register()` decorator** — builtins self-register on import; no central config file to maintain.
2. **`web.search` uses DuckDuckGo Instant Answer API** — no API key needed; zero-config for dev.
3. **`calc` uses Python `ast` + whitelist** — safe: only numeric constants and `+−×÷^%` operators allowed.
4. **WhatsApp Phase 1 = deep link** — returns a `wa.me` URL logged in `NotificationLog.detail`; operator clicks it. No Business API credentials needed.
5. **Notifications fire-and-forget** — `create_escalation()` calls `dispatch()` in a try/except; a bad SMTP config never fails a run.
6. **One `NotificationPreference` row per workspace** — `get_or_create_preferences()` creates it on first access. No migration friction.
7. **`/tools/builtins` route before `/{tool_id}`** — FastAPI routes match top-to-bottom; literal path segment must come first to avoid being consumed as UUID.

## Breaking Changes
None. All new endpoints; no prior contracts changed.

## Migration
Two new tables: `notification_preferences`, `notification_logs`.

```bash
cd backend && alembic revision --autogenerate -m "s6_tools_notifications" && alembic upgrade head
```
