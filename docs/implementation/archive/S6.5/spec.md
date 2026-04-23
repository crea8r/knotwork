# S6.5 Spec — Handbook First + Run Foundation

## Summary

S6.5 is split into two parts.

**Part A (already implemented this session — canvas/validation fixes):**
Fixes discovered during S6.4 testing: start/end nodes now appear on every canvas (empty and
legacy), are clickable and selectable, loops render correctly, and legacy graphs without
start/end are blocked from running.

**Part B (new implementation):**
The Handbook — the product's primary asset — is given a proper two-panel UX with a persistent
folder-file tree, drag-and-drop file upload with automatic conversion to Markdown, and elevated
sidebar position. The run data model is extended to hold per-node agent identity, structured
agent logs, worklog entries, and handbook change proposals. An Agent API (4 lightweight
endpoints + session JWT) provides the integration layer that external agents will use in S7.

---

## Part A — Canvas / Validation Fixes

### A1. Start/End nodes auto-injected for all graphs

**Problem:** `setGraph` only injected start/end when `nodes.length === 0`. Legacy graphs
with existing work nodes but no start/end never got them; new graphs only got them after the
first designer chat interaction, not on first open.

**Fix (`store/canvas.ts`):**
`setGraph` now checks whether the definition contains a `start`-typed and an `end`-typed
node. If either is missing, they are prepended to the node list and `isDirty` is set to
`true` so the Save button appears. This fires for **all** graphs — empty new graphs and legacy
graphs with existing work nodes.

A `useEffect` in `GraphDetailPage.tsx` now calls `setGraph` eagerly when the graph loads
(condition: `storeGraphId !== graphId`), so the injection happens on first render, not on
the first user interaction.

### A2. Start/End nodes are clickable and show Connections panel

**Problem:** `StartEndOval` had `cursor: 'default'` and no `onClick` — clicking start/end
did nothing. Users had no way to wire edges from the Start node.

**Fix (`GraphCanvas.tsx`):**
`StartEndOval` now accepts `onClick` and uses `cursor: 'pointer'`. Clicking toggles
selection exactly like `NodeBox`. The `NodeConfigPanel` shows the full Connections section
(outgoing edges + "Connect to…" dropdown) for start/end nodes. `TYPE_LABEL` maps `'start'`
and `'end'` to proper display names. The Remove button is hidden for start/end (they are
structural and should not be deleted from the panel).

### A3. Legacy validation enforcement

**Problem:** `validate_graph()` had `if (startIds.size === 0) return []` — a legacy bypass
that silently allowed any graph without a Start node to run. Legacy workflows had no path
to quality.

**Fix (`validation.py`, `validateGraph.ts`):**
The bypass is removed. Both backend and frontend now return a clear, actionable error for
any graph with work nodes that is missing a Start or End node:

```
"Add a Start node and connect it to begin the workflow"
"Add an End node and connect your last node to it"
```

The S1 test fixture (`conftest.py`) is updated to include start/end nodes; the S6.4 test
`test_validate_legacy_no_start` is updated to assert the new error.

### A4. Loop edges render on canvas

**Problem:** Dagre in simple-graph mode overwrites edges between the same node pair. Back-edges
(loops) that dagre reverses internally during layout are not accessible via the old
`g.edge({v, w})` lookup (which has no `name`).

**Fix (`GraphCanvas.tsx`):**
- Dagre enabled in `multigraph: true` mode. Each edge is registered with `g.setEdge(src, tgt, {}, edge.id)` so parallel and back-edges are distinct entries.
- `EdgePath` looks up by `{v, w, name: edge.id}`. On miss (back-edge dagre reversed), falls
  back to a manually computed cubic Bezier path that hugs the left side of the graph — rendered
  as a **purple dashed line** to visually signal a feedback loop.
- A second arrow marker `#arrow-loop` (purple) is added to `<defs>`.

### A5. applyDelta deduplication

`applyDelta` in `canvas.ts` now deduplicates `add_nodes` and `add_edges` by ID before
merging. This prevents duplicate start/end nodes when the designer re-emits them for a graph
that already has them from the auto-injection seeding.

