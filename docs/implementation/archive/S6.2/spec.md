# S6.2 Spec: Run UX Improvements

## Summary
S6.2 hardens the run operator experience: runs are named, deletable in any
non-running state, and the runs table gives operators instant visibility into
what each run received, what it produced, whether it needs human attention, and
how many tokens it cost. The run detail view always shows the exact graph
version that was executed — not the latest version.

## What Was Built

### 1. Run naming
- `Run.name` (nullable `VARCHAR(200)`) added to the DB via migration `c3d4e5f6a7b8`.
- `RunCreate.name` — optional field accepted at trigger time.
- `PATCH /workspaces/{ws}/runs/{run_id}` — rename any run at any time.
- `RunUpdate` Pydantic schema: `{ name: str }`.
- Frontend: name shown inline in RunDetailPage header (click pencil to edit, Enter/Escape/blur to commit); shown in RunsPage table with inline editing per row; name field in RunTriggerModal (optional, placeholder "e.g. Customer A — contract review").

### 2. Delete queued and paused runs
- Previous policy: only `completed | failed | stopped | draft`.
- New policy: any status except `running` (`DELETABLE_STATUSES` in `service.py`).
- Before deleting a paused run, the service closes open escalations (sets `status=timed_out`) to avoid FK violations.
- Frontend: trash icon shown for all DELETABLE statuses in RunsPage and RunDetailPage.

### 3. Show exact graph version in RunDetailPage
- `Run.graph_version_id` was already stored but ignored by the frontend.
- Added `GET /workspaces/{ws}/graphs/versions/{version_id}` endpoint (returns `GraphVersionOut`).
- Added `useGraphVersion(workspaceId, versionId)` hook in `api/graphs.ts`.
- `RunDetailPage` now fetches the version via `run.graph_version_id` instead of calling `useGraph()` and taking `latest_version`.

### 4. Enriched runs table
`list_workspace_runs()` now returns a list of enriched dicts (not ORM objects):
- `total_tokens`: SUM of `resolved_token_count` across all run's node states.
- `output_summary`: text from the latest completed node's `output.text`, truncated to 200 chars.
- `needs_attention`: `True` when `run.status == "paused"`.
`RunOut` schema has these three fields with `None`/`False` defaults.
Frontend `RunsPage` table now shows: Name/ID, Graph, Status (+⚠ Review badge), Input summary, Output summary, Tokens, Started, Duration, Delete.

### 5. Node input capture and inspector display
`llm_agent.py` and `tool_executor.py` now save:
```python
input = {
    "run_input": state["input"],          # original run input dict
    "previous_output": state.get("current_output"),  # None for first node
}
```
`NodeInspectorPanel` shows an **Input** section above Output:
- If `previous_output` is a string: renders it as a blue-tinted prose block with label "Previous node output".
- Collapsible "Raw input" `<details>` shows full JSON.

## Breaking Changes
- `S6.1/tests/test_input_schema.py::test_delete_active_run_rejected`: error message assertion updated from `"terminal"` to `"running"` (message now says "Cannot delete a run with status 'running'").

## Files Changed
**Backend:**
- `alembic/versions/c3d4e5f6a7b8_s6_2_run_name.py` (new)
- `knotwork/runs/models.py` — `name` column
- `knotwork/runs/schemas.py` — `RunCreate.name`, `RunUpdate`, enriched `RunOut`
- `knotwork/runs/service.py` — enriched list, DELETABLE_STATUSES, `update_run_name`, FK-safe delete
- `knotwork/runs/router.py` — PATCH rename, updated DELETE policy, enriched list
- `knotwork/graphs/router.py` — `GET /graphs/versions/{version_id}`
- `knotwork/runtime/nodes/llm_agent.py` — save `input` to RunNodeState
- `knotwork/runtime/nodes/tool_executor.py` — save `input` to RunNodeState

**Frontend:**
- `types/index.ts` — `Run` type: `name`, `graph_version_id`, enriched fields
- `api/runs.ts` — `useRenameRun`, `useTriggerRun` accepts `name`
- `api/graphs.ts` — `useGraphVersion`
- `pages/RunDetailPage.tsx` — inline rename, exact version, delete queued/paused
- `pages/RunsPage.tsx` — enriched table, inline name editing, DELETABLE expanded
- `components/operator/NodeInspectorPanel.tsx` — input section above output
- `components/operator/RunTriggerModal.tsx` — optional run name field
