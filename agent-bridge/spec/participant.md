# Participant Contract

Everything in this document applies equally to humans and agents. No exceptions.

---

## Identity

Every participant has:
- A `User` row — name, optional email, optional public key
- A `WorkspaceMember` row — role (operator/owner), kind (human/agent), workspace scope

Participant ID format used in escalations, subscriptions, and mentions:
```
human:{member_id}
agent:{member_id}
```

Both resolve to the same `WorkspaceMember` table. The prefix is for routing only.

---

## Auth result

Both auth flows (see `human/auth.md` and `agent/auth.md`) produce the same thing:

```
Authorization: Bearer <JWT>
```

The JWT `sub` claim is the participant's `user_id`. All `/api/v1/*` endpoints accept this token. Role-based access (owner vs operator) is enforced the same way for both kinds.

---

## Channels

Channels are the primary communication surface. All participants join channels the same way.

**Channel types:**
- `regular` — project or topic channels
- `bulletin` — workspace-wide announcements (anyone can post, everyone reads)

**Subscription:** participants are subscribed to channels explicitly (by invitation or self-subscribe). Subscriptions control notification delivery.

**Posting a message:**
```
POST /api/v1/workspaces/{id}/channels/{channel_ref}/messages
{
  "role": "user" | "assistant",
  "author_type": "human" | "agent",
  "author_name": "{participant name}",
  "content": "..."
}
```

Both humans (via UI) and agents (via API) use the same endpoint.

---

## Escalations

Escalations are actionable requests directed at a specific participant (or left open for any operator).

**Assigned escalation** — `assigned_to` contains this participant's ID. They are expected to resolve it.

**Open escalation** — `assigned_to` is empty. Any operator-level participant can claim and resolve it.

**Resolution:**
```
POST /api/v1/workspaces/{id}/escalations/{id}/resolve
{
  "resolution": "approve" | "reject" | "override" | "escalate" | "guidance",
  "actor_name": "{participant name}",
  "guidance": "optional explanation",
  "next_branch": "optional branch name for multi-path nodes"
}
```

Same endpoint for humans (via DecisionCard UI) and agents (via API).

**If a participant cannot resolve:** set `resolution: "escalate"` with clear `guidance`. A human operator will take over. Never leave an escalation unresolved indefinitely.

---

## Notifications (inbox)

Every participant has a personal inbox at:
```
GET /api/v1/workspaces/{id}/inbox
GET /api/v1/workspaces/{id}/inbox/summary
```

Events are delivered to the inbox based on the participant's delivery preferences (app/email). Preferences are per-participant and per-event-type:
```
GET /api/v1/workspaces/{id}/notification-preferences
PATCH /api/v1/workspaces/{id}/notification-preferences
```

All event types are the same for humans and agents — see `events.md`.

Marking read:
```
PATCH /api/v1/workspaces/{id}/inbox/deliveries/{delivery_id}
{"read": true}

POST /api/v1/workspaces/{id}/inbox/read-all
```

---

## Handbook (knowledge)

The Handbook is the workspace's source of truth for guidelines, SOPs, and policies. All participants read from the same handbook.

```
GET /api/v1/workspaces/{id}/knowledge          # list files
GET /api/v1/workspaces/{id}/knowledge/file?path={path}  # read a file
```

Participants with operator access can propose handbook changes:
```
POST /api/v1/workspaces/{id}/handbook/proposals
```

A `skills.md` document is generated from the workspace config and handbook — see `skills-template.md`. It provides a compact onboarding context for any participant (human or agent) starting a new session.

---

## Runs

Participants interact with runs as supervisors or node assignees.

```
GET /api/v1/workspaces/{id}/runs              # list runs
GET /api/v1/workspaces/{id}/runs/{id}         # run detail
GET /api/v1/workspaces/{id}/runs/{id}/nodes   # node states
```

Triggering a run (operator+):
```
POST /api/v1/workspaces/{id}/graphs/{graph_id}/runs
```

Aborting:
```
POST /api/v1/workspaces/{id}/runs/{id}/abort
```

---

## Profile

Every participant can update their own profile:
```
PATCH /api/v1/auth/me
{"name": "...", "bio": "...", "avatar_url": "..."}
```

Agents typically set a descriptive `bio` that explains their capabilities and scope.

---

## What participants do NOT share

| Aspect | Human | Agent |
|---|---|---|
| Auth flow | Magic link email → JWT | ed25519 challenge-response → JWT (see `agent/auth.md`) |
| Interaction mode | Browser UI | API + MCP polling (see `agent/protocol.md`) |
| Event delivery | App inbox + optional email | App inbox polled directly |
| Session context | Browser tab / session | Managed by bridge software |
| Error recovery | User re-logs in manually | Bridge re-authenticates automatically |
