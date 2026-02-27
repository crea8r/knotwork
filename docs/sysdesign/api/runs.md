# API Specification — Runs & Escalations

## Runs

### Trigger a run

```
POST /api/v1/workspaces/:workspace_id/graphs/:graph_id/runs
```

Accepts `multipart/form-data` or `application/json`.

With file attachments (`multipart/form-data`):
```
input          (JSON field)   -- structured run state: { "contract_type": "purchase" }
files[]        (file fields)  -- one or more case-specific files (PDF, DOCX, images, etc.)
```

JSON-only (no file attachments):
```json
{
  "input": {
    "contract_type": "purchase",
    "contract_text": "..."
  }
}
```

Files are stored per-run (not in the knowledge base) and are accessible to agents during execution via the `file.read` tool as Run Context.

Response (immediate, async):
```json
{
  "data": {
    "run_id": "uuid",
    "status": "queued",
    "eta_seconds": 180,
    "poll_url": "/api/v1/workspaces/.../runs/uuid",
    "websocket_url": "wss://..."
  }
}
```

### Run operations

```
GET    /api/v1/workspaces/:workspace_id/runs
GET    /api/v1/workspaces/:workspace_id/runs/:run_id
DELETE /api/v1/workspaces/:workspace_id/runs/:run_id    -- abort a queued/running run
POST   /api/v1/workspaces/:workspace_id/runs/:run_id/resume
```

### Node state inspection

```
GET /api/v1/workspaces/:workspace_id/runs/:run_id/nodes
GET /api/v1/workspaces/:workspace_id/runs/:run_id/nodes/:node_id
```

Returns the full `RunNodeState` for each node: input, output, knowledge snapshot, confidence, status, timing.

---

## Escalations

```
GET    /api/v1/workspaces/:workspace_id/escalations
       -- query params: status=open, assigned_to=me
GET    /api/v1/workspaces/:workspace_id/escalations/:escalation_id

POST   /api/v1/workspaces/:workspace_id/escalations/:escalation_id/resolve
```

Resolve request body:
```json
{ "resolution": "approved" }
```
or
```json
{ "resolution": "edited", "output": { "irr": 0.12, "recommendation": "Proceed with conditions" } }
```
or
```json
{ "resolution": "guided", "guidance": "Check the depreciation schedule in Appendix B..." }
```
or
```json
{ "resolution": "aborted", "reason": "Contract withdrawn by counterparty" }
```

---

## Ratings

```
POST /api/v1/workspaces/:workspace_id/runs/:run_id/nodes/:node_id/rating
```

Request:
```json
{
  "score": 3,
  "comment": "Missed the foreign ownership clause"
}
```

```
GET /api/v1/workspaces/:workspace_id/ratings
    -- query params: node_id, graph_id, score_lte=3, limit, offset
```
