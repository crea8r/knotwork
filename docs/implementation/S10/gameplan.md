# Session 9.2 — Game Plan

This document translates the S9.2 spec into an execution plan. It is intentionally implementation-oriented: milestones, component boundaries, schema direction, and testing scope.

Read with:

- `docs/implementation/S9.2/spec.md`
- `docs/implementation/roadmap.md`

---

## North Star

By the end of S9.2:

- a run/chat event can target one or more specific participants
- inbox visibility is participant-specific rather than workspace-global by default
- each participant can register communication means per event type
- supported communication means are `app`, `email`, and `OpenClaw plugin`
- plugin keeps its current runtime behavior; only routing semantics change
- un-addressed escalations still preserve current fallback behavior

---

## Scope Boundary

### In scope

- participant identity for workspace members and registered agents
- participant-specific event delivery preferences
- participant-specific inbox filtering
- explicit recipient routing for addressed escalations
- email verification/test flow
- OpenClaw plugin as a participant-bound communication mean for supported event types
- `PUBLIC_BASE_URL` deep-link behavior and warnings
- selected non-escalation event delivery (`task_assigned`, `run_failed`, `run_completed`)

### Out of scope

- external clients / guest participants
- Telegram
- WhatsApp
- direct reply from email
- plugin protocol redesign
- MCP involvement
- generalized "unified work platform" beyond the routing model needed for S9.2

---

## Stable Decisions

These should stay fixed during implementation:

- `participant_id` is the routing key
- "human" and "agent" are participant attributes, not separate routing systems
- app inbox is the default communication mean
- plugin is treated as a communication mean for routing purposes even if its runtime remains specialized internally
- delivery preferences are explicit, not inferred from participant type
- delivery attempts are stored separately from business events
- un-addressed escalation remains a special fallback path for backward compatibility

---

## Domain Model

S9.2 should use four conceptual layers.

### 1. Event

Something happened in a chat context and may need to be delivered.

Initial event types:

- `escalation_created`
- `task_assigned`
- `run_failed`
- `run_completed`
- `mentioned_message` only if the existing mention stack is already close enough; otherwise defer

### 2. Recipient resolution

Determines who should receive the event:

- one explicit participant
- multiple explicit participants
- fallback broadcast to eligible workspace humans for un-addressed escalation

### 3. Delivery

Determines how each recipient receives the event:

- `app`
- `email`
- `openclaw_plugin`

### 4. Delivery attempt logging

Tracks status per recipient and communication mean without mutating the business event itself.

---

## Suggested Data Model

This is a planning recommendation, not a locked schema.

### Core entities

- `participants`
  - stable participant identity
  - participant kind: `workspace_member` or `registered_agent`
  - source record id
  - display metadata

- `participant_event_preferences`
  - participant id
  - event type
  - enabled communication means

- `participant_email_binding`
  - participant id
  - email address
  - verification status
  - last tested at
  - last test result

- `event_deliveries`
  - event type
  - source context ids
  - recipient participant id
  - communication mean
  - delivery status
  - detail / error metadata
  - timestamps

### Existing models likely to change

- escalations: needs explicit recipient fields or recipient linkage, not just generic workspace visibility
- inbox queries: must resolve by participant
- notification preferences/log: likely replaced or migrated into participant-specific preference and delivery records

### Important rule

Do not conflate:

- business event creation
- recipient selection
- delivery attempt logging

If those are collapsed into one table or one service, retries and fallback behavior will become hard to reason about quickly.

---

## Milestones

### Milestone 1 — Schema and API Lock

Outcome:

- schema direction agreed for participants, preferences, recipients, and delivery attempts
- API shape agreed before feature code starts

Decisions to lock:

- whether `participant_id` is a first-class table or a derived typed identifier
- which event types are in S9.2
- how explicit recipients are represented on escalations
- what remains of the current workspace-wide notification tables
- whether plugin delivery uses existing pairing state directly or needs a participant-bound preference row

Recommended output:

- migration sketch
- service/API contract sketch
- updated acceptance checklist if any wording needs tightening

### Milestone 2 — Participant Read Path

Outcome:

- system can resolve current participants and display them consistently

Deliverables:

- participant resolution service
- participant listing for workspace/run detail
- current-user -> current-participant mapping
- participant metadata exposed where inbox and run detail need it

### Milestone 3 — Participant-Specific Inbox

Outcome:

- addressed items stop behaving like workspace-global items

Deliverables:

- explicit recipient support for addressed escalation
- inbox query filtered by current participant
- un-addressed escalation fallback preserved
- run timeline attribution added or tightened

### Milestone 4 — Preferences and Delivery Routing

Outcome:

- communication means are selectable and routable per participant and event type

Deliverables:

- participant preference storage
- delivery resolution logic
- app delivery path
- email delivery path with verification/test
- plugin as selectable communication mean for supported event types

### Milestone 5 — Non-Escalation Events

Outcome:

- the routing model applies beyond escalations

Deliverables:

- `task_assigned` delivery
- `run_failed` delivery
- `run_completed` delivery
- `mentioned_message` only if cheap enough; otherwise explicitly defer

### Milestone 6 — Hardening

Outcome:

- production-ready fallback and observability behavior

Deliverables:

- missing-preference fallback rules
- delivery status visibility
- `PUBLIC_BASE_URL` warnings
- migration/backward-compatibility checks
- regression coverage for existing escalation behavior

---

## Concrete Execution Plan By Component

### Backend — schema and models

Owns:

