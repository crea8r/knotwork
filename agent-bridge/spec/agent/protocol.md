# Agent Bridge Protocol

## Behavioral contract

This document defines what a well-behaved agent does as a Knotwork participant. It is implementation-agnostic — the OpenClaw plugin, a custom HTTP agent, or a Claude Desktop MCP client all follow the same protocol.

---

## 1. Startup sequence

```
1. Load stored credentials (private key + last JWT)
2. If JWT is missing or near expiry (< 24h remaining): re-authenticate
3. Fetch workspace overview via MCP or GET /workspaces/{id}/members?kind=agent
4. Load skills.md (GET /api/v1/workspaces/{id}/skills) for behavioral context
5. Enter polling loop
```

---

## 2. Polling rhythm and task queue

Default poll interval: **30 seconds**.

```
LOOP:
  pending = GET /api/v1/workspaces/{id}/inbox?unread=true
  scored  = score_and_sort(pending)   # see ../priority.md
  task    = scored[0] if scored else None

  if task:
    handle(task)             # runs to completion — non-preemptive
    mark_read(task)
    continue                 # re-score immediately after completion, no sleep

  sleep(POLL_INTERVAL)
```

Tasks are **non-preemptive and dynamically re-scored** after every completion. The full queue is re-evaluated from scratch before picking the next task — a task that ranked 3rd thirty minutes ago may now rank 1st due to deadline pressure. See `../priority.md` for the complete scoring formula.

Minimum poll interval: 10 seconds. A single burst pass on startup is acceptable to catch up on a full inbox.

---

## 3. Session management

The agent maintains **one context per channel** it actively participates in.

```
ChannelSession:
  channel_id: str
  last_read_message_id: str | None
  last_loaded_handbook_checksum: str | None
  active: bool
```

**Session lifecycle:**

1. `create` — agent subscribes to a channel or is mentioned for the first time
2. `load` — fetch recent messages (last 20), load relevant handbook files
3. `active` — processing events for this channel
4. `idle` — no activity for > 1 hour; keep but don't reload context
5. `expire` — no activity for > 24 hours; discard context, re-create on next event

**Handbook reload**: compare `checksum` on the knowledge file index. Reload only files that changed. Do not reload on every poll.

---

## 4. Event handling

### `escalation_assigned`

Priority: **immediate** (handle within next poll cycle)

```
1. Read escalation details: GET /escalations/{id}
2. Load run context: GET /runs/{run_id} + GET /runs/{run_id}/nodes
3. Load channel context if source_channel_id is set
4. Load relevant handbook files (from run's knowledge_paths)
5. Make decision: resolve, request guidance, or escalate further
6. POST /escalations/{id}/resolve with resolution + guidance
```

If the agent cannot resolve (capability failure, missing context):
- Set `resolution: "escalate"` with `guidance` explaining why
- Do NOT loop — one attempt per escalation

### `channel_mention`

Priority: **high** (handle within 2 poll cycles)

```
1. Load channel session (or create if new)
2. Read thread context: GET /channels/{id}/messages (recent 20)
3. Formulate response
4. POST /channels/{id}/messages with role=assistant, author_type=agent
5. Update last_read_message_id
```

### `run_status_changed`

Priority: **informational** (batch, no reply required)

```
1. Update internal run state
2. If status=failed and agent was involved: log for review
3. No response required unless the agent was supervisor
```

### `channel_message` (non-mention)

Priority: **low** (catch-up, no response required unless relevant)

```
1. Update last_read_message_id
2. If message is relevant to pending work: factor into context
3. No proactive response — wait to be mentioned or assigned
```

### `workspace_announcement`

Priority: **informational**

```
1. Read announcement
2. If it changes agent's operating parameters (e.g. new handbook policy): reload skills.md
3. ACK delivery
```

---

## 5. State the agent tracks

```python
AgentState:
  # Auth
  jwt_token: str
  jwt_expires_at: datetime

  # Per-channel sessions
  channel_sessions: dict[str, ChannelSession]

  # Pending work
  active_escalation_ids: set[str]
  unread_mention_ids: set[str]

  # Watermarks
  inbox_last_checked: datetime
  skills_checksum: str
```

Persist state across restarts. Use a local file, SQLite, or the agent runtime's storage API.

---

## 6. Error recovery

| Condition | Recovery |
|---|---|
| 401 on any API call | Re-authenticate immediately (steps in auth.md) |
| 404 on escalation/channel | Skip — resource was deleted, ACK and move on |
| 5xx from Knotwork | Backoff: 30s → 60s → 120s → 300s. Log. Alert supervisor after 3 consecutive failures. |
| Signature verification error at startup | Fatal — private key mismatch. Stop and alert operator. |
| Agent cannot resolve escalation | Escalate with `resolution="escalate"` + detailed guidance. Never loop. |
| Poll interval drift | Acceptable. Don't compensate aggressively. |

---

## 7. Liveness / heartbeat

Every 5 minutes, post a heartbeat:
```
PATCH /api/v1/workspaces/{id}/members/{member_id}
{"agent_config": {"last_heartbeat": "<ISO8601>", "status": "active"}}
```

This is informational — Knotwork does not enforce it. Operators can see stale heartbeats in the Members view.
