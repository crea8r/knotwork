# S6.5 Validation Checklist

Run tests first: `cd backend && python3 -m pytest ../docs/implementation/S6.5/tests/ -v`

---

## Part A — Canvas / Validation Fixes

### A1. Start/End auto-injection

**A1a. New empty graph**
1. Create a new graph. Open it immediately (do not use the designer chat).

- ✅ Canvas shows a green "▶ Start" oval and a gray "■ End" oval. Save button is visible (graph is dirty).
- ❌ Canvas shows "No nodes yet — use the chat designer to add nodes." placeholder.

**A1b. Legacy graph without start/end**
1. Find (or create via direct API) a graph whose saved definition has work nodes but no `start`/`end` typed nodes.
2. Open it.

- ✅ Start and End ovals appear on the canvas alongside the existing work nodes. Save button is visible.
- ✅ An amber validation warning appears ("Add a Start node…") because start/end are present but unconnected.
- ❌ Canvas shows only the original work nodes with no Start/End.

**A1c. Existing complete graph is not re-injected**
1. Open a graph that already has start/end nodes wired correctly.
2. Observe the header.

- ✅ Save button is NOT visible (graph not marked dirty). Canvas shows existing nodes exactly.
- ❌ Graph is unexpectedly marked dirty on open.

---

### A2. Start/End clickable

1. On any graph canvas, click the "▶ Start" oval.

- ✅ Start node is highlighted (blue outline). Right sidebar opens to Node tab showing "Start" label, no Remove button, and a "Connections" section with "Connect to…" dropdown listing all work nodes.
- ❌ Clicking Start does nothing; no config panel opens.

2. Use the "Connect to…" dropdown to add an edge from Start to a work node. Click **Add**.

- ✅ An arrow appears on the canvas from Start to the chosen node. The edge appears in the outgoing list.
- ❌ No edge appears.

3. Click the ✕ next to an outgoing edge in the connections list.

- ✅ Edge removed from canvas and list.
- ❌ Edge remains.

4. Confirm the Remove button is absent for Start and End nodes.

- ✅ Header shows node name + type label only. No "Remove" button.
- ❌ "Remove" button is present on Start/End config panel.

---

### A3. Legacy validation enforcement

**A3a. Work nodes, no Start — blocked**
1. Open (or create) a graph that has work nodes but no Start node (before auto-injection fires, or use a legacy graph opened for the first time after clearing the Zustand store).

- ✅ Amber warning banner shows "Add a Start node and connect it to begin the workflow".
- ✅ **Run** button is disabled.
- ❌ No warning; Run button enabled.

**A3b. Backend blocks the run**
1. Using curl/Postman, `POST /api/v1/workspaces/{ws}/graphs/{g}/runs` with a saved graph version that has no start node.

- ✅ Returns `HTTP 400` with body `{"detail": "Add a Start node..."}` (or similar).
- ❌ Run is created successfully.

**A3c. Once wired, Run button re-enables**
1. Click Start → connect to first work node. Click End ← connect from last work node.
2. Observe header.

- ✅ Amber banner disappears. Run button becomes active.
- ❌ Banner persists for a fully connected graph.

---

### A4. Loop edges render

1. Open (or create) a graph with a loop: node A → node B → node A (and node A → End).
2. Open the designer chat and ask: "Add a feedback loop from Review back to Intake".
   (Or manually wire it via NodeConfigPanel connections.)
3. Observe canvas.

- ✅ A **purple dashed curved line** appears on the canvas connecting the source node back to the target node (looping left of the graph). It has an arrowhead at the target end.
- ✅ All other (forward) edges remain gray solid lines.
- ❌ Loop edge is invisible (not rendered at all).

---

## Part B — New Features

### B1. Handbook two-panel UX

**B1a. Two-panel layout**
1. Navigate to Handbook.

- ✅ Page shows two panels side-by-side: left = file tree, right = editor area (initially empty with "Select a file" prompt).
- ✅ Folders show as collapsible sections. Files listed under their folder.
- ❌ Page still shows a flat table of all files.

**B1b. Folder expand/collapse**
1. Click a folder name that has files inside.

- ✅ Folder collapses; files disappear. Click again → expands.
- ❌ Folder doesn't toggle.

**B1c. Health dot visible in tree**
1. Ensure at least one file has a health score.
2. Look at the file tree.

- ✅ Each file shows a colored dot to the left of the filename (green/yellow/red based on score). Files with out-of-range token counts show a ⚠ after the name.
- ❌ No health indicators in the tree.

**B1d. Click file opens inline editor**
1. Click any file in the tree.

- ✅ Right panel shows the file editor with Editor / History / Health tabs. URL does NOT navigate away from `/handbook`.
- ❌ Browser navigates to `/handbook/file?path=…`.

**B1e. New file from folder**
1. Hover over a folder in the tree.
2. Click the "+" that appears.

- ✅ Right panel shows a new file editor with the folder path pre-filled. Saving creates the file and it appears in the tree.
- ❌ No "+" on hover, or new file form has empty path.

