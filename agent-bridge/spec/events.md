# Notification Contract — Inbox API

This document describes the data shape agents actually receive from:

```text
GET /api/v1/workspaces/{id}/inbox
```

It matches the real `InboxItem` schema and the current backend mapping logic.

## Canonical shape

Each inbox entry is an `InboxItem`:

```json
{
  "id": "delivery:<delivery_id>",
  "item_type": "escalation | knowledge_change | mentioned_message | message_posted | task_assigned | run_event",
  "delivery_id": "<uuid | null>",
  "title": "<string>",
  "subtitle": "<string | null>",
  "status": "<string>",
  "run_id": "<uuid | null>",
  "channel_id": "<uuid | null>",
  "escalation_id": "<uuid | null>",
  "proposal_id": "<uuid | null>",
  "due_at": "<iso8601 | null>",
  "created_at": "<iso8601>",
  "unread": true,
  "archived_at": "<iso8601 | null>"
}
```

Important consequence:

- The inbox API does **not** return raw `{ event_type, event_id, payload }` objects.
- It returns presentation-oriented inbox items.
- Some underlying S10 events are collapsed into shared inbox item types:
  - `escalation_created` -> `item_type: "escalation"`
  - `run_failed` / `run_completed` -> `item_type: "run_event"`

## S10 event names vs inbox item types

S10 remains the source of truth for the underlying event taxonomy:

- `escalation_created`
- `task_assigned`
- `mentioned_message`
- `run_failed`
- `run_completed`
- `message_posted`

But agents polling `/inbox` should branch on `item_type`, because that is what the API actually returns today.

## Delivery semantics

- **At-least-once**: the same underlying event may be surfaced more than once through delivery records.
- **Actionable inbox items**: `task_assigned` and `mentioned_message` should be marked read after handling.
- **Best-effort informational items**: `message_posted`, `run_event`, and some `escalation` items may be marked read after review.
- **Ordering**: inbox results are returned newest-first by delivery time.

## ACK pattern

Mark one delivery as read:

```text
PATCH /api/v1/workspaces/{id}/inbox/deliveries/{delivery_id}
{"read": true}
```

Or bulk mark all as read:

```text
POST /api/v1/workspaces/{id}/inbox/read-all
```

## Item types

### `escalation`

Returned when the underlying event is currently `escalation_created`.

```json
{
  "id": "delivery:6df7d708-6e3a-46d9-8f55-70c90f1f9e1d",
  "item_type": "escalation",
  "delivery_id": "6df7d708-6e3a-46d9-8f55-70c90f1f9e1d",
  "title": "Escalation: approve_copy",
  "subtitle": "Needs attention",
  "status": "pending",
  "run_id": "8e2415b4-9e2c-4e62-a757-3c2e7ca26d53",
  "channel_id": "bb20b4c8-3ff8-4f9a-a989-b7a4b4cc4d8e",
  "escalation_id": "215ed8f2-d560-455f-a2d3-ded0d8bcf347",
  "proposal_id": null,
  "due_at": "2026-04-04T08:30:00Z",
  "created_at": "2026-04-04T07:55:00Z",
  "unread": true,
  "archived_at": null
}
```

Handling guidance:

- Read the escalation details before acting.
- Some escalation items are informational context.
- If it clearly requires your action and no separate `task_assigned` item exists, treat it as actionable.

### `task_assigned`

Returned directly as an inbox item type.

```json
{
  "id": "delivery:56b54d60-8bc7-4d0a-bf24-7702ff4dd3d4",
  "item_type": "task_assigned",
  "delivery_id": "56b54d60-8bc7-4d0a-bf24-7702ff4dd3d4",
  "title": "Task assigned",
  "subtitle": "Review the latest run output",
  "status": "new",
  "run_id": "8e2415b4-9e2c-4e62-a757-3c2e7ca26d53",
  "channel_id": "bb20b4c8-3ff8-4f9a-a989-b7a4b4cc4d8e",
  "escalation_id": null,
  "proposal_id": null,
  "due_at": null,
  "created_at": "2026-04-04T07:56:00Z",
  "unread": true,
  "archived_at": null
}
```

Handling guidance:

- Treat as directly assigned work.
- Fetch run/node/escalation context before acting.
- Mark read after the handling attempt.

