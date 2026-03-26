# Session 10 — Multiple Mode

## Goal

Define a channel-first model for Knotwork where assets publish events into channels, participants subscribe to channels, and notifications are derived from channel events plus subscriber communication means. In S10, the key shift is not "more notification channels"; it is moving from workspace-wide alerting to participant-specific delivery rooted in channel subscriptions.

See also: `docs/implementation/S10/gameplan.md` for the execution plan, milestones, concrete component breakdown, and data-model notes.

Implementation decision: S10 uses a Knotwork-native minimal event/subscription implementation. External OSS may be evaluated later for delivery adapters, but it is not a dependency for S10 core behavior.

## Context

Knotwork already revolves around channels:

- workflow chat is channel-backed
- run chat is channel-backed
- handbook chat is channel-backed
- agent main chat is channel-backed
- project chat is planned as channel-backed in S11

What is missing is a consistent model for:

- who subscribes to channels
- how channel events are published
- how those events turn into participant-specific notifications

Today, inbox behavior is effectively workspace-wide in important places, and notification settings are also effectively workspace-wide. OpenClaw plugin delivery already exists for agent task execution, but it is treated as a separate path instead of one communication mean among others. S10 should unify routing semantics without redesigning the plugin transport itself.

---

## Core Model

### Channel

The durable collaboration container.

### Asset

A domain object attached to a channel. In Knotwork this includes workflows, runs/tasks, handbook, and later projects/files/version streams.

### Participant

A human or agent identity that can subscribe, be addressed, and receive notifications.

### Event

A typed occurrence published into a channel by an asset, participant, or system.

### Delivery

A notification derived from a channel event for a subscriber through one or more communication means.

---

## Minimal Cut for S10

S10 does not try to fully generalize channels, assets, and automation across the whole product. It implements the smallest coherent slice:

- participant system for humans and agents
- participant subscriptions to channel-backed contexts already in scope
- asset/event publishing from existing run/escalation/task flows
- participant-specific delivery through app, email, and existing OpenClaw plugin behavior
- mentioned-message delivery

Deferred beyond S10:

- generic reactive asset subscriptions
- external clients / guest participants
- Telegram / WhatsApp
- plugin/MCP separation

---

## Part A — Participant System

### Participant identity

- Workspace members and registered agents are both first-class participants.
- Each participant has a stable `participant_id`.
- "human" vs "agent" is descriptive metadata, not a separate routing model.
- Participants can subscribe and unsubscribe to channels.

### Communication means

Communication means belong to participants:

- **App** — required/default for human participants
- **OpenClaw plugin** — required/default for agent participants; already exists today
- **Email** — optional for either participant kind

S10 should not redesign plugin handshake, task protocol, or transport. The plugin is already there; S10 only reclassifies it as one communication mean in the participant model.

### Addressing and mention semantics

- Agents and system events can target a specific participant explicitly (`to: participant_id`).
- Participants can mention other participants in channel-backed chat contexts.
- A mention is one event type (`mentioned_message`), not the whole participation model.
- Un-addressed escalations fall through to any available workspace member as today.

### Attribution

- Targeted requests are visible in the relevant run/channel timeline with participant attribution.
- Replies are attributed to the exact participant.
- Attributed replies are fed back into execution context where relevant.

---

## Part B — Notification System

### Event publishing

Channels publish typed events. Typical S10 event sources:

- run/escalation flow
- task assignment flow
- participant-authored channel messages
- system state changes such as run failure or completion

Typical event types in S10:

- `escalation_created`
- `task_assigned`
- `mentioned_message`
- `run_failed`
- `run_completed`
- `message_posted`

### Subscriptions

- Participants subscribe to channels.
- Notifications are derived from channel events plus subscriber preferences.
- Subscription is distinct from delivery preference.

### Delivery preferences

Communication means are selected per participant, per event type. Not every communication mean must be enabled for every event type.

Examples:

- a human participant enables `app` and `email` for `mentioned_message`
- an agent participant enables `openclaw_plugin` for `task_assigned`
- a participant disables all non-app delivery for `run_completed`

### Email

- Workspace mail configuration is edited by the owner in Settings.
- Workspace members already have email identities through the invitation/auth system.
- Email delivery is allowed whenever workspace mail configuration exists.
- Email sending is not blocked by localhost mode; localhost mode only affects link reachability.

