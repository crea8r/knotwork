# API Specification — Core Endpoints

## Overview

The Knotwork API is a REST API with WebSocket support for real-time events. All endpoints are under `/api/v1`.

Authentication uses JWT bearer tokens for both humans and agents. Agent
participants obtain JWTs via ed25519 challenge-response auth.

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
POST /api/v1/auth/magic-link-request
POST /api/v1/auth/magic-link-verify
POST /api/v1/auth/agent-challenge
POST /api/v1/auth/agent-token
GET  /api/v1/auth/me
PATCH /api/v1/auth/me
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

## Registered Agents

```
GET    /api/v1/workspaces/:workspace_id/agents
POST   /api/v1/workspaces/:workspace_id/agents
DELETE /api/v1/workspaces/:workspace_id/agents/:agent_id
```

> S8 expands this surface substantially (capability refresh, preflight runs, activation lifecycle,
> usage history, compatibility checks, debug links, avatar upload flow). See:
> [agents-settings-profile.md](/Users/hieu/Work/crea8r/knotwork/docs/sysdesign/interfaces/api/agents-settings-profile.md)

POST body:
```json
{
  "display_name": "My Legal Claude",
  "provider": "anthropic",
  "agent_ref": "anthropic:claude-sonnet-4-6",
  "api_key": "sk-ant-..."
}
```

Response includes `api_key_hint` (last 4 chars of stored key) instead of the raw key.

---

## Agent API (node execution session endpoints)

Used by external agents during a run. Not under `/api/v1` — scoped by session JWT.

```
POST /agent-api/log        -- write_worklog tool call
POST /agent-api/propose    -- propose_handbook_update tool call
POST /agent-api/escalate   -- escalate tool call
POST /agent-api/complete   -- complete_node tool call
```

Session JWT is scoped to a single run + node + workspace (2h TTL). Issued by the runtime and
passed to the adapter as `session_token`.

---

## Handbook Proposals

```
GET  /api/v1/workspaces/:workspace_id/handbook/proposals
POST /api/v1/workspaces/:workspace_id/handbook/proposals/:proposal_id/approve
POST /api/v1/workspaces/:workspace_id/handbook/proposals/:proposal_id/reject
```

---

## Projects (S10+)

```
GET    /api/v1/workspaces/:workspace_id/projects
POST   /api/v1/workspaces/:workspace_id/projects
GET    /api/v1/workspaces/:workspace_id/projects/:project_id
PATCH  /api/v1/workspaces/:workspace_id/projects/:project_id
DELETE /api/v1/workspaces/:workspace_id/projects/:project_id
```

POST/PATCH body:
```json
{
  "name": "Q2 Enterprise Onboarding",
  "objective": "Onboard 5 enterprise clients before June 30",
  "deadline": "2026-06-30",
  "status": "in_progress"
}
```

---

## Tasks (S10+)

```
GET    /api/v1/workspaces/:workspace_id/projects/:project_id/tasks
POST   /api/v1/workspaces/:workspace_id/projects/:project_id/tasks
GET    /api/v1/workspaces/:workspace_id/projects/:project_id/tasks/:task_id
PATCH  /api/v1/workspaces/:workspace_id/projects/:project_id/tasks/:task_id
DELETE /api/v1/workspaces/:workspace_id/projects/:project_id/tasks/:task_id
```

POST/PATCH body:
```json
{
  "name": "Review Acme contract",
  "description": "...",
  "status": "open",
  "graph_id": "uuid",     // optional: graph to trigger as a Run
  "run_input": { ... }    // optional: input for the run
}
```

Each task has an associated Channel (task chat). Runs triggered from a task appear as thread events in that channel.

---

## Project Documents (S10+)

Project-scoped knowledge store. Same StorageAdapter pattern as the Handbook, scoped to a Project.

```
GET    /api/v1/workspaces/:workspace_id/projects/:project_id/documents
POST   /api/v1/workspaces/:workspace_id/projects/:project_id/documents
GET    /api/v1/workspaces/:workspace_id/projects/:project_id/documents/:doc_id
PATCH  /api/v1/workspaces/:workspace_id/projects/:project_id/documents/:doc_id
DELETE /api/v1/workspaces/:workspace_id/projects/:project_id/documents/:doc_id
```

POST/PATCH body:
```json
{
  "title": "Project Brief",
  "content": "...",         // markdown
  "path": "brief.md"       // optional: storage path hint
}
```

---

## Workspace Representatives (S12+)

Designate WorkspaceMembers or RegisteredAgents as responsible for external interactions.
Knotwork routes escalations and notifications to representatives.

```
GET    /api/v1/workspaces/:workspace_id/representatives
POST   /api/v1/workspaces/:workspace_id/representatives
DELETE /api/v1/workspaces/:workspace_id/representatives/:representative_id
```

POST body (exactly one of `member_id` or `agent_id`):
```json
{
  "member_id": "uuid",   // WorkspaceMember
  "agent_id":  "uuid",   // RegisteredAgent
  "is_primary": true
}
```
