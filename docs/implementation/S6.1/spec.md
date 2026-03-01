# S6.1 Spec — Smart Run Trigger + Run Result Start State

## What Was Built

### 1. `input_schema` in GraphDefinitionSchema (backend)
- Added `InputFieldDef` Pydantic model to `graphs/schemas.py`
  - Fields: `name`, `label`, `description`, `required`, `type` (`text`|`textarea`|`number`)
- Added `input_schema: list[InputFieldDef] = []` to `GraphDefinitionSchema`
- Stored as JSON in the existing `definition` column — **no DB migration needed**

### 2. Designer agent emits `set_input_schema`
- Added `set_input_schema` to the `graph_delta` schema in `designer/agent.py`
- Instructed agent: always define input fields when creating/modifying a graph
- `set_input_schema` is applied client-side via `applyDelta` in `store/canvas.ts`
  (then persisted on next "Save" from GraphDetailPage)

### 3. RunTriggerModal — smart form
- `RunTriggerModal` now accepts `definition: GraphDefinition` (not `nodeCount: number`)
- If `definition.input_schema` has entries → renders labeled form fields per entry
- `text` → `<input type="text">`, `textarea` → `<textarea>`, `number` → `<input type="number">`
- If no `input_schema` → JSON textarea fallback (labeled "Advanced")
- Removed MockWrap placeholders (file upload + ETA)
- `GraphDetailPage` passes `definition` to `RunTriggerModal`

### 4. Run result banner (RunDetailPage)
- When run status = `completed` and the last completed node has `output.text` (string):
  shows a green prose panel above the canvas with the node name as label
- `PostRunNudge` now only shown for non-completed runs (banner replaces it on success)

### 5. NodeInspectorPanel — readable prose output
- If `output.text` is a string → rendered as readable prose in a scrollable div
- Raw JSON available in a collapsible `<details>` below
- Other outputs remain as raw JSON (unchanged behavior)

### 6. Delete runs
**Backend:**
- `DELETE /workspaces/{ws}/runs/{run_id}` → real DB delete (204). Only allowed for terminal runs.
- `POST /workspaces/{ws}/runs/{run_id}/abort` → new endpoint for stopping active runs
- `runs/service.py`: added `delete_run()`

**Frontend:**
- `api/runs.ts`: added `useDeleteRun(workspaceId)` mutation
- `RunsPage`: trash icon on each terminal run row, confirms before deleting
- `RunDetailPage`: "Delete run" button in header (terminal runs only)

### 7. RunsPage: graph name column
- `useGraphs(workspaceId)` fetched alongside runs
- Graph name joined by `graph_id` and shown in new "Graph" column

## Key Decisions
- `input_schema` lives in the `definition` JSON blob — additive, backward-compatible, no migration
- `set_input_schema` applied client-side in canvas store, persisted on user Save
- Delete is separate from abort: DELETE = permanent removal (terminal only); POST .../abort = stop active run
- Result banner only shown for `output.text` — the standard LLM output key

## Files Changed
**Backend:**
- `backend/knotwork/graphs/schemas.py` — `InputFieldDef`, `input_schema`
- `backend/knotwork/designer/agent.py` — `set_input_schema` in `_SYSTEM`
- `backend/knotwork/runs/router.py` — real DELETE, new POST .../abort
- `backend/knotwork/runs/service.py` — `delete_run()`

**Frontend:**
- `frontend/src/types/index.ts` — `InputFieldDef`, `input_schema` on `GraphDefinition`
- `frontend/src/api/designer.ts` — `set_input_schema` in `GraphDelta`
- `frontend/src/store/canvas.ts` — handle `set_input_schema` in `applyDelta`
- `frontend/src/components/operator/RunTriggerModal.tsx` — smart form
- `frontend/src/pages/GraphDetailPage.tsx` — pass `definition`
- `frontend/src/pages/RunDetailPage.tsx` — result banner, delete button
- `frontend/src/components/operator/NodeInspectorPanel.tsx` — readable prose
- `frontend/src/pages/RunsPage.tsx` — graph name, delete button
- `frontend/src/api/runs.ts` — `useDeleteRun`
