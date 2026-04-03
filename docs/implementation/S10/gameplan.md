# Session 10 — Multiple Mode Game Plan

This document translates the S10 spec into a concrete execution plan. It stays intentionally minimal: channel-first, participant subscriptions, asset event publishing, and participant-specific deliveries without trying to build the whole future event platform now.

Read with:

- `docs/implementation/S10/spec.md`
- `docs/implementation/roadmap.md`

Implementation decision:

- S10 uses a Knotwork-native minimal event/subscription core.
- External OSS is optional only for future delivery adapters, not for the core model.

---

## North Star

By the end of S10:

- channels are the primary collaboration container
- assets publish typed events into their channels
- participants subscribe to channels and receive participant-specific notifications
- inbox visibility is participant-specific rather than workspace-global by default
- supported communication means are `app` and `email`
- un-addressed escalations still preserve current fallback behavior

---

## Scope Boundary

### In scope

- participant identity for workspace members and registered agents
- free chat channel creation
- participant subscriptions to in-scope channel-backed contexts
- manual asset attachment for `workflow`, `run`, and `file`
- participant-specific event delivery preferences
- participant-specific inbox filtering
- mentioned-message delivery
- owner-managed workspace email configuration and participant email delivery
- `frontend_url` deep-link behavior and localhost warnings
- selected non-escalation event delivery (`task_assigned`, `run_failed`, `run_completed`)

### Out of scope

- generic asset subscriptions/reactive automation
- external clients / guest participants
- Telegram
- WhatsApp
- direct reply from email
- plugin protocol redesign
- agent-targeted plugin delivery as a participant communication mean
- agent subscription management beyond current human self-service
- exact participant-targeted escalation workflow/UX
- MCP involvement
- a generalized "everything is a reactive subscriber" platform
- mandatory adoption of an external notification platform

---

## Stable Decisions

These should stay fixed during implementation:

- channel is the primary collaboration object
- free chat channels are allowed user-managed collaboration containers
- assets and participants can publish events into channels
- `participant_id` is the routing key
- app inbox is the default communication mean for humans
- delivery preferences are explicit, not inferred from participant type
- subscriptions are distinct from delivery preferences
- assets are not generalized subscribers in S10
- delivery attempts are stored separately from business events
- un-addressed escalation remains a special fallback path for backward compatibility
- the core event/subscription system is built in-house for S10

---

## Domain Model

S10 should use six conceptual layers.

### 1. Channel

The durable collaboration container. Existing channel-backed contexts already include workflow chat, run chat, handbook chat, and agent main chat.

### 2. Asset

A domain object attached to a channel. In Knotwork this includes workflows, runs/tasks, handbook, and later projects/files/version streams.

Minimal S10 rule:

- assets publish events into their attached/canonical channels
- assets do not become generalized subscribers/reactive actors yet
- supported manual asset bindings are `workflow`, `run`, and `file`

### 3. Participant

A human or agent identity that can subscribe, be addressed, and receive notifications.

### 4. Subscription

Determines which participants listen to which channels.

Minimal S10 rule:

- participants subscribe/unsubscribe to channels
- communication means are not the same thing as subscriptions

### 4.5. Asset binding

Determines which assets publish into which user-managed channels.

Minimal S10 rule:

- free chat channels can manually bind `workflow`, `run`, and `file`
- terminal runs are not attachable
- a run created from an attached workflow is automatically attached to the same channel

### 5. Event

Something happened in a channel and may need to be delivered.

Initial event types:

- `escalation_created`
- `task_assigned`
- `run_failed`
- `run_completed`
- `mentioned_message`
- `message_posted`

### 6. Delivery

Determines how subscribers receive the event:

- `app`
- `email`

Delivery attempts track status per participant and communication mean without mutating the business event itself.

---

## Data Model

This section splits the model into what already exists and what is new for a minimal S10 implementation.

### Already exists

- `channels`
  - primary collaboration container already exists
  - supports workflow, handbook, run, and agent-main contexts

- `channel_messages`
  - already stores participant-authored chat content inside channels

- `decision_events`
  - already stores some run/escalation-related decisions

- `runs`
  - existing asset

- `escalations`
  - existing event source, but still effectively workspace-wide in behavior

- `workspace_members`
  - existing human identity source

- `registered_agents`
  - existing agent identity source

- `openclaw_integrations` and related pairing state
  - existing agent/plugin communication path

- `notification_preferences` and `notification_logs`
  - existing notification system, but workspace-scoped rather than participant-scoped

### New for minimal S10

- `channel_subscriptions`
  - participant subscribes/unsubscribes to a channel
  - this is the channel-first core missing today

- `channel_events`
  - typed events published into channels
  - minimal event records for inbox and notification derivation

- `channel_asset_bindings`
  - workflow, run, or file attached to a channel
  - this is the minimal bridge between assets and free chat channels

- `participant_delivery_preferences`
  - per participant per event type delivery means
  - replaces workspace-wide notification preference semantics

- `event_deliveries`
  - per event, per participant, per communication mean delivery attempts

