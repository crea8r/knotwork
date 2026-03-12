# Session 9 — Human-Usable Release

## Goal

Make Knotwork ready for humans to use reliably in production operations.

## In Scope

1. Workspace creation flow.
2. Notification system implementation.
3. Core UI refinement for daily operator/designer workflows.
4. Node branching UX/behavior refinement.
5. OpenClaw communication upgrade from polling to WebSocket (or equivalent efficient push model).
6. Mobile-ready UI for key user journeys.

## S9 Prep Note — OpenClaw WS Upgrade

1. Do a direct replacement of polling transport (no long-term coexistence mode for pull + WS).
2. Define the WS frame contract between plugin and Knotwork for:
   - plugin auth/identify
   - task dispatch
   - task event submission (`log`, `completed`, `escalation`, `failed`)
   - keepalive/heartbeat
3. Preserve current DB task/event contract (`openclaw_execution_tasks` + `openclaw_execution_events`) so runtime behavior does not change while transport changes.
4. Add reconnect/resume behavior so plugin restart/network blips do not orphan claimed tasks.
5. Update deployment guidance for reverse proxy/TLS upgrade headers and idle timeouts for long-lived WS connections.
6. Add S9 validation checks: reduced idle request noise, stable long-running task execution, no regression in run completion/escalation handling.

## Non-Goals

1. Agent-first product mode (reserved for S10).
2. Phase 2 features (cron, Slack, advanced roles, sub-graphs, auto-improvement loop).

## Acceptance Criteria

1. New user can create workspace and onboard without manual DB work.
2. Notification flows are functional for core attention-required events.
3. Main workflows are usable on mobile screens.
4. OpenClaw interaction is stable without polling-heavy behavior.
5. Product is ready for human operators as primary users.
