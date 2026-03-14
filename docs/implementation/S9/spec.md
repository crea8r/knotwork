# Session 9 — Human-Usable Release

## Goal

Make Knotwork ready for humans to use reliably in production operations.

## In Scope

1. Workspace creation flow.
2. Notification system implementation.
3. Core UI refinement for daily operator/designer workflows.
   - designer chat must route through registered/workspace agents rather than direct OpenAI or Claude provider calls
   - when the user has uploaded a file, the run/public trigger input field may be left empty
   - public workflow trigger pages support file upload as an input path
4. Workflow readiness hardening:
   - validate the exact graph version before run trigger
   - block runs when executable nodes are missing required config (for example agent nodes without `agent_ref`)
   - block public publish / public trigger for invalid workflows
   - surface structured blocking issues in API and UI
   - keep runtime defensive with explicit node/run errors if invalid state still slips through
5. Node branching UX/behavior refinement:
   - support intentional loop-back paths for review / revise workflows
   - do not reject a workflow just because it contains a loop
   - define loop execution safety rules (for example max iterations, repeat-state visibility, and explicit stop conditions)
   - make review/revision loops understandable in designer and run UI
6. OpenClaw communication upgrade from polling to WebSocket (or equivalent efficient push model).
   - transport upgrade must include reliability semantics, not just protocol replacement
   - plugin must recover automatically from dropped connection, stale credentials, and temporary backend unavailability
   - plugin must retry or replay undelivered terminal task events (`completed`, `escalation`, `failed`) until backend acknowledges them
   - system must expose explicit degraded states instead of silently appearing idle
7. OpenClaw concurrency upgrade:
   - support multiple concurrent tasks per remote agent instead of one task per plugin instance
   - default concurrency is `2` tasks per remote agent
   - plugin-instance cap: `min(8, remote_agent_count * 2)` by default
   - make both limits configurable in plugin config / integration settings
   - expose queue vs claimed vs running state in UI so waiting tasks are understandable
8. Escalation response UX hardening:
   - when an agent escalates with a question, the run UI must present a clear response form to the human
   - human can answer the question and resume the run without leaving the run context
   - human can conclude the agent is confident enough to move on after giving guidance or accepting the situation
   - the resolution path must be explicit in UI and reflected in run timeline / decision history
9. Collaborative run-context support:
   - each agent in a run understands it is operating within a team context, not in isolation
   - run context may include workspace humans, workspace agents, and external client participants who can clarify requests without backend access
   - agents can request idea/feedback/suggestions from specific humans or agents in the run
   - addressing must be explicit so an agent can target the exact human or agent it needs help from
   - external client interaction must stay scoped to the run and not grant general backend/workspace access
10. Workflow organization UX:
   - workflows support folders and tags for easier browsing and filtering
   - workflow list/tree should reuse the Handbook file-tree interaction model for consistency
   - users can browse workflows in a collapsible tree view by folder
   - tags remain cross-cutting metadata and can be used for filtering/search independently of folder placement
11. Mobile-ready UI for key user journeys.

## S9 Prep Note — OpenClaw WS Upgrade

1. Do a direct replacement of polling transport (no long-term coexistence mode for pull + WS).
2. Define the WS frame contract between plugin and Knotwork for:
   - plugin auth/identify
   - task dispatch
   - task event submission (`log`, `completed`, `escalation`, `failed`)
   - keepalive/heartbeat
   - ACK / retry semantics for event delivery
   - reconnect / resume semantics after connection loss
3. Preserve current DB task/event contract (`openclaw_execution_tasks` + `openclaw_execution_events`) so runtime behavior does not change while transport changes.
4. Add reconnect/resume behavior so plugin restart/network blips do not orphan claimed tasks.
5. Add automatic credential recovery behavior:
   - startup handshake retries with backoff until success
   - auth failures during dispatch/event submission trigger re-handshake automatically
   - stale plugin credentials do not require manual restart as the primary recovery path
