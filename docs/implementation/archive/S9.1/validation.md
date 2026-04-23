# S9.1 Validation Checklist — Workflow Version Management

Run the automated tests first:
```bash
cd backend && pytest ../docs/implementation/archive/S9.1/tests/ -v
```
All 18 tests must pass before proceeding with manual validation.

---

## 1. New workflow starts as a bare draft

**Steps**: Create a new workflow via the UI.
**Pass ✅**: The designer header shows an amber "Draft" pill. No version appears in the version history panel. The root draft has no parent version.
**Fail ❌**: A version immediately appears in the version list, or the Draft badge is absent.

---

## 2. Draft auto-saves (no confirmation, quiet indicator)

**Steps**: Open the designer, type changes to the graph.
**Pass ✅**: Changes save without any modal or popup. A subtle "Saved" or equivalent indicator appears briefly.
**Fail ❌**: A save dialog pops up on every edit, or changes are lost on navigation.

---

## 3. "Save as version" creates a named version

**Steps**: Promote the root draft by clicking the promote action.
**Pass ✅**: A new entry appears in the version history panel. The version has a coolname (e.g. `swift-falcon-42`) and a 9-character version ID. The designer remains in draft-editing mode, now based on that version.
**Fail ❌**: The version list is empty, the name is blank, or the version ID is not 9 characters.

---

## 4. Multiple drafts coexist — one per version

**Steps**: Promote to v1. Start editing the graph (creates v1's draft). Also start editing from v2 (if it exists). Check that both drafts are listed in the version panel.
**Pass ✅**: The version panel shows v1 with a draft branch indicator, and v2 (or root) with its own separate draft branch indicator.
**Fail ❌**: Only one draft exists at a time; editing one version's draft overwrites another's.

---

## 5. Test run against a draft is labeled "Draft"

**Steps**: Click "Run" with the draft active (no version selected). In the run history, find the run.
**Pass ✅**: The run row shows an amber "Draft" badge. Run detail shows the parent version name + snapshot timestamp (e.g. "based on swift-falcon-42 · snapshot Mar 24, 2026 3:45 PM").
**Fail ❌**: The run appears unlabeled, or draft run metadata is missing.

---

## 6. Draft runs excluded from run history by default

**Steps**: Trigger one draft run and one version run. Open the Runs page.
**Pass ✅**: By default, only the version run appears. Enabling "Show draft runs" toggle reveals both.
**Fail ❌**: Draft runs appear by default, or the toggle has no effect.

---

## 7. Version run carries no draft metadata

**Steps**: Trigger a run against a named version (not a draft).
**Pass ✅**: The run row shows no amber "Draft" badge. Run detail shows the version name/ID. No snapshot timestamp.
**Fail ❌**: The run is mislabeled as a draft, or version info is missing.

---

## 8. Production version highlight and default run target

**Steps**: Mark v2 as production in the version history panel.
**Pass ✅**: v2 gets a green "Production" label. Triggering a run from the run modal defaults to v2 without manual selection.
**Fail ❌**: The green label doesn't appear, or the run modal defaults to a different version.

---

## 9. Archive guard: cannot archive production version

**Steps**: Try to archive the production version.
**Pass ✅**: An error message appears: "Cannot archive the production version."
**Fail ❌**: Archival succeeds, or the error message doesn't appear.

---

## 10. Archive hides version from default list

**Steps**: Archive a non-production version. Check the version panel.
**Pass ✅**: The archived version disappears from the default list. Enabling "Show archived" reveals it.
**Fail ❌**: The version remains visible without enabling the toggle.

---

## 11. Delete guard: blocked by runs or public page

**Steps**: Attempt to delete a version that has runs.
**Pass ✅**: Error: "Cannot delete a version that has runs." Delete button is hidden for versions with run_count > 0.
**Fail ❌**: Deletion succeeds, or no error appears.

**Steps**: Enable the public page on a version, then attempt to delete it.
**Pass ✅**: Error: "Cannot delete a version with an active public page."
**Fail ❌**: Deletion succeeds.

---

## 12. Version rename: version_id unchanged

**Steps**: Click a version name to rename it. Save the new name.
**Pass ✅**: The version name updates in the panel. The 9-char version ID remains unchanged.
**Fail ❌**: The version ID also changes, or the new name isn't saved.

---

## 13. Fork version: creates new independent workflow

**Steps**: Click the fork icon on a named version. Enter a name for the new workflow. Confirm.
**Pass ✅**: A new workflow appears in the Graphs list with the chosen name. Opening it shows the designer with a Draft badge (the forked version's graph as the root draft). The original workflow is unchanged.
**Fail ❌**: No new workflow is created, the fork shares data with the original, or an error occurs.

---

## 14. Version run executes against the correct (immutable) definition

**Steps**: Promote a draft to v1. Edit the graph further (creating a new draft). Trigger a run against v1.
**Pass ✅**: The run executes against v1's definition, not the current draft. Node names and structure match v1 exactly.
**Fail ❌**: The run uses the draft's definition instead of v1.

---

## 15. Draft run uses snapshotted definition even if draft is edited

**Steps**: Trigger a run against a draft. While the run is queued/running, edit the draft. Confirm the run still executes against the original snapshot.
**Pass ✅**: The run completes using the graph structure at the time the run was triggered, not the edited draft.
**Fail ❌**: The run behavior changes because the draft was edited mid-run.
