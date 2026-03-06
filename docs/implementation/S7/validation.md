# Session 7 Validation Checklist

Run `cd backend && python3 -m pytest ../docs/implementation/S7/tests/ -v` first.
Then perform the manual checks below.

---

## 1. Graph designer — agent node type

**Steps**
1. Open `/graphs`, create a new workflow or open an existing one.
2. Click **Add node**, enter a name (e.g. "Analyse"), click Add.
3. Select the new node on the canvas.

✅ **Pass**: The node type dropdown in the "Add node" form shows only "Agent".
✅ **Pass**: The right panel shows the AgentNodeConfig with an agent dropdown defaulted to `anthropic:claude-sonnet-4-6`.
❌ **Fail**: The dropdown still shows LLM Agent / Human Checkpoint / Conditional Router / Tool Executor.

---

## 2. Agent config panel — agent_ref and trust_level persist

**Steps**
1. Select an agent node.
2. Change the agent to "Human".
3. Click Save (unsaved changes indicator should appear first).
4. Reload the page.

✅ **Pass**: After reload, the node's agent is still "Human".
❌ **Fail**: After reload, agent_ref reverted to the previous value.

---

## 3. Human agent node — question field

**Steps**
1. Select a node with agent "Human".
2. Observe the config panel.

✅ **Pass**: Only a "Question (optional)" text field is shown — no system prompt, knowledge paths, or confidence controls.
❌ **Fail**: Full LLM controls (system prompt, knowledge paths) are shown.

---

## 4. Legacy node — config panel label

**Steps**
1. If you have a graph with old `llm_agent` or `human_checkpoint` nodes (from a previous session), open it.
2. Select one of those nodes.

✅ **Pass**: The config panel header shows `LLM Agent (legacy)` or `Human Checkpoint (legacy)`.
❌ **Fail**: The panel shows "Agent" or crashes.

---

## 5. Handbook — Proposals tab

**Steps**
1. Navigate to `/handbook`.
2. Look for a tab bar at the top.

✅ **Pass**: Two tabs are visible: "Files" and "Proposals".
✅ **Pass**: Clicking "Proposals" shows a list panel (empty state: "No proposals.").
✅ **Pass**: Clicking "Files" returns to the normal two-panel file tree view.
❌ **Fail**: No tab bar, or switching tabs breaks the layout.

---

## 6. Handbook proposals — approve / reject

**Steps** (requires a run that produced a proposal — either real or via db seed)
1. If a `RunHandbookProposal` row exists with `status='pending'`, open `/handbook` → Proposals.
2. Click the proposal in the list.
3. Click "Approve".

✅ **Pass**: The proposal's status badge changes to "approved"; the file tree updates to reflect the new/updated file.
✅ **Pass**: Clicking "Reject" changes the status badge to "rejected" without writing a file.
❌ **Fail**: 409 Conflict error when approving/rejecting; proposal list doesn't refresh.

---

## 7. Tools route removed

**Steps**
1. Navigate to `/tools` directly in the browser.

✅ **Pass**: 404 or redirect to `/dashboard`.
❌ **Fail**: The ToolsPage is still rendered.

---

## 8. Adapter registry

**Steps** (automated — see `tests/test_s7.py` `test_get_adapter_*`):
- `get_adapter("human")` returns `HumanAdapter`.
- `get_adapter("anthropic:claude-sonnet-4-6")` returns `ClaudeAdapter`.
- `get_adapter("openai:gpt-4o")` returns `OpenAIAdapter`.
- `get_adapter("unknown")` raises `ValueError`.

✅ **Pass**: All 4 adapter registry tests pass.
❌ **Fail**: Any test raises `ImportError` or returns wrong type.

---

## 9. HumanAdapter — yields single escalation event

**Steps** (automated — see `tests/test_s7.py` `test_human_adapter`):

✅ **Pass**: Running `HumanAdapter().run_node(...)` yields exactly one event with `type="escalation"`.
❌ **Fail**: No event, or event type is wrong.

---

## 10. Builtin endpoints return 404

**Steps**
1. With the backend running: `curl http://localhost:8000/api/v1/workspaces/any/builtins`

✅ **Pass**: 404 Not Found.
❌ **Fail**: 200 with builtin list.

---

## 11. Proposal list endpoint

**Steps**
1. With the backend running:
   ```
   curl "http://localhost:8000/api/v1/workspaces/<ws_id>/handbook/proposals"
   ```

✅ **Pass**: 200 with `[]` (empty array if no proposals exist).
❌ **Fail**: 404, 422, or 500.

---

## 12. Regression — all prior tests pass

```bash
cd backend
python3 -m pytest ../docs/implementation/ -v
```

✅ **Pass**: All prior tests pass or are marked `xfail` (expected failures).
❌ **Fail**: Any previously-passing test now fails unexpectedly.
