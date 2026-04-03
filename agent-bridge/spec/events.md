# Notification Contract — Event Types

## Delivery semantics

- **At-least-once**: Knotwork may deliver the same event more than once. Agents must deduplicate by `event_id`.
- **ACK required** for actionable events (`escalation_assigned`, `channel_mention`): mark inbox delivery as read after handling.
- **Best-effort** for informational events: read on next poll, no explicit ACK needed.
- **Ordering**: events within a channel are ordered by `created_at`. Cross-channel ordering is not guaranteed.

## ACK pattern

```
PATCH /api/v1/workspaces/{id}/inbox/deliveries/{delivery_id}
{"read": true}
```

Or bulk-ACK all:
```
POST /api/v1/workspaces/{id}/inbox/read-all
```

---

## Event types

### `escalation_assigned`

Fired when an escalation is created with `assigned_to` containing this agent's participant ID.

```json
{
  "event_type": "escalation_assigned",
  "event_id": "<uuid>",
  "payload": {
    "escalation_id": "<uuid>",
    "run_id": "<uuid>",
    "node_id": "<str>",
    "channel_id": "<uuid | null>",
    "question": "<str | null>",
    "context_summary": "<str | null>"
  }
}
```

**ACK**: required. Mark read after resolution attempt.

---

### `channel_mention`

Fired when a message is posted to a channel this agent is subscribed to, and the message content contains `@<agent-name>` or `@<agent-member-id>`.

```json
{
  "event_type": "channel_mention",
  "event_id": "<uuid>",
  "payload": {
    "channel_id": "<uuid>",
    "message_id": "<uuid>",
    "author_name": "<str>",
    "content_preview": "<first 200 chars>"
  }
}
```

**ACK**: required.

---

### `run_status_changed`

Fired when a run transitions to a new status and this agent is a participant (supervisor or assigned node executor).

```json
{
  "event_type": "run_status_changed",
  "event_id": "<uuid>",
  "payload": {
    "run_id": "<uuid>",
    "old_status": "<str>",
    "new_status": "<str>",
    "graph_name": "<str>"
  }
}
```

Terminal statuses: `completed`, `failed`, `stopped`.

**ACK**: best-effort.

---

### `channel_message`

Fired for every new message in a channel this agent is subscribed to (regardless of mention).

```json
{
  "event_type": "channel_message",
  "event_id": "<uuid>",
  "payload": {
    "channel_id": "<uuid>",
    "message_id": "<uuid>",
    "author_name": "<str>",
    "role": "user | assistant | system"
  }
}
```

**ACK**: best-effort. Update `last_read_message_id` watermark.

---

### `workspace_announcement`

Fired when a message is posted to a bulletin channel (channel_type=bulletin).

```json
{
  "event_type": "workspace_announcement",
  "event_id": "<uuid>",
  "payload": {
    "channel_id": "<uuid>",
    "message_id": "<uuid>",
    "content_preview": "<first 500 chars>"
  }
}
```

**ACK**: best-effort.

---

## Fetching full event context

Events in the inbox contain minimal payloads. Always fetch full context before acting:

| Event | Full context endpoint |
|---|---|
| `escalation_assigned` | `GET /api/v1/workspaces/{id}/escalations/{escalation_id}` |
| `channel_mention` | `GET /api/v1/workspaces/{id}/channels/{channel_id}/messages` |
| `run_status_changed` | `GET /api/v1/workspaces/{id}/runs/{run_id}` |
| `channel_message` | `GET /api/v1/workspaces/{id}/channels/{channel_id}/messages?after={last_read_id}` |