---

## Part B — Handbook UX, Run Foundation, Agent API

### B1. Handbook two-panel UX

The `HandbookPage` is rebuilt as a **two-panel layout**:

**Left panel — `FileTree` component (`components/handbook/FileTree.tsx`):**
- Derives folder/file hierarchy from the flat list of `KnowledgeFile` records by splitting
  each `path` on `/`.
- Folders are collapsible; state persists in `localStorage` keyed by workspace.
- Each file shows: health dot (color-coded), filename, ⚠ if token count is out of range
  (< 300 or > 6000). Folder shows aggregate health (worst child).
- Click a file → opens in the right editor panel (no navigation, no route change).
- "New file here" button appears on folder hover, pre-filling the folder prefix.
- Drag-and-drop upload zone: drop `.md`, `.txt`, `.pdf`, `.docx`, `.html`, `.csv` files
  onto any folder or the tree root → triggers the upload/conversion flow.

**Right panel — inline editor:**
The `KnowledgeFilePage` content (editor tabs: editor / history / health) is extracted into
a `FileEditor` component (`components/handbook/FileEditor.tsx`) and rendered inline when
a file is selected. No route change. The standalone `/handbook/file?path=…` route is kept
for direct linking but shares the same `FileEditor` component.

**Upload / conversion flow:**
1. Drop file onto tree → backend `POST /workspaces/{ws}/handbook/upload` (multipart).
2. Backend converts to Markdown, returns `{suggested_path, suggested_title, converted_content, format}`.
3. Frontend shows an `UploadPreviewPanel` (right panel replaces editor) with the converted
   Markdown, editable path and title. User can review and edit.
4. User clicks "Save to Handbook" → calls `POST /workspaces/{ws}/handbook/files` (existing endpoint).
5. Tree refreshes; file opens in editor.

**Conversion rules (`knowledge/conversion.py`):**

| Input format | Strategy |
|---|---|
| `.md` | Pass through unchanged |
| `.txt` | Add `# <filename>` heading, preserve line breaks |
| `.html` | `markdownify` or `html2text`: strip nav/scripts/footers, preserve headings + tables |
| `.csv` | Convert to Markdown table, add `# <filename>` heading |
| `.pdf` | `pypdf`: extract text page by page, detect headings by ALL-CAPS lines or short lines; emit `##` headings |
| `.docx` | `python-docx`: map Heading1→`#`, Heading2→`##`, Normal→paragraph, Table→markdown table |

Goal: maximum structure preservation. Not perfect parsing — acceptable for expert review.

**New dependencies (`pyproject.toml`):** `pypdf`, `python-docx`, `markdownify`

**New backend endpoint:** `POST /workspaces/{ws}/handbook/upload`
- Body: `multipart/form-data` with `file` field
- Returns: `{suggested_path, suggested_title, converted_content, format, original_filename}`
- File size limit: 10 MB

### B2. Sidebar nav reorder

**`Sidebar.tsx`** restructured:

```
⊞ Knotwork
──────────────
📖 Handbook        ← primary item (was under "Resources")
⊞  Workflows       ← renamed from "Designer" / "Graphs"
──────────────
📊 Dashboard
▶  Runs
⚠  Escalations
──────────────
⚙  Settings
```

- Handbook is the first substantive nav item — it is the product's primary asset.
- "Designer" renamed to "Workflows" throughout (`/graphs` route, page title, breadcrumbs).
- "Tools" remains in the nav for S6.5 (tool deprecation is an S7 concern).
- Section labels removed in favour of a simple separator line — less visual noise.

### B3. Run model extensions

**Migration: `alembic/versions/<hash>_s6_5_run_extensions.py`**

Adds to `run_node_states`:
- `node_name VARCHAR` — display name at time of run (denormalized, survives graph edits)
- `agent_ref VARCHAR` — e.g. `"claude:claude-3-5-sonnet"`, `"openai:asst_abc"`, `"openclaw:my-agent"`
- `agent_logs JSONB DEFAULT '[]'` — raw event stream: `[{ts, level, text, tool_name?, tool_args?, tool_result?}]`
- `next_branch VARCHAR` — routing decision emitted by the agent or human

