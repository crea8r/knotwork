# S6.1 Validation Checklist

Run backend + frontend locally (`./dev.sh` or manually), then verify each item.

---

## 1. Designer agent emits `set_input_schema`

**Steps:**
1. Open a graph in Designer view
2. Open the Designer chat panel
3. Send: "Create a contract review workflow that takes a client name and contract text"

**✅ Pass:** The agent reply includes a `set_input_schema` array in `graph_delta` (visible in browser network tab → XHR to `/design/chat`). Fields should include at least `client_name` (text) and `contract_text` (textarea).

**❌ Fail:** `graph_delta` has no `set_input_schema` key, or `set_input_schema` is an empty array.

---

## 2. RunTriggerModal shows smart form

**Steps:**
1. After step 1, click "Save" in GraphDetailPage to persist the definition
2. Click the "Run ▶" button in the header

**✅ Pass:** Modal shows two labeled form fields (e.g., "Client Name" and "Contract Text"). No JSON textarea visible. Required fields are labeled appropriately.

**❌ Fail:** Modal still shows the JSON textarea, or no fields appear.

---

## 3. Graph without input_schema shows JSON fallback

**Steps:**
1. Open an older graph that has no `input_schema` in its definition
2. Click "Run ▶"

**✅ Pass:** Modal shows the JSON textarea labeled "Run Input (JSON) — Advanced".

**❌ Fail:** Modal is blank, crashes, or shows empty form fields.

---

## 4. Trigger run from smart form and see result

**Steps:**
1. Fill in the form fields in the RunTriggerModal and click "Run ▶"
2. Observe navigation to RunDetailPage
3. Wait for the run to complete

**✅ Pass:** Run completes, and a green result banner appears at the top of RunDetailPage showing the LLM output as readable prose, labeled with the node name.

**❌ Fail:** No banner appears, or banner shows raw JSON, or page crashes.

---

## 5. NodeInspectorPanel shows prose output

**Steps:**
1. On RunDetailPage, click a completed node row in the Nodes table

**✅ Pass:** NodeInspectorPanel slides in. If the node has `output.text`, it renders as a prose paragraph. A "Raw output" collapsible section is visible below.

**❌ Fail:** Output shows only raw JSON with no prose view.

---

## 6. Delete run from RunsPage

**Steps:**
1. Navigate to the Runs page
2. Find a completed/failed/stopped run
3. Click the trash icon on that row
4. Confirm the delete dialog

**✅ Pass:** The row disappears from the table immediately (optimistic or after refetch).

**❌ Fail:** Row remains, error toast appears, or the trash icon is not visible for terminal runs.

---

## 7. Delete run from RunDetailPage

**Steps:**
1. Navigate to a completed run's detail page
2. Click "Delete run" in the header
3. Confirm the delete dialog

**✅ Pass:** Page navigates back to `/runs` and the run no longer appears in the list.

**❌ Fail:** Error is shown, navigation doesn't happen, or "Delete run" button is not visible.

---

## 8. Active run cannot be deleted via DELETE endpoint

**Steps:**
1. Trigger a run on a graph with multiple nodes (slow enough to observe)
2. While run is in `queued` or `running` status, call `DELETE /workspaces/{ws}/runs/{run_id}` directly (curl or Postman)

**✅ Pass:** API returns `400` with message "Only terminal runs ... can be deleted".

**❌ Fail:** Run is deleted while active, or API returns 204.

---

## 9. RunsPage shows graph name

**Steps:**
1. Navigate to the Runs page

**✅ Pass:** Each run row has a "Graph" column showing the graph name (e.g., "Contract Review").

**❌ Fail:** Graph column is blank or shows "—" for all runs.

---

## 10. Automated tests pass

```bash
cd backend && python3 -m pytest ../docs/implementation/archive/S6.1/tests/ -v
```

**✅ Pass:** All tests pass (or only the 3 pre-existing xfails remain).

**❌ Fail:** Any test errors or failures.
