# S4 Validation Checklist

Run these steps manually after deploying to confirm S4 works end-to-end.

## Prerequisites
```bash
cd backend && uvicorn knotwork.main:app --reload
cd frontend && npm run dev
```

---

## 1. Import Markdown graph

```bash
curl -X POST http://localhost:8000/api/v1/workspaces/<ws>/graphs/import-md \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Contract Review",
    "content": "## Analyse Contract\n\n**Type:** llm_agent\n-> Review Gate\n\n## Review Gate\n\n**Type:** human_checkpoint"
  }'
```

- ✅ **Pass**: 201 response; `latest_version.definition.nodes` contains 2 nodes with ids `analyse-contract` and `review-gate`; `entry_point` is `analyse-contract`; graph appears in `GET /graphs`.
- ❌ **Fail**: 4xx error, nodes list is empty, ids are wrong, or graph is not listed.

---

## 2. Designer chat — add a node

In the graph detail page, click **Designer** to open the chat panel. Type:
> "Add an LLM node called Summarise after the last node"

- ✅ **Pass**: The agent replies with a confirmation; the canvas immediately shows a new "Summarise" node without a page reload; the Save button becomes active.
- ❌ **Fail**: The agent replies but the canvas doesn't change, or an error message appears.

---

## 3. Designer chat — multi-turn context

In the same session, send a follow-up:
> "Connect it to the Review Gate node"

- ✅ **Pass**: Agent understands "it" refers to the Summarise node added in the previous turn; a new edge appears on the canvas from Summarise → Review Gate.
- ❌ **Fail**: Agent asks "what node?" or adds a duplicate node, or the edge doesn't appear.

---

## 4. Designer chat — clarifying questions

Ask something ambiguous:
> "Add a router"

- ✅ **Pass**: Agent returns 1–2 clarifying questions (e.g. "What conditions should the router check?"); no nodes are added to the canvas yet.
- ❌ **Fail**: Agent adds a node immediately without asking, or no response appears.

---

## 5. LLM Agent node config panel

Click an `llm_agent` node on the canvas.

- ✅ **Pass**: Right panel shows fields for Model, System prompt, Knowledge paths (checkbox list from Handbook), Confidence threshold (0–1), Fail safe dropdown (escalate/retry/stop), Confidence rules editor, Checkpoints editor; editing any field immediately marks the graph as dirty (Save button appears).
- ❌ **Fail**: Panel shows raw JSON, any field is missing, or changes don't trigger the Save button.

---

## 6. Human Checkpoint config panel

Click a `human_checkpoint` node.

- ✅ **Pass**: Panel shows Reviewer prompt (textarea) and Timeout hours (number input); saving the graph persists these values.
- ❌ **Fail**: Panel shows wrong fields or the wrong node type label.

---

## 7. Conditional Router config panel

Click a `conditional_router` node.

- ✅ **Pass**: Panel shows Routing rules list with + Add rule button; each rule has a condition input and a target dropdown populated with other node names; Default target dropdown is also shown.
- ❌ **Fail**: Target dropdowns are empty, + Add rule does nothing, or panel crashes.

---

## 8. Tool Executor config panel

Click a `tool_executor` node.

- ✅ **Pass**: Panel shows Tool ID text input and Tool config JSON textarea; entering invalid JSON shows an inline error; valid JSON saves without error.
- ❌ **Fail**: Panel is missing, invalid JSON is accepted silently, or the field saves incorrect data.

---

## 9. Remove node via config panel

Click a node, then click **Remove** in the config panel.

- ✅ **Pass**: Node disappears from the canvas; all edges connected to it are also removed; the right panel closes; the Save button is active.
- ❌ **Fail**: Node remains on canvas, edges remain dangling, or the page crashes.

---

## 10. Update graph name via API

```bash
curl -X PATCH http://localhost:8000/api/v1/workspaces/<ws>/graphs/<id> \
  -H 'Content-Type: application/json' \
  -d '{"name": "Renamed Workflow"}'
```

- ✅ **Pass**: 200 response with `"name": "Renamed Workflow"`; `GET /graphs` lists the new name.
- ❌ **Fail**: 4xx error, or name is unchanged.

---

## 11. Delete graph via API

```bash
curl -X DELETE http://localhost:8000/api/v1/workspaces/<ws>/graphs/<id>
```

- ✅ **Pass**: 204 response; subsequent `GET /graphs/<id>` returns 404; graph is removed from the list.
- ❌ **Fail**: 4xx error, or graph still appears in the list.

---

## 12. Knowledge picker in LLM Agent config

In the LLM Agent config panel, verify the Knowledge paths section shows checkboxes for each Handbook file.

- ✅ **Pass**: Files added via the Handbook appear in the list; checking a file adds it to `config.knowledge_paths`; unchecking removes it; saving the version persists the selection.
- ❌ **Fail**: No files shown even when Handbook has entries, or check state isn't saved.