- optional `participants`
  - either a first-class table or a typed identity layer over `workspace_members` and `registered_agents`
  - minimal implementation may choose typed ids instead of a new table

### Explicitly not new in minimal S10

- no generic `assets` table
- no generic `assets can subscribe/react` framework
- no full external notification platform embedded into Knotwork core

### Recommended minimal path

- keep existing asset tables as event sources
- keep existing channel tables as the collaboration spine
- add participant mapping, channel subscriptions, channel events, delivery preferences, and event deliveries
- add channel asset bindings for `workflow`, `run`, and `file`
- migrate away from workspace-wide notification preference semantics rather than expanding them

### Important rule

Do not conflate:

- asset state
- event publishing
- subscription
- delivery attempts

If those are collapsed into one table or one service, the system will become hard to extend.

---

## Milestones

### Milestone 1 — Schema and API Lock

Outcome:

- schema direction agreed for participants, subscriptions, asset bindings, event records, preferences, and deliveries
- API shape agreed before feature code starts

Implementation tasks:

- choose the minimal participant identity representation, consistent with the locked decision that typed ids are acceptable if they keep implementation smaller
- add a first-class `channel_events` model for inbox and delivery derivation
- add `channel_asset_bindings` for workflow/run/file attachment
- encode the S10 event set: `escalation_created`, `task_assigned`, `run_failed`, `run_completed`, `mentioned_message`, `message_posted`
- define explicit subscription representation for run, workflow, handbook, and agent-main channels
- define explicit asset-binding representation for free chat channels
- migrate workspace-wide notification tables toward participant-scoped delivery configuration/logging
- historical note, superseded by S12.1/S12.2: at S10 planning time agent/plugin delivery was kept outside the participant fanout path; current architecture treats members uniformly in Knotwork and keeps plugin transport entirely agent-side

Recommended output:

- migration sketch
- service/API contract sketch
- updated acceptance checklist if wording needs tightening

### Milestone 2 — Participant and Subscription Read Path

Outcome:

- system can resolve current participants and subscriptions consistently

Deliverables:

- participant resolution service
- channel subscription resolution
- participant listing for workspace/run detail
- current-user -> current-participant mapping
- participant metadata exposed where inbox and run detail need it

### Milestone 2.5 — Free Chat and Asset Binding Read Path

Outcome:

- free chat channels are user-creatable
- attached assets can be listed and managed per channel

Deliverables:

- free chat channel creation path
- asset binding query support
- workflow/run/file listing for attachment UI
- validation rules for attachable runs

### Milestone 3 — Participant-Specific Inbox

Outcome:

- participant-specific items stop behaving like workspace-global items
- subscribers start receiving notifications based on channel membership rather than workspace-wide assumptions

Deliverables:

- channel subscription model/query support
- channel asset binding model/query support
- mentioned-message event support
- inbox query filtered by current participant
- un-addressed escalation fallback preserved
- run timeline attribution added or tightened

### Milestone 4 — Preferences and Delivery Routing

Outcome:

- channel events turn into subscriber-specific deliveries
- communication means are selectable and routable per participant and event type

Deliverables:

- participant preference storage
- channel event publishing path
- delivery resolution logic
- app delivery path
- email delivery path using existing workspace mail configuration

### Milestone 5 — Non-Escalation Events

Outcome:

- the routing model applies beyond escalations

Deliverables:

- `task_assigned` delivery
- `run_failed` delivery
- `run_completed` delivery
- `mentioned_message` delivery
- workflow draft/version change delivery into attached channels
- workflow-created run attachment + delivery
- file modified delivery into attached channels

### Milestone 6 — Hardening

Outcome:

- production-ready fallback and observability behavior

Deliverables:

- missing-preference fallback rules
- delivery status visibility
- localhost deep-link warnings derived from `frontend_url`
- migration/backward-compatibility checks
- regression coverage for existing escalation behavior

---

## Concrete Execution Plan By Component

### Backend — schema and models

Owns:

- participant identity representation
- channel subscription representation
- channel asset binding representation
- participant delivery preferences
- channel event records or publishing mechanism
- event delivery attempt logging

Expected work:

- add participant persistence or typed identifier support
- add channel subscription persistence
- add channel asset binding persistence
- migrate workspace-wide notification preference model toward participant-specific storage
- add channel event persistence or explicit publishing mechanism
- add delivery-attempt logging that is not tied only to workspace-level notification records
- decide whether existing notification log tables are superseded or extended

### Backend — services

Owns:

- participant resolution
- channel subscription resolution
- asset binding resolution
- preference lookup
- channel event publishing
- delivery fanout
- fallback behavior

Expected work:

- participant resolver for workspace members and registered agents
- current principal -> participant mapping
- channel -> subscriber resolution
- asset -> attached channel resolution
- mention -> targeted participant resolution
- fanout service that emits `app` and `email` deliveries
- policy rules for event type -> supported communication means

### Backend — existing event producers

Owns:

- creating events that now need channel-aware routing

Expected work:

- escalation creation path
- OpenClaw task assignment path
- channel message / mention path
- run failed/completed event emission
- workflow draft/version change path
- run creation path for auto-attachment
- file create/update/rename/restore path