### OpenClaw plugin

- Already paired to a registered agent through the current OpenClaw integration flow.
- Receives only the event types the participant has registered the plugin for.
- Is treated as one delivery mean in the participant routing model, but its existing transport behavior is preserved.

### Deep links

Every delivered event includes enough context for the participant to act immediately. For app and email, this includes a deep link to the specific run or chat context.

Behavior:

- Backend reads `PUBLIC_BASE_URL` to construct links.
- If `PUBLIC_BASE_URL` is unset on a localhost install, the system warns that links may only work from the current machine.
- Notification messages still send even without `PUBLIC_BASE_URL`; the warning affects link quality, not whether email can be sent.

### Event content

Each delivered event must carry enough context that the participant understands the situation before opening the app:

- run name and workflow name where applicable
- which node or surface produced the event
- the event-specific question, task, or summary
- who acted / who is addressed
- deep link where applicable

---

## Out of Scope

- generic asset subscriptions/reactive automation
- external clients and run-scoped guest access
- Telegram delivery
- WhatsApp delivery
- push notifications (browser or mobile app)
- Slack integration
- notification scheduling or digest mode
- channel permission scoping
- plugin/MCP separation of concerns
- mandatory adoption of an external OSS notification platform

---

## Acceptance Criteria

1. Workspace members and registered agents are resolved as first-class participants with stable participant identity.
2. Participants can subscribe and unsubscribe to supported channel-backed contexts in scope for S10.
3. Agent can explicitly address a workspace human or workspace agent when escalating.
4. Addressed escalation appears in the targeted participant's inbox, not as a global run escalation.
5. Mentioned-message delivery works as a channel event when enabled by subscriber preferences.
6. Participant replies are attributed in the run timeline and fed back into the agent's execution context.
7. Un-addressed escalations continue to work as before.
8. Event delivery is participant-specific rather than workspace-wide.
9. Supported communication means in S10 are app, email, and OpenClaw plugin.
10. Email delivery works whenever workspace email configuration exists, regardless of localhost mode.
11. OpenClaw plugin can be selected as a participant communication mean for supported event types without redesigning the current plugin protocol.
12. Delivery fires for addressed escalation, un-addressed escalation, task assignment to plugin-backed agents, run failed, run completed, and mentioned messages when enabled.
13. Delivered event content includes event-specific summary, participant attribution, and deep link where applicable.
14. On localhost installs without `PUBLIC_BASE_URL` set, Settings shows a clear warning that external links may only work from the current machine, but delivery still occurs.
15. Generic reactive assets, Telegram, WhatsApp, external client access, and plugin/MCP separation are explicitly deferred beyond S10.

---

## Implementation Shape

S10 should be built as a minimal channel-first routing phase, not a transport redesign and not a full generalized event platform.

### Recommended architecture

- **Channel layer** — existing Knotwork channels remain the collaboration spine
- **Asset layer** — existing assets publish events into their attached/canonical channels
- **Participant layer** — stable participant identity for workspace members and registered agents
- **Subscription layer** — participant subscriptions to channels
- **Event layer** — typed channel events
- **Delivery layer** — app inbox, email, OpenClaw plugin
- **Delivery logging** — per event, per participant, per communication mean

### Build constraints

- Do not redesign plugin handshake, task protocol, or transport in S10.
- Do not introduce a fully generic `assets can subscribe and react` framework in S10.
- Do not introduce external clients or run-scoped guest auth.
- Do not make Telegram or WhatsApp block the phase.
- Do not require an external OSS notification stack to deliver S10.
- Build the core event/subscription model in-house.
- Keep un-addressed escalation fallback behavior intact for backward compatibility.

### Recommended milestone order

1. Lock schema and API shape for participants, channel subscriptions, event records, preferences, recipients, and deliveries.
2. Build participant resolution and participant-specific inbox filtering.
3. Add participant subscription support for in-scope channel-backed contexts.
4. Add explicit recipient support for addressed escalations and mentioned messages.
5. Add participant communication preferences and delivery routing for app/email/plugin.
6. Extend routing beyond escalations to selected system events and harden fallback/link behavior.
