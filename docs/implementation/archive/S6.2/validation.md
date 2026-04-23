# S6.2 Validation Checklist

Run `cd backend && alembic upgrade head` before testing.

---

## 1. Run naming

### 1a. Name at trigger time
Open any graph → click **Run** → fill the **Run name** field (e.g. "Test run A") → submit.
- ✅ Run is created; navigates to RunDetailPage which shows "Test run A" in the header.
- ❌ Name field is absent from the modal, or name does not appear in the header.

### 1b. Inline rename in RunDetailPage
On RunDetailPage, click the pencil icon next to the run name → type a new name → press Enter.
- ✅ The name updates in-place without a page reload.
- ❌ Input does not appear, or name does not update after Enter.

### 1c. Inline rename in RunsPage
On RunsPage, click the "Name…" placeholder (or existing name) in the Name column → type a name → press Enter.
- ✅ The name updates in the cell without navigating away.
- ❌ Click does nothing, or saving fails.

### 1d. Untitled fallback
Open a run that has no name.
- ✅ RunDetailPage shows "Untitled run" in grey. RunsPage shows italic "Name…" in grey.
- ❌ Empty cell or an error.

---

## 2. Delete queued / paused runs

### 2a. Delete queued run
Trigger a run on a graph that has no worker running — it stays `queued`. Click the trash icon.
- ✅ Confirmation dialog appears; confirm → row disappears from RunsPage, run is gone.
- ❌ Trash icon not visible, or deletion is rejected with "Only terminal…" error.

### 2b. Delete paused run
Have a paused run (from an escalation). Open RunDetailPage → click **Delete**.
- ✅ Confirmation → navigates to /runs, run no longer appears.
- ❌ Button absent or 400 error from API.

### 2c. Running run cannot be deleted
A run currently in `running` status should not show the trash icon.
- ✅ No trash icon for running runs.
- ❌ Trash icon visible or deletion succeeds.

---

## 3. Exact graph version in RunDetailPage

### 3a. Old version shown correctly
Save version V1 of a graph → trigger a run. Edit the graph (add/remove a node) → save V2. Open the run detail.
- ✅ The canvas shows V1 nodes (what the run actually executed), not V2.
- ❌ Canvas shows V2 nodes (latest version).

---

## 4. Enriched runs table

### 4a. Input summary
Trigger a run with a named input field (e.g. "Customer name: Acme Corp"). Open RunsPage.
- ✅ "Acme Corp" (or truncated) appears in the Input column for that run.
- ❌ Input column is empty or shows "—".

### 4b. Output summary
After a run completes successfully, return to RunsPage.
- ✅ The Output column shows the first ~200 chars of the last completed node's text output.
- ❌ Output column always shows "—".

### 4c. Needs attention badge
A paused run appears in RunsPage.
- ✅ An amber "⚠ Review" badge appears alongside the status badge.
- ❌ No badge.

### 4d. Token count
Complete a run that executes at least one LLM node. Check RunsPage.
- ✅ A number appears in the Tokens column (e.g. "1,234").
- ❌ Column always shows "—".

---

## 5. Node inspector: input + output

### 5a. First node shows run input only
Open a completed run → click the first node in the table.
- ✅ Inspector shows an **Input** section with "Raw input" expandable (containing `run_input`). `previous_output` is null/absent.
- ❌ Input section absent.

### 5b. Second node shows previous output
Open a completed multi-node run → click the second node.
- ✅ Inspector shows a blue "Previous node output" block containing the first node's text output, plus a "Raw input" expander.
- ❌ Previous output not shown.

### 5c. Output still shown
For any completed node, the **Output** section still shows the node's prose output + "Raw output" expander.
- ✅ Both Input and Output sections visible.
- ❌ Output section disappeared.

---

## 6. Regression: prior sessions

Run `cd backend && python3 -m pytest ../docs/implementation/ -v`.
- ✅ 174 passed, 3 xfailed — no new failures.
- ❌ Any new failures beyond the 3 known xfails.
