# API Specification

## Overview

The Knotwork API is a REST API with WebSocket support for real-time events. All endpoints are under `/api/v1`.

Authentication uses JWT bearer tokens. API-triggered runs use API keys.

All responses follow a standard envelope:
```json
{
  "data": { ... },
  "error": null
}
```
On error:
```json
{
  "data": null,
  "error": { "code": "NOT_FOUND", "message": "Graph not found" }
}
```

---

## Authentication

```
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout

POST /api/v1/workspaces/:workspace_id/api-keys
GET  /api/v1/workspaces/:workspace_id/api-keys
DELETE /api/v1/workspaces/:workspace_id/api-keys/:key_id
```

---

## Workspaces

```
GET    /api/v1/workspaces
POST   /api/v1/workspaces
GET    /api/v1/workspaces/:workspace_id
PATCH  /api/v1/workspaces/:workspace_id

GET    /api/v1/workspaces/:workspace_id/members
POST   /api/v1/workspaces/:workspace_id/members
PATCH  /api/v1/workspaces/:workspace_id/members/:user_id
DELETE /api/v1/workspaces/:workspace_id/members/:user_id
```

---

## Graphs

```
GET    /api/v1/workspaces/:workspace_id/graphs
POST   /api/v1/workspaces/:workspace_id/graphs
GET    /api/v1/workspaces/:workspace_id/graphs/:graph_id
PATCH  /api/v1/workspaces/:workspace_id/graphs/:graph_id
DELETE /api/v1/workspaces/:workspace_id/graphs/:graph_id

GET    /api/v1/workspaces/:workspace_id/graphs/:graph_id/versions
GET    /api/v1/workspaces/:workspace_id/graphs/:graph_id/versions/:version_id
POST   /api/v1/workspaces/:workspace_id/graphs/:graph_id/versions
       -- saves current definition as a named version
```

### Graph definition (PUT/PATCH body)

```json
{
  "name": "Hotel Contract Review",
  "description": "...",
  "default_model": "openai/gpt-4o",
  "trigger_config": {
    "manual": true,
    "api": true
  },
  "definition": {
    "nodes": [ { ... } ],
    "edges": [ { ... } ]
  }
}
```

### Import from Markdown

```
POST /api/v1/workspaces/:workspace_id/graphs/import-md
```

Request body:
```json
{
  "content": "# Hotel Contract Review Workflow\n\n## Steps\n\n1. ...",
  "name": "Hotel Contract Review"
}
```

Response: a draft graph definition with nodes and edges extracted from the markdown. The user reviews and edits on the canvas before saving.

This endpoint powers both the file import feature and the chat designer backend.

---

## Chat Designer

```
POST /api/v1/workspaces/:workspace_id/graphs/design/chat
```

Conversational graph design. Each message builds on the previous conversation.

Request:
```json
{
  "session_id": "uuid",      -- omit to start a new session
  "message": "I need a workflow to review hotel purchase contracts...",
  "graph_id": "uuid"         -- optional: refine an existing graph
}
```

Response:
```json
{
  "data": {
    "session_id": "uuid",
    "reply": "Got it. I'm seeing 4 nodes...",
    "graph_delta": {
      "nodes": [ { "op": "add", "node": { ... } } ],
      "edges": [ { "op": "add", "edge": { ... } } ]
    },
    "questions": ["What contract types do you handle?"]
  }
}
```

The `graph_delta` is applied to the canvas in real time as the conversation progresses.

---

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

Files are stored per-run (not in the knowledge base) and are accessible to agents during execution via the `file.read` tool as Run Context. They are never treated as guidelines.

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
{
  "resolution": "approved"
}
```
or
```json
{
  "resolution": "edited",
  "output": { "irr": 0.12, "recommendation": "Proceed with conditions" }
}
```
or
```json
{
  "resolution": "guided",
  "guidance": "Check the depreciation schedule in Appendix B..."
}
```
or
```json
{
  "resolution": "aborted",
  "reason": "Contract withdrawn by counterparty"
}
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

---

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

## Tools

```
GET    /api/v1/workspaces/:workspace_id/tools
POST   /api/v1/workspaces/:workspace_id/tools
GET    /api/v1/workspaces/:workspace_id/tools/:tool_id
PATCH  /api/v1/workspaces/:workspace_id/tools/:tool_id
DELETE /api/v1/workspaces/:workspace_id/tools/:tool_id

POST   /api/v1/workspaces/:workspace_id/tools/:tool_id/test
       -- body: { input: { ... } }
       -- response: { output: { ... }, duration_ms: 42 }

GET    /api/v1/workspaces/:workspace_id/tools/:tool_id/versions
```

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
{ "event": "escalation.resolved","data": { "escalation_id": "...", "resolution": "approved" } }

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
