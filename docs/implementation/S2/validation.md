# S2 Validation Checklist

Run these steps manually after deploying to confirm S2 works end-to-end.

## Prerequisites
```bash
# Start backend (with DB + Redis running)
cd backend && uvicorn knotwork.main:app --reload

# Start worker
cd backend && arq knotwork.worker.tasks.WorkerSettings

# (Optional) WebSocket test client
wscat -c "ws://localhost:8000/api/v1/ws/runs/<run_id>"
```

---

## 1. WebSocket live events

Trigger a run, then open a WebSocket connection to `ws://localhost:8000/api/v1/ws/runs/{run_id}`.

- ✅ **Pass**: Receive `{"type": "run_started", "run_id": "..."}` within ~1 s of the worker picking up the job; receive `{"type": "node_completed", ...}` for each LLM node; receive `{"type": "run_status_changed", "status": "completed"}` at the end; WebSocket closes after terminal status.
- ❌ **Fail**: No messages arrive, connection is refused, or the connection stays open after the run reaches a terminal state.

---

## 2. Human checkpoint pause + escalation created

Create a graph with a `human_checkpoint` node after an LLM node, trigger a run.

- ✅ **Pass**: `GET /api/v1/workspaces/{ws}/runs/{run_id}` returns `"status": "paused"`; `GET /api/v1/workspaces/{ws}/escalations?status=open` returns one escalation with `"type": "human_checkpoint"`.
- ❌ **Fail**: Run reaches `"completed"` without pausing, or escalation list is empty.

---

## 3. Resolve: approved → run completes

`POST /api/v1/workspaces/{ws}/escalations/{id}/resolve` with `{"resolution": "approved"}`.

- ✅ **Pass**: Response returns `"status": "resolved"`, `"resolution": "approved"`; run eventually reaches `"status": "completed"`.
- ❌ **Fail**: 4xx response, run stays `"paused"`, or run reaches `"failed"`.

---

## 4. Resolve: guided → run resumes

`POST .../resolve` with `{"resolution": "guided", "guidance": "Be more concise."}`.

- ✅ **Pass**: Escalation status becomes `"resolved"`, run resumes (reaches `"completed"` or pauses again at the next checkpoint).
- ❌ **Fail**: Run stays `"paused"` indefinitely, or guidance field is not recorded in `resolution_data`.

---

## 5. Resolve: edited → run resumes with new output

`POST .../resolve` with `{"resolution": "edited", "edited_output": {"text": "corrected"}}`.

- ✅ **Pass**: Escalation resolved; `resolution_data.edited_output` equals `{"text": "corrected"}`; run continues.
- ❌ **Fail**: 422 validation error, or `edited_output` is not stored.

---

## 6. Resolve: aborted → run stopped

`POST .../resolve` with `{"resolution": "aborted"}`.

- ✅ **Pass**: Escalation `"status": "resolved"`, `"resolution": "aborted"`; run `"status": "stopped"`.
- ❌ **Fail**: Run status remains `"paused"` or becomes `"failed"`.

---

## 7. Escalation timeout

Set `escalation_timeout_hours_default = 0` in `.env` (or create an escalation manually with `timeout_at` in the past), then wait for the cron to fire (every 5 min) or trigger `check_escalation_timeouts` directly.

- ✅ **Pass**: Escalation `"status": "timed_out"`; run `"status": "stopped"`.
- ❌ **Fail**: Escalation stays `"open"` after the deadline passes, or run remains `"paused"`.

---

## 8. Node rating — submit + list

Complete a run with at least one LLM node. Get the `node_state_id` from `GET .../runs/{run_id}/nodes`. Then:
```
POST /api/v1/workspaces/{ws}/runs/{run_id}/nodes/{node_state_id}/rating
{"score": 4, "comment": "Good output"}
```

- ✅ **Pass**: 201 response with `"score": 4`; `GET /api/v1/workspaces/{ws}/ratings` includes the new rating.
- ❌ **Fail**: 404 (node not found), 422 (validation error), or rating does not appear in list.

---

## 9. Abort run via DELETE

While a run is `"running"` or `"paused"`, call `DELETE /api/v1/workspaces/{ws}/runs/{run_id}`.

- ✅ **Pass**: Response `{"status": "stopped", "run_id": "..."}` and `GET .../runs/{run_id}` returns `"status": "stopped"`.
- ❌ **Fail**: 4xx error, or run status does not change.

---

## 10. Frontend — RunDetailPage with WebSocket

Open `/runs/{run_id}` while a run is active.

- ✅ **Pass**: "live" blue badge is visible while status is `running`; node table rows update in real-time as nodes complete; when run pauses, an amber "Review escalation →" link appears; star rating buttons are visible for completed nodes; clicking a star submits a rating (button changes to "Rated").
- ❌ **Fail**: Page still polls (no live updates without manual refresh), "live" badge never appears, or star buttons have no effect.

---

## 11. Frontend — Escalations inbox

Navigate to `/escalations`.

- ✅ **Pass**: Table lists all escalations; filter buttons (open / resolved / all) correctly narrow the list; "Review" button is only shown for `open` escalations.
- ❌ **Fail**: Page is blank, filters have no effect, or resolved escalations show a "Review" button.

---

## 12. Frontend — Escalation detail + resolve

Click "Review" on an open escalation.

- ✅ **Pass**: Prompt text, confidence score (if applicable), and current output preview are all visible; clicking "Guided" shows a text area; clicking "Confirm: guided" resolves the escalation and redirects to `/escalations`; the resolved escalation no longer appears in the "open" filter.
- ❌ **Fail**: Detail page is blank, output preview is missing, form submission returns an error, or page does not redirect after resolving.
