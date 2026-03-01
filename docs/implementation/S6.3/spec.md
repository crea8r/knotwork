# S6.3 Spec — Runtime Data Flow + Draft Input Editing

## Summary
S6.3 fixes two critical runtime correctness bugs and adds two operator-facing features.
After this session, every LLM Agent node actually receives the context it was configured
to use (system prompt, handbook knowledge, and predecessor outputs), and draft runs are
fully editable before execution.

---

## What Was Built

### 1. System prompt config key alignment (critical bug fix)
**Problem:** The designer agent (`_SYSTEM`) and `LlmAgentConfig.tsx` both use `system_prompt`
and `knowledge_paths` as config keys. The runtime (`llm_agent.py`) was reading `instructions`
and `knowledge_files` — the wrong keys. Both values were silently empty on every run.

**Fix in `runtime/nodes/llm_agent.py`:**
```python
# Accept both frontend key and legacy key
knowledge_files = config.get("knowledge_paths") or config.get("knowledge_files", [])
extra_instructions = config.get("system_prompt") or config.get("instructions", "")
```
All node configs created via the designer or NodeConfigPanel now have their system prompt
and knowledge files correctly loaded.

---

### 2. Per-node input sources (new capability)
Each `llm_agent` node can now choose what context to include in its `THIS CASE` prompt section.

**Config key:** `input_sources: string[] | null`
- `null` / not set → include run input + all outputs accumulated from nodes that ran before this one (default)
- `["run_input", "step-1", "step-2"]` → explicit selection

**Runtime changes:**
- `RunState.node_outputs: Annotated[dict, _merge_outputs]` — new field; accumulates
  `{node_id: output_text}` as each `llm_agent` node completes.
- Each node returns `{"node_outputs": {node_id: output_text}, ...}` to the state.
- `build_agent_prompt()` now accepts `prior_outputs: dict[str, str] | None`; renders each
  entry as a named `### Output from node: <id>` section in `THIS CASE`.

**Prompt structure (THIS CASE section):**
```
### Run input
```json
{ "customer_name": "Acme", "contract_text": "..." }
```

### Output from node: step-1
The contract review found the following issues...
```

**Frontend (`LlmAgentConfig.tsx`):**
- "Input sources" checkbox list appears when a node has predecessor nodes.
- "Run input" checkbox (always shown first).
- One checkbox per directly-connected predecessor node.
- Default state (nothing checked off) = all sources included (implicit `null` in config).
- Deselecting any item materialises the `input_sources` array explicitly in the config.

**`NodeConfigPanel.tsx`:** computes `predecessorNodes` from edges (`edge.target === node.id`)
and passes them to `LlmAgentConfig`.

---

### 3. Edit draft run input (new capability)
Runs in `draft` status now have a fully editable input form.

**Backend:**
- `RunUpdate.name` changed from `str` to `str | None = None` (optional).
- `RunUpdate.input: dict | None = None` added.
- `service.update_run_name()` renamed to `service.update_run()` — handles both fields.
  Input update is rejected with 400 if the run is not in `draft` status.
- `PATCH /workspaces/{ws}/runs/{run_id}` handler updated accordingly.

**Frontend:**
- `api/runs.ts`: `useUpdateRunInput(workspaceId)` mutation (calls PATCH with `{ input }`).
- `RunInputPanel.tsx` rewritten:
  - Draft mode: renders editable `<input>`/`<textarea>`/`<number>` per schema field (or
    JSON textarea if no `input_schema`); "Save input" button; "Draft — editable" subtitle.
  - Non-draft mode: unchanged read-only display + "Clone as draft" button.
  - Shows "Input saved" confirmation after save.
- `RunDetailPage.tsx`: passes `runStatus={run.status}` and `onInputSaved={refetchRun}`.

---

### 4. "Run now" button debounce (UX fix)
**Problem:** After clicking "Run now", the API call returns before the 2s polling cycle
refetches the new run status. The button briefly re-enables, allowing double-execution.

**Fix (`RunDetailPage.tsx`):**
```tsx
disabled={executeInline.isPending || executeInline.isSuccess}
```
Button label changes to "Starting…" while pending or after success, and stays disabled
until the run status refetch causes `run.status !== 'queued' | 'draft'`, removing the
button entirely.

---

## Breaking Changes

### `update_run_name` → `update_run` (internal service rename)
`runs/service.py`: function renamed from `update_run_name` to `update_run`. Not a public
API change (endpoint path unchanged), but any code calling the service function directly
must update the call site.

### `RunUpdate.name` is now optional
`runs/schemas.py`: `name: str` → `name: str | None = None`. Callers that relied on `name`
being required will now silently succeed even without it (backward-compatible at API level).

### `prompt_builder._render_case` signature changed
`prior_outputs: dict[str, str] | None = None` added as third parameter. Backward-compatible
(default `None` = previous behaviour). Any direct tests against `_render_case` need updating.

### `RunState.node_outputs` added
`runtime/engine.py`: new required field in `RunState`. Code that constructs a `RunState`
dict directly (e.g. tests calling `graph.ainvoke({...})`) must include `"node_outputs": {}`.
The two S1 engine tests that omit this are already `xfail` — no new breakage.

---

## Files Changed

**Backend:**
- `knotwork/runtime/engine.py` — `_merge_outputs` reducer, `node_outputs` in `RunState`, init in `execute_run`
- `knotwork/runtime/nodes/llm_agent.py` — config key alignment, `input_sources` logic, emit `node_outputs`
- `knotwork/runtime/prompt_builder.py` — `prior_outputs` param in `_render_case` + `build_agent_prompt`
- `knotwork/runs/schemas.py` — `RunUpdate.name` optional, `RunUpdate.input`
- `knotwork/runs/service.py` — `update_run()` (renamed + extended)
- `knotwork/runs/router.py` — `update_run` handler, catches `ValueError` for input update

**Frontend:**
- `src/api/runs.ts` — `useUpdateRunInput`
- `src/components/operator/RunInputPanel.tsx` — full rewrite for draft editing
- `src/components/designer/config/LlmAgentConfig.tsx` — `predecessorNodes` prop, input sources UI
- `src/components/designer/NodeConfigPanel.tsx` — compute + pass `predecessorNodes`
- `src/pages/RunDetailPage.tsx` — pass `runStatus` + `onInputSaved` to panel; debounce "Run now"
