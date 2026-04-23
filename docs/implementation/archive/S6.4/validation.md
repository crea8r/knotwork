# S6.4 Validation Checklist

Run `cd backend && python3 -m pytest ../docs/implementation/archive/S6.4/tests/ -v` first.

---

## 1. Built-in Tool Test Modal

### 1a. web.search test
1. Go to Tools page → Built-in tools section.
2. Click **Try it** on `web.search`.
3. Enter a query (e.g. "OpenAI GPT-5").
4. Click **Run test**.

- ✅ Modal opens with a single "Search query" input. Result JSON appears below with duration_ms. No error.
- ❌ Modal doesn't open, or result shows an error, or the input is a generic JSON textarea.

### 1b. calc test
1. Click **Try it** on `calc`.
2. Enter "2 + 2 * 10".
3. Click **Run test**.

- ✅ Result shows `{"result": 22}` (or similar) with duration_ms.
- ❌ Error shown or wrong result.

### 1c. Section labels
- ✅ Built-ins section header reads "Built-in tools" with subtitle "Always available — no setup needed."
- ✅ Custom section header reads "Custom integrations".
- ❌ Labels unchanged from before.

---

## 2. Designer Chat — Persistent History

1. Open any graph → click **Designer**.
2. Type a message (e.g. "Add a node to summarize text").
3. Reload the server (`Ctrl+C` / restart uvicorn).
4. Reopen the same graph → Designer.

- ✅ Previous message and reply are visible in the chat. Relative timestamps shown (e.g. "2m ago").
- ❌ Chat starts empty after restart.

### 2b. Clear history
1. Click the trash icon in the chat header.
2. Confirm.

- ✅ Chat resets to welcome message. DB history is gone (reload page to verify).
- ❌ History persists or confirm dialog doesn't appear.

---

## 3. Modal Scroll Fix

1. Open a graph with 6+ input schema fields (use InputSchemaEditor to add them, see item 4).
2. Click **Run** (header button).

- ✅ Modal header ("Trigger Run") stays fixed. Fields list scrolls. Run ▶ button stays visible at the bottom without scrolling the whole page.
- ❌ Modal overflows viewport, or header/footer scroll with content.

---

## 4. Input Schema — Editable + No Auto-Rebuild

### 4a. Edit schema fields
1. Open a graph → right sidebar → click **Run Input** tab.
2. Click **Add field**. Set name, label, type.
3. Click **Save** (or it auto-saves on graph save).
4. Click **Run** → fields appear in the modal with correct label.

- ✅ New fields persist across page reload (after Save). Modal shows them.
- ❌ Fields disappear or modal shows raw JSON textarea.

### 4b. Designer doesn't overwrite manual schema
1. Add a field via InputSchemaEditor, set label to "Customer Email".
2. Click **Save**.
3. Chat with designer: "Add a step to validate the input".
4. After AI reply, check the "Run Input" tab.

- ✅ "Customer Email" field is still there, unchanged.
- ❌ Field was replaced/overwritten by designer suggestion.

### 4c. Designer sets schema for new graph
1. Create a new graph (no input schema).
2. Chat with designer: "Build a contract review workflow".
3. After reply, check the "Run Input" tab.

- ✅ Designer's suggested schema fields appeared (because schema was empty).
- ❌ Schema tab still empty.

---

## 5. Node Name Display in Runs

1. Ensure a graph has a node named "Review Contract" (id: `review-contract`).
2. Trigger a run and let it complete.
3. Open RunDetailPage.

- ✅ Node table shows "Review Contract" (not `review-contract`) in the Node column.
- ✅ Result banner shows "Result — Review Contract" (not the machine ID).
- ✅ NodeInspectorPanel header shows "Review Contract" with mono `review-contract` underneath.
- ❌ Machine IDs shown anywhere they shouldn't be.

---

## 6. START/END Nodes + Validation

### 6a. Canvas rendering
1. Open a graph that has a `start` node (or create one via designer chat: "Add start and end nodes").
2. Observe canvas.

- ✅ Start node renders as a green oval labeled "▶ Start". End as gray oval "■ End".
- ✅ Clicking a start/end node does NOT open a config panel (nothing to configure).
- ❌ Start/end render as rectangles like other nodes.

### 6b. Validation warning
1. Create a graph with an isolated node (not connected to start or end).
2. Observe the GraphDetailPage header area.

- ✅ Amber warning banner appears: `Node "X" is not reachable from Start`.
- ✅ **Run** button is disabled (grayed out) with a title tooltip.
- ❌ No warning shown; Run button still enabled.

### 6c. Validation passes for valid graph
1. Connect all nodes start→…→end.
2. Warning banner disappears. Run button re-enabled.

- ✅ Banner gone, Run button active.
- ❌ Warning persists for a properly connected graph.

### 6d. Backend validation
1. Use curl/Postman to `POST /api/v1/workspaces/{ws}/graphs/{g}/runs/trigger` on a graph with disconnected nodes.

- ✅ Returns 400 with the validation error message.
- ❌ Run starts anyway (ignores graph topology).

### 6e. Parallel starts
1. Create a graph: start → node-A, start → node-B → node-C → end.
2. Trigger a run.
3. Observe RunDetailPage — node state table.

- ✅ Both node-A and node-B appear as running/completed at the same time (parallel execution).
- ❌ Only one runs at a time.

---

## 7. Additional Gaps

### 7a. Copy output to clipboard
1. Open RunDetailPage → click any completed node → NodeInspectorPanel opens.
2. Click clipboard icon next to "Output".

- ✅ Output text copied. Icon briefly shows a green checkmark.
- ❌ No clipboard icon, or copy doesn't work.

### 7b. Failed node error display
1. Intentionally cause a node to fail (e.g. invalid model name in config).
2. Open NodeInspectorPanel for the failed node.

- ✅ Red error box shown above output section with the error message.
- ❌ No error shown; only status badge.

### 7c. Unsaved changes warning
1. Edit a node's config or add a node in GraphDetailPage (isDirty = true).
2. Try to close the tab or navigate away (browser back button).

- ✅ Browser shows "You have unsaved changes. Leave anyway?" dialog.
- ❌ No warning; changes lost silently.

---

## Regression

Run full test suite: `cd backend && python3 -m pytest ../docs/implementation/ -v`

- ✅ All prior tests pass (or are marked xfail with documented reasons). S6.4 tests also pass.
- ❌ Any previously passing test now fails without an xfail annotation.
