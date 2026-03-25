# Session 9.2 — Participant-Specific Event Delivery

## Goal

Give runs and chat contexts a stable participant model, then route events to specific participants through their registered communication means instead of treating notifications as workspace-wide broadcast. In S9.2, the key shift is not "more notification channels"; it is moving from workspace-level alerting to participant-specific delivery.

See also: `docs/implementation/S9.2/gameplan.md` for the execution plan, milestones, component-by-component breakdown, and testing plan.

## Context

In S9, run execution is effectively a one-way flow: an agent escalates and any workspace member can respond. The current implementation has no explicit participant model behind run events and inbox items, and notification settings are effectively workspace-wide rather than participant-specific. OpenClaw plugin delivery already exists for agent task execution, but it is treated as a separate path rather than one communication mean among others. S9.2 should unify routing semantics without redesigning the plugin transport itself.

---

## Part A — Participant Model

### Participant identity

- Workspace members and registered agents are both first-class participants.
- Each participant has a stable `participant_id`.
- Participant identity is the routing primitive; "human" vs "agent" is descriptive metadata, not a separate delivery model.
- Participant list is visible in run detail.

### Addressing semantics

- Agents and system events can target a specific participant explicitly (`to: participant_id`).
- Un-addressed escalations fall through to any available workspace member (current behavior preserved as default).
- Addressed escalations appear in the targeted participant's inbox/notification, not globally.

### Chat events and inbox

- Events belong to a chat context such as a run, workflow channel, or agent main channel.
- Event delivery is participant-specific.
- Targeted requests are visible in the run timeline with participant attribution.
- Targeted participant sees a dedicated inbox entry, not a generic escalation.
- Replies are attributed to the exact participant and fed back into execution context.

### Execution context integration

- Human or agent reply is injected into the agent's next prompt as attributed input.
- Attribution is preserved in node input/output logs.

---

## Part B — Communication Means and Event Delivery

### Channel registration and validation

Communication means are registered per participant, per event type. S9.2 supports three means:

- **App** — always available in the Knotwork UI; default fallback
- **Email** — optional participant-bound delivery
- **OpenClaw plugin** — optional participant-bound delivery for registered agents

The OpenClaw plugin is treated as a communication mean for routing purposes in S9.2. Its existing transport and task protocol remain unchanged in this session.

### Event types

Every delivered item is a chat event. Typical event types include:

- `escalation_created`
- `task_assigned`
- `mentioned_message`
- `run_failed`
- `run_completed`

Not every communication mean must register for every event type. This avoids treating the plugin as a special-case architecture while still allowing it to opt into only the event types it can handle.

**Email**
- Already registered via magic-link auth; email address is known.
- Requires deliverability verification: on first notification setup, send a test email and prompt user to confirm receipt in the app.
- Re-verify if email address changes.

**OpenClaw plugin**
- Already paired to a registered agent through the current OpenClaw integration flow.
- Receives only the event types the participant has registered the plugin for.
- Is reclassified as one delivery mean in the participant routing model, but its handshake/task execution behavior is not redesigned in S9.2.

### Permission testing

Channel registration is not complete until the user confirms receipt of a test message. This is more than config validation — it verifies:
- Credentials are correct
- The message was actually delivered
- The deep link or app routing path behaves correctly for that communication mean

Each registered channel shows: last test result, last test date, and a "Send test" button available at any time. A channel with a failed or never-tested status shows a warning in Settings and in the notification preference selector.

### Participant event preferences

Participants register communication means per event type, not per run. Example:

- a human participant enables `app` and `email` for `mentioned_message`
- an agent participant enables `openclaw_plugin` for `task_assigned`
- a participant disables all non-app delivery for `run_completed`

### What triggers delivery

Events are delivered when they require participant attention:
- Escalation created and addressed to a specific participant
- Escalation created un-addressed (sent to all workspace members with escalation permission)
- Task assigned to an agent participant
- Mentioned message in a chat context
- Run completed (opt-in per workflow)
- Run failed

### Deep links — localhost vs deployed

Every delivered event includes enough context for the participant to act immediately. For app and email, this includes a deep link to the specific run or chat context.

