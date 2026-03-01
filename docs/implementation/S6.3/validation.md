# S6.3 Validation Checklist

Run `cd backend && alembic upgrade head` (no new migrations in this session — all changes are code-only).

---

## 1. System prompt + knowledge reaches the LLM

### 1a. System prompt appears in node inspector
Open a graph → select an LLM Agent node → set a System prompt (e.g. "You are a helpful legal reviewer.") → save → trigger a run → open the run detail → click the node row.
- ✅ Inspector shows a purple **System prompt** block containing the text you entered plus the `=== GUIDELINES (how to work) ===` wrapper.
- ❌ System prompt section is absent or shows only the GUIDELINES wrapper with no user text.

### 1b. Knowledge file appears in system prompt
Create a Handbook file (e.g. `legal/review.md`) → open an LLM Agent node config → check that file under "Knowledge paths" → save → trigger a run → inspect the node.
- ✅ Inspector system prompt contains `## [LEGAL] legal/review.md` followed by the file content.
- ❌ System prompt shows `(No guidelines loaded for this node.)`.

### 1c. No system prompt when not configured
Trigger a run on a node with empty system prompt and no knowledge files.
- ✅ System prompt shows `=== GUIDELINES (how to work) ===\n\n(No guidelines loaded for this node.)` — no crash, just the placeholder.
- ❌ Runtime error or empty string stored.

---

## 2. Per-node input sources

### 2a. Default: all prior outputs flow to next node
Build a two-node graph (node A → node B), no `input_sources` configured on B → trigger a run.
- ✅ Node B's inspector shows "User prompt" containing `### Output from node: <A-id>` with node A's output text.
- ❌ Node B prompt shows no prior output section.

### 2b. Deselect predecessor in config
Open node B config → uncheck node A in "Input sources" (keep "Run input" checked) → save → trigger new run.
- ✅ Node B inspector shows `### Run input` section only — no `### Output from node:` section.
- ❌ Node A's output still appears.

### 2c. Deselect run input
Open node B config → uncheck "Run input", keep node A checked → save → trigger new run.
- ✅ Node B prompt shows `### Output from node: <A-id>` with no `### Run input` section.
- ❌ Run input still appears.

### 2d. Input sources UI only appears when predecessors exist
Open an entry-point node (no incoming edges) in NodeConfigPanel.
- ✅ "Input sources" section is absent.
- ❌ Empty checkbox list shown.

---

## 3. Edit draft run input

### 3a. Draft run shows editable fields
Clone any completed run as draft → open the draft → click the "Input" button.
- ✅ Panel shows "Draft — editable" subtitle, fields are `<input>`/`<textarea>` elements, "Save input" button is visible.
- ❌ Panel shows read-only display same as non-draft runs.

### 3b. Save persists the new input
In the draft input panel, change a field value → click "Save input".
- ✅ "Input saved" confirmation appears. Close the panel and re-open → new values shown.
- ❌ Values revert to originals after close.

### 3c. Run uses saved input
Save updated draft input → click "Run now" → wait for completion → open node inspector.
- ✅ Node inspector "Run input" JSON shows the updated field values.
- ❌ Node inspector shows old values.

### 3d. Non-draft runs still read-only
Open a completed or queued run → click "Input".
- ✅ Panel shows read-only fields and "Clone as draft" button; no "Save input" button.
- ❌ Editable fields shown for non-draft runs.

### 3e. Input update rejected for non-draft via API
`PATCH /workspaces/{ws}/runs/{run_id}` with `{"input": {...}}` on a completed run.
- ✅ Returns 400 with message about draft status.
- ❌ Input silently overwritten on completed run.

---

## 4. "Run now" debounce

### 4a. Double-click prevented
Open a queued or draft run → click "Run now" quickly twice.
- ✅ Button immediately shows "Starting…" and is disabled after first click. Only one execution fires.
- ❌ Two runs start, or button remains clickable between click and status update.

### 4b. Button disappears after status update
After clicking "Run now", wait for the run status to update to "running" or "completed".
- ✅ Button disappears entirely (replaced by "live" indicator if running).
- ❌ Button remains in "Starting…" state indefinitely.

---

## 5. Regression: prior sessions

Run `cd backend && python3 -m pytest ../docs/implementation/ -v`.
- ✅ 174 passed, 3 xfailed — no new failures.
- ❌ Any new failures beyond the 3 known xfails.
