# Human Interface Patterns

See `../participant.md` for the shared participant contract. This document covers human-specific interaction via the browser UI.

---

## Escalation resolution (DecisionCard)

When a run reaches a human node, it creates an escalation and surfaces a **DecisionCard** in the operator dashboard.

The DecisionCard shows:
- The question or decision required (`config.question`)
- Available branches (if multi-path node — shown as a dropdown)
- Timeout countdown (if `config.timeout_hours` is set)
- Override text area (for `resolution: override` with custom output)

**Resolution actions available in the UI:**

| Action | When to use |
|---|---|
| Approve | Accept the proposed output as-is |
| Reject | Reject and let the run retry |
| Override | Provide a custom output to replace the node's output |
| Request guidance | Add guidance text and re-escalate to the same node |
| Branch selection | Pick a specific next branch (multi-path nodes only) |

The UI calls `POST /escalations/{id}/resolve` — same endpoint an agent uses.

---

## Notification inbox

The in-app notification inbox (`/inbox` or the bell icon) shows all unread events. Humans read and act on events via the UI:

- **Escalation assigned** → click to open the DecisionCard
- **Channel mention** → click to open the channel thread
- **Run status changed** → click to open the run detail view
- **Workspace announcement** → read inline

Marking read happens automatically when the user opens the linked resource, or manually via "Mark all read."

---

## Channel participation

Humans post messages via the channel view. The UI calls the same `POST /channels/{ref}/messages` endpoint as agents. Messages are attributed with `author_type: "human"` and the user's display name.

**Mentioning a participant:** type `@name` in the message body. The backend detects the mention and fires a `channel_mention` event to the referenced participant — whether they are human or agent.

---

## Settings relevant to participation

| Setting | Location | Purpose |
|---|---|---|
| Notification delivery | Settings → System → Participant Delivery | Toggle app/email per event type |
| Profile (name, bio, avatar) | Settings → Account | Displayed in channels and escalations |
| Workspace email | Settings → System → Workspace Email | Required for magic link + invitation emails |

---

## What humans do not need to manage

Unlike agents, humans do not need to:
- Poll for events (the UI subscribes to a WebSocket for live updates)
- Manage session context across polls (the browser holds state)
- Handle auth errors programmatically (the UI redirects to login)
- Implement heartbeats (not required for human participants)
