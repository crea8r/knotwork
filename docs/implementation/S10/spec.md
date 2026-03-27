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

Today, inbox behavior is effectively workspace-wide in important places, and notification settings are also effectively workspace-wide. OpenClaw plugin delivery already exists for agent task execution, but S10 should not try to fold that path into the participant delivery model yet. S10 should unify routing semantics for human-facing app/email delivery without redesigning plugin transport or locking in the pre-MCP split too early.

---

## Core Model

### Channel

The durable collaboration container.

S10 includes both system-created channels and user-created free chat channels.

### Asset

A domain object attached to a channel. In Knotwork this includes workflows, runs/tasks, handbook, and later projects/files/version streams.

Minimal S10 asset attachment support is manual and limited to `workflow`, `run`, and `file`.

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
- free chat channel creation
- participant subscriptions to channel-backed contexts already in scope
- manual asset attachment for `workflow`, `run`, and `file`
- asset/event publishing from existing run/escalation/task flows
- participant-specific delivery through app and email
- mentioned-message delivery

Deferred beyond S10:

- generic reactive asset subscriptions
- external clients / guest participants
- Telegram / WhatsApp
- agent-targeted plugin delivery as a participant communication mean
- agent subscription management beyond current human self-service
- workflow/UX for selecting exact participant escalation targets
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
- **Email** — optional for either participant kind

### Addressing and mention semantics

- Participants can mention other participants in channel-backed chat contexts.
- A mention is one event type (`mentioned_message`), not the whole participation model.
- Un-addressed escalations fall through to any available workspace member as today.
- Exact participant-targeted escalation selection is deferred to S11 alongside the broader task/work container design.

### Attribution

- Requests and replies remain visible in the relevant run/channel timeline with human attribution.
- Attributed replies are fed back into execution context where relevant.

---

## Part B — Notification System

### Event publishing

Channels publish typed events. Typical S10 event sources:

- run/escalation flow
- task assignment flow
- workflow draft/version changes
- workflow-created runs
- file modification
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
- a participant disables `email` for `run_completed`

### Email

- Workspace mail configuration is edited by the owner in Settings.
- Workspace members already have email identities through the invitation/auth system.
- Email delivery is allowed whenever workspace mail configuration exists.
- Email sending is not blocked by localhost mode; localhost mode only affects link reachability.

### Deep links

Every delivered event includes enough context for the participant to act immediately. For app and email, this includes a deep link to the specific run or chat context.

Behavior:

- Backend reads `frontend_url` to construct links.
- If `frontend_url` points at localhost, Settings may warn that links may only work from the current machine.
- Notification messages still send even when links are localhost-scoped; the warning affects link quality, not whether email can be sent.

### Event content

Each delivered event must carry enough context that the participant understands the situation before opening the app:

- run name and workflow name where applicable
- which node or surface produced the event
- the event-specific question, task, or summary
- who acted / who is addressed
- deep link where applicable

### Asset attachment rules

- A free chat channel can have manually attached assets.
- Minimal asset kinds supported in S10:
  - `workflow`
  - `run`
  - `file`
- A workflow attached to a channel publishes events when its draft/version state changes.
- When a run is created from an attached workflow, the new run is automatically attached to the same channel and continues publishing run events there.
- A run can only be manually attached when it is still expected to emit future events.
- Runs already in terminal state (`completed`, `failed`, `stopped`) are not attachable.
- A file publishes events when it is modified.

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
3. Users can create a free chat channel.
4. A free chat channel can manually attach `workflow`, `run`, and `file` assets.
5. Mentioned-message delivery works as a channel event when enabled by subscriber preferences.
6. Un-addressed escalations continue to work as before.
7. Human replies are attributed in the run timeline and fed back into the agent's execution context.
8. Event delivery is participant-specific rather than workspace-wide.
9. Supported communication means in S10 are app and email.
10. Email delivery works whenever workspace email configuration exists, regardless of localhost mode.
11. Delivery fires for un-addressed escalation, run failed, run completed, and mentioned messages when enabled.
12. Plugin-backed agent task delivery and participant-targeted escalation routing are explicitly deferred beyond S10.
13. A workflow attached to a free chat channel emits events when draft/version state changes and when a new run is created.
14. A run created from an attached workflow is automatically attached to that same free chat channel.
15. A file attached to a free chat channel emits events when it is modified.
16. Delivered event content includes event-specific summary, participant attribution, and deep link where applicable.
17. On localhost installs, deep links use `frontend_url`; any Settings warning should refer to localhost-scoped links rather than `PUBLIC_BASE_URL`.
18. Generic reactive assets, Telegram, WhatsApp, external client access, exact participant-targeted escalation UX, agent subscription management, agent-targeted plugin delivery, and plugin/MCP separation are explicitly deferred beyond S10.

---

## Implementation Shape

S10 should be built as a minimal channel-first routing phase, not a transport redesign and not a full generalized event platform.

### Recommended architecture

- **Channel layer** — existing Knotwork channels remain the collaboration spine
- **Asset layer** — existing assets publish events into their attached/canonical channels
- **Asset binding layer** — explicit asset-to-channel attachments for free chat channels and other user-managed channel contexts
- **Participant layer** — stable participant identity for workspace members and registered agents
- **Subscription layer** — participant subscriptions to channels
- **Event layer** — typed channel events
- **Delivery layer** — app inbox and email
- **Delivery logging** — per event, per participant, per communication mean

### Build constraints

- Do not redesign plugin handshake, task protocol, or transport in S10.
- Do not fold agent-targeted plugin delivery into the participant communication model yet.
- Do not introduce a fully generic `assets can subscribe and react` framework in S10.
- Keep asset attachment minimal: `workflow`, `run`, and `file` only.
- Do not introduce external clients or run-scoped guest auth.
- Do not make Telegram or WhatsApp block the phase.
- Do not require an external OSS notification stack to deliver S10.
- Build the core event/subscription model in-house.
- Keep un-addressed escalation fallback behavior intact for backward compatibility.

### Recommended milestone order

1. Lock schema and API shape for participants, channel subscriptions, asset bindings, event records, preferences, and deliveries.
2. Build participant resolution and participant-specific inbox filtering.
3. Add free chat channel creation plus participant subscription support for in-scope channel-backed contexts.
4. Add manual asset binding support for `workflow`, `run`, and `file`.
5. Add mentioned-message routing plus preserve un-addressed escalation fallback.
6. Add participant communication preferences and delivery routing for app/email.
7. Extend routing beyond escalations to selected system events and harden fallback/link behavior.
