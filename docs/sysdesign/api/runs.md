# API Specification — Runs & Escalations

## Runs

### Trigger a run

```
POST /api/v1/workspaces/:workspace_id/graphs/:graph_id/runs
```

Accepts `application/json`.

Use a two-step flow for run attachments:
1. Upload files first via `POST /api/v1/workspaces/:workspace_id/runs/attachments` (multipart, one file per call).
2. Trigger the run with the returned attachment refs in `context_files`.

Trigger payload:
```json
{
  "name": "optional run name",
  "input": {
    "contract_type": "purchase",
    "contract_text": "..."
  },
  "context_files": [
    {
      "key": "runs/<workspace_id>/<attachment_id>/contract.pdf",
      "url": "https://.../api/v1/workspaces/<workspace_id>/runs/attachments/<attachment_id>/contract.pdf?token=...",
      "filename": "contract.pdf",
      "mime_type": "application/pdf",
      "size": 123456,
      "attachment_id": "<attachment_id>"
    }
  ]
}
```

Constraints:
- Max 10 files per run.
- Max 10 MB per file.
- No MIME/extension allowlist at Knotwork layer.
- Knotwork does not parse/process file contents; it stores opaque bytes and forwards attachment refs/URLs to OpenClaw.
- Deleting a run also deletes its uploaded run attachments.

Attachment upload endpoint:
```
POST /api/v1/workspaces/:workspace_id/runs/attachments
Content-Type: multipart/form-data
file=<binary>
```

Upload response:
```json
{
  "key": "runs/<workspace_id>/<attachment_id>/contract.pdf",
  "url": "https://.../api/v1/workspaces/<workspace_id>/runs/attachments/<attachment_id>/contract.pdf?token=...",
  "filename": "contract.pdf",
  "mime_type": "application/pdf",
  "size": 123456,
  "attachment_id": "<attachment_id>"
}
```

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
POST   /api/v1/workspaces/:workspace_id/runs/:run_id/abort
DELETE /api/v1/workspaces/:workspace_id/runs/:run_id    -- hard delete (non-running runs only)
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
{ "resolution": "accept_output" }
```
or
```json
{ "resolution": "override_output", "output": { "irr": 0.12, "recommendation": "Proceed with conditions" } }
```
or
```json
{ "resolution": "request_revision", "guidance": "Check the depreciation schedule in Appendix B..." }
```
or
```json
{ "resolution": "abort_run", "reason": "Contract withdrawn by counterparty" }
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
