# S6.4 Spec — Runtime Polish + Workflow Topology

## What was built

### 1. Built-in Tool Test Modal
- **Backend**: `POST /workspaces/{ws}/tools/builtins/{slug}/test` endpoint in `tools/router.py`. Calls `execute_builtin(slug, input_data)` directly. Returns `{output, error, duration_ms}`.
- **Frontend**: `ToolTestModal.tsx` — schema-driven input form per builtin (web.search → query field, web.fetch → URL, calc → expression, http.request → method+url+headers+body, generic → JSON textarea). Result shown in modal with duration.
- `api/tools.ts`: added `useTestBuiltin(workspaceId, slug)` mutation.
- `ToolsPage.tsx`: updated labels (built-ins = "always available", custom = "Custom integrations"), "Try it" button on every builtin card.

### 2. Designer Chat — Persistent History
- **Backend**: `designer/models.py` — `DesignerChatMessage` ORM model (id, graph_id FK→graphs CASCADE, role, content, created_at).
- `designer/agent.py`: replaced in-memory `sess.*` calls with async DB reads/writes keyed by `graph_id`. Latest 50 messages used as context window. Accepts optional `graph_id` param (falls back to no history if None).
- `graphs/router.py`: passed `graph_id=str(graph.id)` to `design_graph()`. Added `GET /workspaces/{ws}/graphs/{graph_id}/designer-messages` and `DELETE` (clear) endpoints.
- `main.py`: added `import knotwork.designer.models`.
- **Migration**: `alembic/versions/99138170d563_s6_4_designer_chat.py` — creates `designer_chat_messages` table.
- **Frontend**: `api/designer.ts` — `useDesignerMessages`, `useClearDesignerHistory`. `DesignerChat.tsx`: loads history from DB on mount, shows relative timestamps, trash-icon clear button.

### 3. Modal Scroll Fix
- `RunTriggerModal.tsx` and `ToolTestModal.tsx` use fixed-header/scrollable-body/fixed-footer pattern (`max-h-[90vh] flex flex-col`).

### 4. Input Schema — Editable + No Auto-Rebuild
- `store/canvas.ts`: guard in `applyDelta` — designer's `set_input_schema` only applies if user has no schema yet. Added `setInputSchema(fields)` action.
- `InputSchemaEditor.tsx` (new): lists fields with inline edit (name, label, type, required toggle, delete, up/down reorder). Always visible in "Run Input" tab of GraphDetailPage.
- `GraphDetailPage.tsx`: right sidebar now has tabs **Node** / **Run Input** (always shows InputSchemaEditor regardless of node selection).

### 5. Node Name Display in Runs
- `RunDetailPage.tsx`: builds `nodeNameMap` from `definition.nodes`. Used in node state table, result banner, and `NodeInspectorPanel`.
- `NodeInspectorPanel.tsx`: accepts `nodeName?` prop, shows it as primary label with `nodeId` as subtext (mono).

### 6. START/END Nodes + Parallel Starts + Pre-run Validation
- `types/index.ts`: `NodeType` includes `'start' | 'end'`.
- `GraphCanvas.tsx`: `StartEndOval` component renders start/end as `<ellipse>` — green for start, gray for end. Not click-selectable for config.
- `NodeConfigPanel.tsx`: shows "Start/End of workflow — no configuration needed" for these node types.
- `runtime/engine.py`: detects start/end nodes, skips them as real graph nodes, translates edges to/from them using `LG_START`/`END`. Legacy graphs (no start node) fall back to `entry_point`.
- `runtime/validation.py` (new): BFS forward from start + BFS backward from end to find unreachable nodes. Returns `[]` for legacy graphs.
- `runs/service.py`: calls `validate_graph()` in `create_run()` — raises `ValueError` → 400 at API layer.
- `designer/agent.py`: `_SYSTEM` updated to always include start/end in every graph.
- `GraphDetailPage.tsx`: calls `validateGraph()` (frontend mirror), shows amber warning banner, disables Run button when errors exist.
- `utils/validateGraph.ts` (new): frontend BFS validation matching backend logic.

### 7. Additional Gaps
- **Copy output to clipboard**: `NodeInspectorPanel.tsx` has clipboard icon next to Output header.
- **Failed node error display**: Red error box shown when `nodeState.status === 'failed'` and `nodeState.error` is set.
- **Unsaved changes warning**: `GraphDetailPage.tsx` sets `window.onbeforeunload` when `isDirty`.

## Key decisions

- Designer chat history is keyed by `graph_id` (one conversation per graph), not by `session_id`. The `session_id` prop on `DesignerChat` is kept for backwards compat but only used by the backend to distinguish concurrent sessions.
- `set_input_schema` guard (no-overwrite) is client-side only — the backend always sends the full suggestion; the client decides whether to apply it.
- Validation skips legacy graphs (no `start` node) to preserve backward compatibility. New graphs should always include start/end.
- The `StartEndOval` component is not click-selectable to avoid confusion — these nodes have no config.

## Breaking Changes

None. All changes are additive or backward-compatible.