Creates new table `run_worklog_entries`:
```sql
id UUID PK
run_id UUID → runs(id) ON DELETE CASCADE
node_id VARCHAR
agent_ref VARCHAR
created_at TIMESTAMPTZ
content TEXT            -- Markdown, human-readable
entry_type VARCHAR      -- 'observation' | 'tool_call' | 'decision' | 'proposal'
metadata JSONB          -- tool call args/result, proposal path, etc.
```

Creates new table `run_handbook_proposals`:
```sql
id UUID PK
run_id UUID → runs(id) ON DELETE CASCADE
node_id VARCHAR
agent_ref VARCHAR
path VARCHAR            -- handbook file path
proposed_content TEXT
reason TEXT
status VARCHAR DEFAULT 'pending'   -- 'pending'|'approved'|'rejected'|'edited'
reviewed_by UUID → users(id)
reviewed_at TIMESTAMPTZ
final_content TEXT      -- what was actually saved (may differ from proposal after editing)
created_at TIMESTAMPTZ
```

**ORM models (`runs/models.py`):** `RunWorklogEntry`, `RunHandbookProposal` added.
**Schemas (`runs/schemas.py`):** read schemas for both tables added.
**Service (`runs/service.py`):** `list_worklog(run_id)`, `list_proposals(run_id)` functions.

Existing `RunNodeState` writes in the runtime engine are updated to populate `node_name`
and `agent_ref` from the node definition and config.

### B4. Agent API — integration layer for external agents

A new router `agent_api/router.py` provides 4 endpoints. All require a **session token**
in the `Authorization: Bearer <token>` header.

**Session token (`agent_api/session.py`):**
- JWT signed with `JWT_SECRET`, payload: `{run_id, node_id, workspace_id, iss: "knotwork", exp: now + 2h}`
- Created by the runtime engine at the start of each node execution.
- Passed to agents as part of the `NodeContext` they receive (via adapter in S7).
- For S6.5, the token is generated but only stored in `RunNodeState.input` (so it's visible
  in the run inspector and testable via curl).

**Endpoints:**

`POST /agent-api/log`
```json
{ "content": "Reviewed NDA clauses 3-7. Found ambiguity in termination terms.", "entry_type": "observation", "metadata": {} }
```
Creates a `RunWorklogEntry`. Returns `{id}`.

`POST /agent-api/propose`
```json
{ "path": "legal/nda-guide.md", "proposed_content": "# NDA Guide\n...", "reason": "Clause 4 is ambiguous in current version" }
```
Creates a `RunHandbookProposal` with `status: "pending"`. Returns `{id}`. Does NOT write
to the handbook until a human approves.

`POST /agent-api/escalate`
```json
{ "question": "Should clause 4 be interpreted as mutual or one-sided?", "options": ["Mutual", "One-sided", "Ask client"] }
```
Sets the `RunNodeState` to `status: "paused"`, sets `Run.status` to `"paused"`, fires the
existing notification dispatcher. Returns `{escalation_id}`. The run inspector shows the
question and options; the operator responds, and the run resumes via the existing
`POST .../escalations/{id}/resolve` mechanism.

`POST /agent-api/complete`
```json
{ "output": "The contract is acceptable. Recommend approval with minor edits to clause 4.", "next_branch": "approve" }
```
Sets `RunNodeState.output`, `RunNodeState.next_branch`, `RunNodeState.status: "completed"`,
`RunNodeState.completed_at`. The LangGraph engine receives the output and routes to the
next node. Returns `{ok: true}`.

**Auth failure:** all endpoints return 401 with `{"error": "invalid or expired session token"}`.

**`main.py`:** `app.include_router(agent_api_router, prefix="/agent-api")` added.

---

## Key Decisions

1. **Handbook as primary nav item.** The handbook is the product's soul. The nav order now reflects this. Operators should feel they are opening their knowledge base, not launching a tool.

