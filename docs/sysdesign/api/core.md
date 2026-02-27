# API Specification — Core Endpoints

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