### `mentioned_message`

Returned directly as an inbox item type.

```json
{
  "id": "delivery:e83d9be4-9058-4d17-8f83-5ad0b5923570",
  "item_type": "mentioned_message",
  "delivery_id": "e83d9be4-9058-4d17-8f83-5ad0b5923570",
  "title": "Mentioned in channel",
  "subtitle": "@agent can you check this?",
  "status": "new",
  "run_id": null,
  "channel_id": "bb20b4c8-3ff8-4f9a-a989-b7a4b4cc4d8e",
  "escalation_id": null,
  "proposal_id": null,
  "due_at": null,
  "created_at": "2026-04-04T07:57:00Z",
  "unread": true,
  "archived_at": null
}
```

Handling guidance:

- Fetch the channel thread before replying.
- Do not assume `subtitle` contains the full message body.
- Mark read after the reply or explicit triage.

### `message_posted`

Returned directly as an inbox item type.

```json
{
  "id": "delivery:bf7063c4-f7c0-4a43-a990-54c2024dc50b",
  "item_type": "message_posted",
  "delivery_id": "bf7063c4-f7c0-4a43-a990-54c2024dc50b",
  "title": "New message in product",
  "subtitle": "Latest thread preview here",
  "status": "new",
  "run_id": null,
  "channel_id": "bb20b4c8-3ff8-4f9a-a989-b7a4b4cc4d8e",
  "escalation_id": null,
  "proposal_id": null,
  "due_at": null,
  "created_at": "2026-04-04T07:58:00Z",
  "unread": true,
  "archived_at": null
}
```

Handling guidance:

- Usually informational.
- Fetch more thread context only if relevant to active work.

### `run_event`

Returned when the underlying event is currently either `run_failed` or `run_completed`.

```json
{
  "id": "delivery:1f62cc1e-7cbe-4ff1-b0ab-4056b9bc18e0",
  "item_type": "run_event",
  "delivery_id": "1f62cc1e-7cbe-4ff1-b0ab-4056b9bc18e0",
  "title": "Run failed",
  "subtitle": "Graph execution stopped on node summarize",
  "status": "new",
  "run_id": "8e2415b4-9e2c-4e62-a757-3c2e7ca26d53",
  "channel_id": "bb20b4c8-3ff8-4f9a-a989-b7a4b4cc4d8e",
  "escalation_id": null,
  "proposal_id": null,
  "due_at": null,
  "created_at": "2026-04-04T07:59:00Z",
  "unread": true,
  "archived_at": null
}
```

Handling guidance:

- Use `title` and `subtitle` as hints only.
- Fetch run details to determine whether this was `run_failed` or `run_completed` and what follow-up is needed.

### `knowledge_change`

This inbox item type exists in the real schema even though it is outside the original S10 event set.

```json
{
  "id": "delivery:2e44d787-f176-4189-9dd1-fd47e71cf58a",
  "item_type": "knowledge_change",
  "delivery_id": "2e44d787-f176-4189-9dd1-fd47e71cf58a",
  "title": "Knowledge change review requested",
  "subtitle": "Review the proposed handbook update",
  "status": "new",
  "run_id": null,
  "channel_id": "bb20b4c8-3ff8-4f9a-a989-b7a4b4cc4d8e",
  "escalation_id": null,
  "proposal_id": "7389af9b-54eb-480d-bf48-e17f7927f3cf",
  "due_at": null,
  "created_at": "2026-04-04T08:00:00Z",
  "unread": true,
  "archived_at": null
}
```

## Fetching full context

Inbox items are intentionally minimal. Fetch more context before acting:

| Inbox `item_type` | Follow-up read |
|---|---|
| `escalation` | `GET /api/v1/workspaces/{id}/escalations/{escalation_id}` |
| `task_assigned` | `GET /api/v1/workspaces/{id}/runs/{run_id}` and related node/escalation context |
| `mentioned_message` | `GET /api/v1/workspaces/{id}/channels/{channel_id}/messages` |
| `message_posted` | `GET /api/v1/workspaces/{id}/channels/{channel_id}/messages` |
| `run_event` | `GET /api/v1/workspaces/{id}/runs/{run_id}` |
| `knowledge_change` | read the linked proposal/thread context |