2. **Conversion is best-effort, not perfect.** The upload pipeline converts what it can and preserves structure. The user reviews and edits before saving. We do not try to parse every edge case — the expert is in the loop.

3. **Agent API tokens are scoped to run + node.** A token for node `review` in run `abc` cannot write to node `summarise` in run `abc`, nor to any node in run `def`. This prevents agent cross-contamination.

4. **`propose` does not write to the handbook.** It creates a proposal record in the DB. Human approval is always required. The handbook is sacred.

5. **`escalate` reuses the existing escalation mechanism.** We do not build a new pause/resume flow — we extend the existing `Escalation` model and `resolve` endpoint to carry the agent's question + options as `escalation.context`. The operator sees it in the Escalations page.

6. **`node_name` is denormalized into `RunNodeState`.** Graph definitions can be edited after a run completes. Storing the name at run time preserves the historical record.

7. **Loop edges are visual, not semantic.** The purple dashed back-edge style tells the operator "this is a feedback loop" without any runtime behavioural change. LangGraph already handles cycles via `conditional_edges`; the dagre canvas simply now shows them.

8. **Architecture pivot documented in roadmap.** The roadmap through S9 is updated to reflect: S7 = Agent Architecture (adapters, node schema evolution), S8 = OpenClaw-first capability transparency, S8.1 = Auth/RBAC hardening, S9 = MCP + deployment. The old S7 MCP-first approach is superseded.

---

## Breaking Changes

### `validate_graph` legacy bypass removed
Any graph with work nodes but no `start` node now returns a validation error. **Impact:** any
existing workflow that was running without start/end nodes will be blocked. **Mitigation:**
the canvas auto-injects start/end when the graph is opened — the user sees them, wires edges,
saves, and can run again.

### S6.4 spec note superseded
S6.4 spec stated: "The `StartEndOval` component is not click-selectable to avoid confusion."
This decision is reversed in S6.5. Start/end nodes are now clickable — the Connections panel
is the mechanism for wiring them.

---

## Files Changed

**Backend:**
- `knotwork/knowledge/conversion.py` (new) — format conversion module
- `knotwork/knowledge/router.py` — add `POST /handbook/upload` endpoint
- `knotwork/runs/models.py` — `RunWorklogEntry`, `RunHandbookProposal` ORM models; `RunNodeState` extended
- `knotwork/runs/schemas.py` — read schemas for worklog + proposals
- `knotwork/runs/service.py` — `list_worklog`, `list_proposals`
- `knotwork/agent_api/session.py` (new) — JWT create/validate
- `knotwork/agent_api/router.py` (new) — 4 Agent API endpoints
- `knotwork/main.py` — register agent_api router; import new models
- `knotwork/runtime/engine.py` — populate `node_name` + `agent_ref` in `RunNodeState` writes; generate + store session token
- `alembic/versions/<hash>_s6_5_run_extensions.py` (new) — migration

**Frontend:**
- `src/components/handbook/FileTree.tsx` (new) — folder-file tree with health dots
- `src/components/handbook/FileEditor.tsx` (new) — extracted from KnowledgeFilePage
- `src/components/handbook/UploadPreviewPanel.tsx` (new) — upload preview + edit before save
- `src/pages/HandbookPage.tsx` — rebuilt as two-panel layout
- `src/pages/KnowledgeFilePage.tsx` — now delegates to `FileEditor`
- `src/components/layout/Sidebar.tsx` — reordered nav, Workflows rename
- `src/api/knowledge.ts` — add `useUploadFile` mutation
- `src/store/canvas.ts` — already updated (Part A)
- `src/components/canvas/GraphCanvas.tsx` — already updated (Part A)
- `src/utils/validateGraph.ts` — already updated (Part A)

**Tests:** `docs/implementation/archive/S6.5/tests/`

**Docs:**
- `docs/implementation/archive/S6.5/spec.md` (this file)
- `docs/implementation/archive/S6.5/validation.md`
- `docs/implementation/roadmap.md` — updated S7–S9 + Phase 2
