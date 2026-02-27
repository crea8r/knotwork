# S3 Validation Checklist

Run these steps manually after deploying to confirm S3 works end-to-end.

## Prerequisites
```bash
# Backend
cd backend && uvicorn knotwork.main:app --reload

# Frontend
cd frontend && npm run dev
```

---

## 1. Create a knowledge file via API

```bash
curl -X POST http://localhost:8000/api/v1/workspaces/<ws_id>/knowledge \
  -H 'Content-Type: application/json' \
  -d '{"path":"legal/guide.md","title":"Legal Guide","content":"## Legal\nCheck the termination clause.\nSee [[red-flags]] for details."}'
```

- ✅ **Pass**: 201 response; `current_version_id` is a UUID; `linked_paths` contains `"red-flags"`; `raw_token_count` > 0.
- ❌ **Fail**: 4xx error, `linked_paths` is empty, or `raw_token_count` is 0.

---

## 2. Handbook file tree (frontend)

Navigate to `/handbook`.

- ✅ **Pass**: Created file appears in the table; its token count is visible; health badge shows `—` (no runs yet); clicking the row navigates to `/handbook/file?path=legal/guide.md`.
- ❌ **Fail**: Table is empty, health badge shows a number instead of `—`, or clicking a row does nothing.

---

## 3. Markdown editor — save

On the file detail page (`/handbook/file?path=legal/guide.md`), edit the content and click **Save**.

- ✅ **Pass**: Save button briefly shows "Saving…"; after save the editor shows the updated content; the History tab shows a new entry at the top.
- ❌ **Fail**: Save button stays loading, content reverts, or history is unchanged.

---

## 4. Token badge warnings

Create a file with very short content (< 300 tokens), e.g. `"content": "Hello"`. Then create another with > 6 000 tokens.

- ✅ **Pass**: Short file shows `⚠ sparse` next to its token count in both the list and the file page header; long file shows `⚠ large`.
- ❌ **Fail**: Warning text does not appear, or both files show no warning.

---

## 5. Version history + restore

Edit the file twice (two separate saves), then open the **History** tab.

- ✅ **Pass**: 3 entries listed (original + 2 edits); the top entry is labelled "Current"; older entries have a "Restore" button; clicking Restore updates the editor content to the restored version.
- ❌ **Fail**: Only 1 entry shown, "Restore" button missing, or restored content does not match the historical version.

---

## 6. Delete a file

On the Handbook page, click **Delete** next to a file and confirm.

- ✅ **Pass**: File disappears from the list; `GET /knowledge/file?path=<path>` returns 404.
- ❌ **Fail**: File remains in list, or 404 is returned before deletion.

---

## 7. Health score — cold start (no runs)

```bash
curl "http://localhost:8000/api/v1/workspaces/<ws_id>/knowledge/health?path=legal/guide.md"
```

- ✅ **Pass**: Response `{"path": "legal/guide.md", "health_score": 0.0}` (no run data yet).
- ❌ **Fail**: Non-zero score with no prior runs, or 404.

---

## 8. Health score — after a run

Complete a run that uses `legal/guide.md` as a knowledge fragment (set it in the node's config). Then re-request the health endpoint.

- ✅ **Pass**: `health_score` is > 0.0; the Handbook file list shows a green/yellow/red badge next to the file; the Health tab on the file page shows the composite breakdown text.
- ❌ **Fail**: Score stays 0.0 after runs, badge remains `—`, or Health tab is blank.

---

## 9. Mode B suggestions

On the file page, open the **Health & Suggestions** tab.

- ✅ **Pass**: Up to 3 amber suggestion cards appear (each prefixed with 💡); each card contains a specific, actionable improvement note.
- ❌ **Fail**: Section shows "No suggestions yet" despite the file having run history, or an API error appears.

---

## 10. Search filter (frontend)

On the Handbook page, type in the search box.

- ✅ **Pass**: Table rows filter in real-time to only show files whose path or title matches the search term; clearing the field restores all rows.
- ❌ **Fail**: All rows are always shown regardless of search text, or the table clears completely.

---

## 11. Health tab in file page shows signal weights

Open the Health & Suggestions tab on any file.

- ✅ **Pass**: The page shows `token 20% · confidence 30% · escalation 25% · rating 25%` below the score.
- ❌ **Fail**: Signal weights are missing or wrong.