---

### B2. File upload + conversion

**B2a. Upload a .txt file**
1. Drag a `.txt` file onto the Handbook tree (or into a folder).

- ✅ Right panel shows an "Upload Preview" view with the converted Markdown, an editable Path field (pre-filled with `<folder>/<filename>.md`), and an editable Title field.
- ✅ "Save to Handbook" button is present. On click, the file is created and appears in the tree.
- ❌ Nothing happens on drop, or file is saved without preview.

**B2b. Upload a .md file**
1. Drag a `.md` file.

- ✅ Preview shows the original content unchanged (pass-through). Path pre-filled.
- ❌ Content is double-converted or garbled.

**B2c. Upload a .csv file**
1. Drag a `.csv` with headers and 3+ rows.

- ✅ Preview shows a Markdown table with `| col1 | col2 |` format.
- ❌ CSV content shown as raw text.

**B2d. Upload a .pdf file (if pypdf installed)**
1. Drag a simple PDF (no scanned images — text-extractable).

- ✅ Preview shows readable Markdown text. Section headers may be `##` if detectable.
- ❌ Error shown, or garbled text.

**B2e. File too large**
1. Attempt to drag a file > 10 MB.

- ✅ Error toast: "File is too large (max 10 MB)."
- ❌ Upload attempted; server returns error.

---

### B3. Sidebar nav reorder

1. Observe the left sidebar.

- ✅ Order from top: Logo → **Handbook** → **Workflows** → separator → Dashboard → Runs → Escalations → separator → Settings.
- ✅ "Workflows" link navigates to `/graphs` (same route, new label).
- ❌ Handbook is still under a "Resources" section below Runs.

2. Click Workflows.

- ✅ Page renders the graphs list. Title reads "Workflows" (not "Designer" or "Graphs").
- ❌ Title still reads "Designer".

---

### B4. Run model extensions

**B4a. RunNodeState has agent_ref + node_name**
1. Trigger a run on a graph that has at least one LLM Agent node.
2. After the run completes, open the Node Inspector for a completed node.

- ✅ Node inspector shows the node's display name as the primary label (from `node_name`).
- ✅ `GET /api/v1/workspaces/{ws}/runs/{run_id}/nodes/{node_id}` response JSON includes `node_name` and `agent_ref` fields (even if `null` for now — the columns exist).
- ❌ Fields absent from API response.

**B4b. Worklog table exists**
1. Via curl: `GET /api/v1/workspaces/{ws}/runs/{run_id}/worklog`

- ✅ Returns `[]` for a run with no worklog entries (not a 404 or 500).
- ❌ 404 or 500.

**B4c. Proposals table exists**
1. Via curl: `GET /api/v1/workspaces/{ws}/runs/{run_id}/handbook-proposals`

- ✅ Returns `[]` (not 404 or 500).
- ❌ 404 or 500.

---

### B5. Agent API

**B5a. Session token is scoped**
1. A session token for run `abc`, node `review` must not work for run `abc`, node `summarise`.
   (Test with `POST /agent-api/log` using a token issued for a different node.)

- ✅ Returns 401.
- ❌ Log entry accepted.

**B5b. Write a worklog entry**
1. From a fresh run in `running` state (or mock), obtain the session token from `RunNodeState.input`.
2. `POST /agent-api/log` with `Authorization: Bearer <token>` and body `{"content": "Test log", "entry_type": "observation"}`.

- ✅ Returns `{id: "..."}`. Subsequent `GET .../runs/{run_id}/worklog` includes the entry.
- ❌ 401 or 500.

**B5c. Propose a handbook change**
1. `POST /agent-api/propose` with `{"path": "test/file.md", "proposed_content": "# Test", "reason": "test"}`.

- ✅ Returns `{id}`. `GET .../runs/{run_id}/handbook-proposals` shows status `"pending"`. The actual handbook file is NOT modified.
- ❌ Handbook file is modified directly, or proposal not saved.

**B5d. Escalate pauses the run**
1. `POST /agent-api/escalate` with `{"question": "Which option?", "options": ["A", "B"]}`.

- ✅ Returns `{escalation_id}`. `GET .../runs/{run_id}` shows `status: "paused"`.
- ❌ Run continues running; status unchanged.

**B5e. Complete a node**
1. `POST /agent-api/complete` with `{"output": "Done", "next_branch": null}`.

- ✅ Returns `{ok: true}`. Node state set to `completed`. Run continues to next node (or completes).
- ❌ 500 or node remains in `running` state.

**B5f. Expired token rejected**
1. Create a token with `exp` in the past. Call any Agent API endpoint.

- ✅ Returns 401.
- ❌ Request accepted.

---

## Regression

Run full test suite: `cd backend && python3 -m pytest ../docs/implementation/ -v`

- ✅ 205 pass, 5 xfail (the 5 `ddgs` import failures are pre-existing — acceptable). No previously-passing test now fails without documented reason.
- ❌ Any regression beyond the pre-existing 5.
