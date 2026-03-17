# API Specification — Knowledge, Tools & Real-time

## Knowledge

```
GET    /api/v1/workspaces/:workspace_id/knowledge
       -- file tree listing with health scores

GET    /api/v1/workspaces/:workspace_id/knowledge/health
       -- workspace-wide health overview: all fragments sorted by health score
       -- query params: below=3.0 (filter by score threshold), owner_id

GET    /api/v1/workspaces/:workspace_id/knowledge/file/health?path=...
       -- health score breakdown for a single fragment

GET    /api/v1/workspaces/:workspace_id/knowledge/file?path=contracts/guide.md
POST   /api/v1/workspaces/:workspace_id/knowledge/file
PATCH  /api/v1/workspaces/:workspace_id/knowledge/file?path=...
DELETE /api/v1/workspaces/:workspace_id/knowledge/file?path=...

GET    /api/v1/workspaces/:workspace_id/knowledge/file/history?path=...
POST   /api/v1/workspaces/:workspace_id/knowledge/file/restore
       -- body: { path: "...", version_id: "..." }

POST   /api/v1/workspaces/:workspace_id/knowledge/folder
DELETE /api/v1/workspaces/:workspace_id/knowledge/folder?path=...

GET    /api/v1/workspaces/:workspace_id/knowledge/file/usage?path=...
       -- which nodes/graphs reference this file

GET    /api/v1/workspaces/:workspace_id/knowledge/file/suggestions?path=...
       -- Mode B improvement suggestions pending for this file
POST   /api/v1/workspaces/:workspace_id/knowledge/file/suggestions/:suggestion_id/approve
POST   /api/v1/workspaces/:workspace_id/knowledge/file/suggestions/:suggestion_id/reject
```

---

## <span style="color:#c1121f;font-weight:700">LEGACY</span> Tool Registry *(removed in S7)*

The `/tools` endpoints were removed in S7. Agents bring their own tools.
See `docs/sysdesign/engine/tools.md` for the current tool model.

---

## WebSocket: Run Events

Connect to: `wss://.../api/v1/ws/runs/:run_id?token=<jwt>`

Events pushed to client:

```json
{ "event": "run.status", "data": { "status": "running" } }

{ "event": "node.started",    "data": { "node_id": "...", "started_at": "..." } }
{ "event": "node.completed",  "data": { "node_id": "...", "output": {...}, "confidence": 0.87 } }
{ "event": "node.paused",     "data": { "node_id": "...", "escalation_id": "..." } }
{ "event": "node.failed",     "data": { "node_id": "...", "error": "..." } }

{ "event": "escalation.created", "data": { "escalation_id": "...", "node_id": "...", "type": "low_confidence" } }
{ "event": "escalation.resolved","data": { "escalation_id": "...", "resolution": "accept_output" } }

{ "event": "run.completed",   "data": { "output": {...} } }
{ "event": "run.failed",      "data": { "error": "..." } }
{ "event": "run.stopped",     "data": { "reason": "escalation_timeout" } }
```

---

## Audit Log

```
GET /api/v1/workspaces/:workspace_id/audit-log
    -- query params: resource_type, resource_id, actor_id, from, to, limit, offset
```

---

## Webhook: Run Completion

Configure on a graph:
```json
{
  "trigger_config": {
    "api": true,
    "webhook_on_complete": "https://your-app.com/hooks/knotwork"
  }
}
```

Payload sent on run completion:
```json
{
  "event": "run.completed",
  "run_id": "uuid",
  "graph_id": "uuid",
  "status": "completed",
  "output": { ... },
  "duration_seconds": 142,
  "completed_at": "2025-03-01T10:30:00Z"
}
```