Rule:

- event producers should publish typed channel events or call a routing service; they should not own delivery logic

### Backend — notifications/delivery adapters

Owns:

- actual delivery mechanics for app and email routing
- translation from channel events into participant-specific deliveries

Expected work:

- refactor current notification dispatcher from workspace-wide behavior to participant-specific fanout
- keep email delivery simple and tied to existing workspace mail configuration
- define delivery result logging semantics

### Backend — API

Owns:

- endpoints needed by settings, inbox, and run detail

Expected changes:

- participant listing endpoint or participant-aware extensions to existing endpoints
- channel subscription read/update endpoints or equivalent service surface
- asset binding read/update endpoints
- preference read/update endpoint
- inbox endpoint returning participant-specific items
- mention-aware message APIs if needed for S10 scope

### Frontend — settings

Owns:

- participant communication preference UI
- channel subscription UX
- free chat channel creation
- asset attachment UX
- owner-managed email configuration messaging
- localhost deep-link warnings tied to `frontend_url`

Expected work:

- replace workspace-wide notification settings mental model
- show channel subscription state
- show event-type preferences per communication mean
- make `app` visible as default/fallback without making it noisy

### Frontend — inbox

Owns:

- participant-specific visibility
- clear explanation of targeted notifications vs un-addressed escalation fallback

Expected work:

- remove current assumption that open escalations are workspace-global
- make notifications derive from channel subscriptions plus event preferences
- preserve un-addressed fallback visibility
- show targeting metadata in list/detail surfaces

### Frontend — run detail and timeline

Owns:

- participant list
- event attribution
- clarity around who asked and who responded

Expected work:

- participant list in run detail
- human response attribution in timeline
- mention attribution in channel surfaces
- event highlighting via deep links

## Locked Decisions

These implementation decisions are resolved for S10:

- `participant_id` may be implemented as either a first-class table or a typed synthetic id; S10 does not require a dedicated participants table if typed ids keep the implementation smaller.
- `channel_events` should be a first-class table in S10 so inbox and delivery logic do not rely on ad hoc derivation from multiple source records.
- Subscriptions are explicit per channel for in-scope channel-backed contexts.
- historical note, superseded by S12.1+: app/plugin defaults are no longer modeled as human-vs-agent product behavior
- Run-completed delivery is workflow opt-in plus participant preference.
- `mentioned_message` is fully in scope for S10.
- historical note, superseded by S12.1/S12.2: exact participant targeting is now part of the unified member model, while plugin transport remains agent-side rather than a Knotwork-side subsystem

---

## Testing Plan

### Backend domain tests

- participant resolution for workspace members and registered agents
- channel subscription resolution
- un-addressed escalation fallback
- preference lookup by participant and event type
- delivery fanout rules by communication mean

### Backend integration tests

- mentioned message reaches only subscribed/targeted participants according to preference rules
- un-addressed escalation preserves current fallback behavior
- email delivery logs correct participant and event type
- run failed/completed delivery respects preferences

### Frontend tests

- inbox hides non-targeted items
- subscription changes affect future notification visibility
- un-addressed escalation still appears for eligible responders
- run detail shows participant list and attribution
- settings show per-event-type preferences
- localhost warning behavior is described in terms of `frontend_url`

### Regression tests

- legacy escalation flow still works when no participant is explicitly targeted
- current run completion/failure surfaces still behave when no new preferences are configured
- channels without explicit subscription data still behave safely during migration

---

## Risks

### 1. Identity ambiguity

If participant identity is bolted on too loosely, every inbox/delivery query becomes custom glue.

### 2. Event vs delivery confusion

If business events and delivery attempts are not separated, retries and failure states will become hard to reason about.

### 3. Channel/subscription ambiguity

If channels, assets, and participant subscriptions are not separated clearly, S10 will blur chat structure, notification rules, and runtime behavior together.

### 4. Over-generalization

Trying to build the full future event/work-item platform in S10 will likely over-expand the phase.

### 5. Under-generalization

If implementation only patches escalations and ignores event routing structure, the same work will be repeated in later sessions.

### 6. Plugin leakage

If the implementation starts redesigning plugin semantics now, it will create churn before S12.

### 7. Access-control confusion

Participant-specific inbox visibility should not accidentally imply broader scoping or permission guarantees that are not being implemented yet.

---

## Recommended Scope Cuts If Schedule Tightens

Cut in this order:

1. defer `mentioned_message`
2. defer `run_completed`
3. keep `run_failed` only if already cheap
4. keep explicit subscriptions on only the most important channel-backed contexts

Do not cut:

- channel subscription model
- participant-specific inbox
- participant-specific preference model

Those are the core of the phase.

---

## Definition of Done

S10 is done when:

- channels are the backbone of notification routing in the implementation, not just a UI shell
- inbox is no longer workspace-global by default
- participants can configure `app` / `email` by event type
- email delivery works from existing workspace mail configuration
- un-addressed escalation still works
- docs, UI, and backend all reflect the same model