- participant identity representation
- participant event preferences
- email verification/test state
- event delivery attempt logging
- recipient fields/linkage on addressed escalations

Expected work:

- add participant persistence or typed identifier support
- migrate workspace-wide notification preference model toward participant-specific storage
- add delivery-attempt logging that is not tied only to workspace-level notification records
- decide whether existing notification log tables are superseded or extended

### Backend — services

Owns:

- participant resolution
- recipient resolution
- preference lookup
- delivery fanout
- fallback behavior

Expected work:

- participant resolver for workspace members and registered agents
- current principal -> participant mapping
- addressed recipient resolution for escalations
- fanout service that emits `app`, `email`, and `plugin` deliveries
- policy rules for event type -> supported communication means

### Backend — existing event producers

Owns:

- creating events that now need participant-aware routing

Expected work:

- escalation creation path
- OpenClaw task assignment path
- run failed/completed event emission
- any mention path included in scope

Rule:

- event producers should not own delivery logic; they should emit business events or call a routing service

### Backend — notifications/delivery adapters

Owns:

- actual delivery mechanics for email and plugin routing

Expected work:

- refactor current notification dispatcher from workspace-wide behavior to participant-specific fanout
- keep email as testable/verifiable
- keep plugin behavior intact while allowing plugin to be selected for supported event types
- define delivery result logging semantics

### Backend — API

Owns:

- endpoints needed by settings, inbox, and run detail

Expected changes:

- participant listing endpoint or participant-aware extensions to existing endpoints
- preference read/update endpoint
- email send-test / verify endpoint(s)
- inbox endpoint returning participant-specific items
- escalation APIs accepting explicit participant targets where applicable

### Frontend — settings

Owns:

- participant communication preference UI
- email verification/test UX
- `PUBLIC_BASE_URL` warnings

Expected work:

- replace workspace-wide notification settings mental model
- show event-type preferences per communication mean
- ensure plugin options only appear where valid
- make "app" visible as default/fallback without making it noisy

### Frontend — inbox

Owns:

- participant-specific visibility
- clear explanation of addressed vs un-addressed items

Expected work:

- remove current assumption that open escalations are workspace-global
- preserve un-addressed fallback visibility
- show targeting metadata in list/detail surfaces

### Frontend — run detail and timeline

Owns:

- participant list
- event attribution
- clarity around who asked and who was addressed

Expected work:

- participant list in run detail
- targeted escalation attribution in timeline
- event highlighting via deep links

### Frontend — agent/admin surfaces

Owns:

- any configuration needed for agent participants to use plugin delivery

Expected work:

- determine whether plugin delivery preferences live in agent settings, general notifications settings, or both
- keep pairing/health state understandable without redesigning plugin internals

---

## API and UX Decisions To Settle Early

These questions should be answered before implementation starts:

- Is `participant_id` first-class persisted identity or a typed synthetic id?
- Who is allowed to edit communication preferences for an agent participant?
- Is app delivery always implicit, or can it be disabled for some event types?
- Does plugin delivery need a "send test" in S9.2, or is pairing/health enough?
- Are run-completed events participant opt-in only, or workflow opt-in plus participant opt-in?
- Is `mentioned_message` actually in scope, or should it be deferred explicitly now?

---

## Testing Plan

### Backend domain tests

- participant resolution for workspace members and registered agents
- explicit recipient resolution
- un-addressed escalation fallback
- preference lookup by participant and event type
- delivery fanout rules by communication mean

### Backend integration tests

- addressed escalation reaches only target participant inbox
- un-addressed escalation preserves current fallback behavior
- email delivery logs correct participant and event type
- plugin-backed agent receives supported assigned events
- run failed/completed delivery respects preferences

### Frontend tests

- inbox hides non-targeted items
- un-addressed escalation still appears for eligible responders
- run detail shows participant list and attribution
- settings show per-event-type preferences
- localhost warning appears when `PUBLIC_BASE_URL` is missing

### Regression tests

- legacy escalation flow still works when no participant is explicitly targeted
- existing plugin task flow is not broken by routing changes
- current run completion/failure surfaces still behave when no new preferences are configured

---

## Risks

### 1. Identity ambiguity

If participant identity is bolted on too loosely, every inbox/delivery query becomes custom glue.

### 2. Event vs delivery confusion

If business events and delivery attempts are not separated, retries and failure states will become hard to reason about.

### 3. Over-generalization

Trying to build the full future event/work-item platform in S9.2 will likely over-expand the phase.

### 4. Under-generalization

If implementation only patches escalations and ignores event routing structure, the same work will be repeated in later sessions.

### 5. Plugin leakage

If the implementation starts redesigning plugin semantics now, it will create churn before S12.

### 6. Access-control confusion

Participant-specific inbox visibility should not accidentally imply broader scoping or permission guarantees that are not being implemented yet.

---

## Recommended Scope Cuts If Schedule Tightens

Cut in this order:

1. defer `mentioned_message`
2. defer `run_completed`
3. keep `run_failed` only if already cheap
4. keep email verification simple
5. keep plugin as opt-in for `task_assigned` only

Do not cut:

- addressed escalation
- participant-specific inbox
- participant-specific preference model

Those are the core of the phase.

---

## Definition of Done

S9.2 is done when:

- addressed escalation is truly participant-specific
- inbox is no longer workspace-global by default
- participants can configure `app` / `email` / `plugin` by event type
- plugin fits the routing model without transport redesign
- email is verifiable and testable
- un-addressed escalation still works
- docs, UI, and backend all reflect the same model