**Deployed installs:** link base is the server's public URL. Always works from any device.

**Localhost installs:** `http://localhost:PORT` links work from the same machine but may be unreachable from elsewhere.

Behavior:
- Backend reads `PUBLIC_BASE_URL` env var to construct all notification links.
- If `PUBLIC_BASE_URL` is unset on a localhost install, the system warns in Settings → Notifications: "Links in notifications will only work from this machine. Set `PUBLIC_BASE_URL` to a reachable address to fix this."
- The warning is also shown inline when registering email delivery on a localhost install.
- Notification messages still send even without `PUBLIC_BASE_URL`; they include the full context (run name, escalation question) so the user knows what they are returning to — the link is just not clickable from mobile.

### Event content

Each delivered event must carry enough context that the participant understands the situation before opening the app:
- Run name and workflow name
- Which node escalated (if applicable)
- The event-specific question, task, or summary
- Who asked / who is addressed
- The deep link with the relevant event highlighted where applicable

---

## Out of Scope

- External clients and run-scoped guest access
- Telegram delivery
- WhatsApp delivery
- Push notifications (browser or mobile app) — Phase 2.
- Slack integration — representatives use Slack via their own tools; Knotwork does not manage Slack.
- Notification scheduling or digest mode — Phase 2.
- Channel permission scoping — Phase 2.
- Plugin/MCP separation of concerns — deferred to S12.

---

## Acceptance Criteria

1. Agent can explicitly address a workspace human or workspace agent when escalating.
2. Addressed escalation appears in the targeted participant's inbox, not as a global run escalation.
3. Participant replies are attributed in the run timeline and fed back into the agent's execution context.
4. Un-addressed escalations continue to work as before (any workspace member can respond).
5. Participant list is visible in run detail.
6. Event delivery is participant-specific rather than workspace-wide.
7. Participants can register communication means per event type.
8. Supported communication means in S9.2 are app, email, and OpenClaw plugin.
9. Email delivery can be verified end-to-end via a test message with user confirmation.
10. OpenClaw plugin can be selected as a participant communication mean for supported event types without redesigning the current plugin protocol.
11. Delivery fires for addressed escalation, un-addressed escalation, task assignment to plugin-backed agents, run failed, and run completed when enabled.
12. Delivered event content includes run name, workflow name, event-specific summary, participant attribution, and deep link where applicable.
13. Deep links route to the correct run or chat context with the relevant event highlighted.
14. On localhost installs without `PUBLIC_BASE_URL` set, Settings shows a clear warning that external links may only work from the current machine.
15. Telegram, WhatsApp, external client access, and plugin/MCP separation are explicitly deferred beyond S9.2.

---

## Implementation Shape

S9.2 should be built as a routing-and-identity phase, not a transport redesign. The implementation should preserve the current OpenClaw plugin behavior while reclassifying plugin delivery as one participant-bound communication mean.

### Recommended architecture

- **Participant identity layer** — stable `participant_id` for workspace members and registered agents
- **Event layer** — deliverable chat/run events such as `escalation_created`, `task_assigned`, `run_failed`, `run_completed`
- **Recipient resolution layer** — resolves explicit target participants or fallback broadcast rules
- **Delivery layer** — app inbox, email, OpenClaw plugin
- **Delivery attempt logging** — records delivery status separately from the business event itself

### Build constraints

- Do not redesign plugin handshake, task protocol, or transport in S9.2.
- Do not introduce external clients or run-scoped guest auth.
- Do not make Telegram or WhatsApp block the phase.
- Do not infer delivery preferences solely from participant type; store them explicitly.
- Keep un-addressed escalation fallback behavior intact for backward compatibility.

### Recommended milestone order

1. Lock schema and API shape for participants, preferences, recipients, and delivery attempts.
2. Build participant resolution and participant-specific inbox filtering.
3. Add explicit recipient support for addressed escalations.
4. Add participant communication preferences and delivery routing for app/email/plugin.
5. Extend routing beyond escalations to selected system events (`task_assigned`, `run_failed`, `run_completed`).
6. Harden fallback rules, delivery observability, and `PUBLIC_BASE_URL` warning behavior.