6. Define concurrency/claim semantics for multi-task execution:
   - per-agent concurrency default is `2`
   - plugin-instance cap default `min(8, remote_agent_count * 2)`
   - fair claiming so one hot agent does not starve other agents
7. Define explicit human response flow for agent escalations:
   - escalated question appears with answer form in run UI
   - human answer resumes the run
   - human can explicitly conclude "agent is confident, move on" when appropriate
   - timeline and decision records remain coherent after resume
8. Define loop execution semantics for workflow graphs:
   - loops are valid when used for review/revision flows
   - runtime prevents accidental infinite execution via explicit safeguards
   - run timeline and node state clearly show repeated passes through the same node
9. Define degraded-state observability:
   - connected, handshake_failed, auth_stale, gateway_unavailable, busy, idle, and backlog states are visible in operator-facing debug/status surfaces
   - last successful handshake, task pull, and terminal event submit timestamps are visible
10. Update deployment guidance for reverse proxy/TLS upgrade headers and idle timeouts for long-lived WS connections.
11. Add S9 validation checks: reduced idle request noise, stable long-running task execution, no regression in run completion/escalation handling, correct queue/claim behavior under concurrent load, successful human answer/resume flow for escalations, successful review-loop execution without false invalid-graph rejection, and no manual restart required for routine dropped-connection/auth-recovery cases.
12. Align the trigger-input contract across operator and public entry points:
   - uploaded files count as valid input even when the free-text field is empty
   - public trigger pages expose the same upload capability where the workflow input schema allows it
13. Remove direct provider dependence from designer chat:
   - designer chat must invoke a configured agent path instead of calling OpenAI/Claude adapters directly
   - missing agent availability/configuration must surface as a clear blocking state in UI/API
14. Define collaborative run addressing semantics:
   - stable participant identity for humans, external clients, and agents within a run
   - agent can direct a request/question to a specific participant
   - targeted requests are visible in run timeline and inbox state
   - replies are attributed to the exact participant and can be fed back into execution context
15. Define workflow organization semantics:
   - folder path model for workflows
   - tag model separate from folder hierarchy
   - handbook-style tree behaviors reused where appropriate (expand/collapse, selection, drag/drop only if explicitly supported)
   - workflow search/filter combines tree navigation with tag filtering

## Non-Goals

1. Agent-first product mode (reserved for S10).
2. Phase 2 features (cron, Slack, advanced roles, sub-graphs, auto-improvement loop).

## Acceptance Criteria

1. New user can create workspace and onboard without manual DB work.
2. Notification flows are functional for core attention-required events.
3. Triggering a run fails fast with `400`-class validation errors when the pinned graph version is not runnable.
4. Publish/public-trigger flows reject workflows with blocking configuration issues.
5. Workflow UI clearly shows runnable vs blocked state and identifies blocking nodes/fields.
6. OpenClaw can process multiple tasks concurrently with the default limit of `2` tasks per remote agent, without starving other agents on the same plugin instance.
7. When an agent escalates with a question, the operator can answer in the run UI and resume the run to completion without manual DB/admin intervention.
8. Review/revision workflows with loop-back edges can run successfully with clear safeguards and visible iteration history.
9. OpenClaw transport can recover from routine disconnect/auth drift without requiring manual OpenClaw restart.
10. Terminal task events are not silently lost when transient backend/network failures happen.
11. Operator-facing status/debug surfaces make it clear whether OpenClaw is connected, degraded, busy, or backlogged.
12. Main workflows are usable on mobile screens.
13. OpenClaw interaction is stable without polling-heavy behavior.
14. Product is ready for human operators as primary users.
15. Designer chat uses a configured agent path instead of direct OpenAI/Claude provider calls.
16. Operator and public trigger forms accept an uploaded file as sufficient input when no text is entered.
17. Public workflow pages support file upload wherever the workflow input contract allows it.
18. Agents can explicitly address the correct human, external client, or workspace agent inside a run when they need clarification, ideas, or feedback.
19. External clients can participate in run clarification without receiving backend/workspace access.
20. Workflows can be organized by folder and tag, and the workflow browsing experience is consistent with the Handbook tree view.
