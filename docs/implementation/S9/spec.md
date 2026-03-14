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
   - plugin must support OpenClaw gateway auth modes `none`, `token`, `password`, and `trusted-proxy` through a single startup resolver rather than hardcoded token-only behavior
   - gateway auth strategy selection must be automatic by default, based on OpenClaw runtime config plus optional plugin hints
   - all gateway calls must go through one internal client wrapper so auth behavior, retries, and error classification are consistent
   - plugin identity/bootstrap must be stable across routine restarts:
     - `plugin_instance_id` must be persisted and reused
     - `integration_secret` must be persisted and reused for normal restart recovery
     - handshake is for initial pairing or explicit recovery, not a required step for every restart
   - plugin must not loop forever on handshake `409 token already used` by generating or using new plugin identities
   - when bootstrap fails due to identity mismatch, plugin must enter an explicit degraded state with actionable remediation instead of silently starving the queue
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
11. Install/session-state hardening:
   - frontend must not trust cached `workspaceId`, role, or localhost bypass state across reinstall/reset events
   - backend should expose a stable per-install `installation_id` so the client can detect a fresh install explicitly instead of inferring it
   - on app bootstrap, frontend must compare cached `installation_id` with server `installation_id`; mismatch forces auth/workspace cache reset and re-bootstrap
   - frontend must always revalidate cached `workspaceId` against the current `/workspaces` response before using it for API calls
   - if cached workspace is missing, frontend must switch to a valid current workspace or clear auth state if none exist
   - localhost bypass sessions must refresh identity + workspace from the backend on load; persisted `localhost-bypass` alone is not a valid source of truth
   - cached role is display-only; authorization decisions must come from current backend membership data
   - backend should support machine-readable invalidation semantics for broken client state (for example `installation_changed`, `workspace_not_found`, or equivalent 401/403/404 contracts)
12. Installation update mechanism:
   - define a supported upgrade path so a running Knotwork install can be kept current with the upstream repo without ad hoc manual steps
   - installation must expose current app version/build info and update availability status
   - define update contract across backend, frontend, worker, DB migrations, and OpenClaw plugin compatibility
   - support an operator-friendly update procedure for both localhost and remote-server installs
   - define required pre-update checks, migration execution, health verification, and rollback expectations
   - avoid upgrade flows that silently break persisted client state, plugin pairing, or active run recovery
13. Mobile-ready UI for key user journeys.

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
   - auth/bootstrap retry rules must distinguish recoverable vs non-recoverable failures:
     - `401 invalid credentials` -> clear stale secret and retry handshake
     - `409 handshake token already used` -> stop blind retry loop, preserve stable identity, surface remediation to reuse existing identity or generate a fresh token
     - identity drift must not create unbounded new `plugin_instance_id` values
   - gateway client startup resolves auth strategy from OpenClaw config:
     - inputs: `api.config.gateway.auth.mode`, presence of gateway token, presence of gateway password, optional trusted-proxy capability
     - strategy matrix:
       - `none` -> no auth headers
       - `token` -> token only
       - `password` -> password (and token too if the transport/runtime requires it)
       - `trusted-proxy` -> delegated identity flow, or fail with a clear actionable message if unavailable
   - create one internal `callGateway(method, payload)` wrapper that:
     - applies resolved auth consistently
     - retries once on auth errors with a fallback strategy when safe
     - classifies failures into explicit codes such as `AUTH_PASSWORD_MISSING`, `AUTH_INVALID`, `AUTH_MODE_UNSUPPORTED`, `AUTH_TRUSTED_PROXY_UNAVAILABLE`
   - avoid scattering gateway auth/header logic across plugin modules
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
   - gateway auth diagnostics are visible:
     - detected gateway auth mode
     - active auth strategy
     - last auth error code
     - next remediation suggestion
   - queue diagnostics must distinguish:
     - task is pending because no plugin has claimed it yet
     - task is pending because integration/bootstrap is unhealthy
     - task is queued behind current plugin concurrency limits
10. Update deployment guidance for reverse proxy/TLS upgrade headers and idle timeouts for long-lived WS connections.
11. Extend plugin config schema for optional gateway auth hints:
   - `gatewayAuthMode` optional override
   - `gatewayPassword` optional, used only when the resolved mode needs it
   - `gatewayToken` optional override
   - `authAuto` default `true`
   - when hints are absent, plugin auto-detects from OpenClaw runtime config
12. Improve Knotwork install payload for mode-aware setup:
   - `/openclaw-plugin/install` always returns `knotworkBaseUrl` and `handshakeToken`
   - it may include `gatewayAuthMode` hint where safe/useful
   - it must never force insecure defaults or fake credentials into the generated config
13. Persist recovered runtime gateway strategy safely:
   - cache resolved gateway auth strategy/runtime mode
   - do not persist raw gateway secrets unless strictly necessary
   - if secrets must be persisted for restart recovery, document scope and storage guarantees explicitly
14. Add validation checks for gateway auth compatibility:
   - fresh startup succeeds across OpenClaw auth modes `none`, `token`, `password`, and supported `trusted-proxy`
   - plugin status/debug output identifies auth-mode mismatch clearly
   - auth failures no longer surface as opaque websocket/gateway errors without remediation guidance
15. Add validation checks for plugin bootstrap identity recovery:
   - routine restart reuses the same `plugin_instance_id` and persisted `integration_secret`
   - plugin does not enter infinite handshake retry on `409 Handshake token already used`
   - pending tasks are diagnosable as queue wait vs bootstrap/auth failure
16. Add S9 validation checks: reduced idle request noise, stable long-running task execution, no regression in run completion/escalation handling, correct queue/claim behavior under concurrent load, successful human answer/resume flow for escalations, successful review-loop execution without false invalid-graph rejection, and no manual restart required for routine dropped-connection/auth-recovery cases.
17. Align the trigger-input contract across operator and public entry points:
   - uploaded files count as valid input even when the free-text field is empty
   - public trigger pages expose the same upload capability where the workflow input schema allows it
18. Remove direct provider dependence from designer chat:
   - designer chat must invoke a configured agent path instead of calling OpenAI/Claude adapters directly
   - missing agent availability/configuration must surface as a clear blocking state in UI/API
19. Define collaborative run addressing semantics:
   - stable participant identity for humans, external clients, and agents within a run
   - agent can direct a request/question to a specific participant
   - targeted requests are visible in run timeline and inbox state
   - replies are attributed to the exact participant and can be fed back into execution context
20. Define workflow organization semantics:
   - folder path model for workflows
   - tag model separate from folder hierarchy
   - handbook-style tree behaviors reused where appropriate (expand/collapse, selection, drag/drop only if explicitly supported)
   - workflow search/filter combines tree navigation with tag filtering
21. Define install/session-state hardening semantics:
   - backend exposes `installation_id` via a stable endpoint already loaded during bootstrap (`/health`, `/auth/me`, or a dedicated session bootstrap endpoint)
   - `installation_id` persists across normal restarts but changes on true fresh install / database reset / explicit install regeneration
   - frontend stores last-seen `installation_id` separately from auth token/workspace cache
   - on `installation_id` mismatch, frontend clears `knotwork_auth`-style cached session state before rendering workspace-scoped pages
   - startup must validate cached `workspaceId` against current `/workspaces` before any workspace-scoped query runs
   - localhost installs using bypass auth must never skip bootstrap solely because a cached bypass token exists
   - stale cached role must not drive owner/operator gating in UI without confirming current membership
   - operator-facing debug docs should mention how install resets invalidate cached browser state
22. Define installation update semantics:
   - each release exposes an application version, schema version, and minimum compatible OpenClaw plugin version
   - provide a canonical update entry point (for example a versioned docker compose pull/up flow or a dedicated update script) rather than relying on manual repo diffing
   - update flow includes ordered steps: fetch release, stop/recreate services as needed, run migrations exactly once, verify health, verify background worker, verify plugin compatibility state
   - define behavior for active runs during update (drain, resume, or explicitly unsupported)
   - backend should expose machine-readable version/build metadata for UI and support diagnostics
   - UI should surface current version and warn when server/plugin compatibility is out of date
   - if auto-update is not supported, explicitly provide a safe guided manual-update contract with rollback instructions
   - update contract must preserve persisted installation identity unless this is intentionally a reinstall/reset

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
21. After a clean reinstall, DB reset, or workspace reseed, the browser does not keep sending stale workspace IDs from local storage.
22. Frontend automatically detects installation drift and recovers to a valid workspace/auth state without manual localStorage editing in normal cases.
23. Localhost bypass installs bootstrap against current backend state on page load and do not rely on stale cached `localhost-bypass` credentials.
24. A deployed install can be updated to a newer Knotwork release through a documented supported mechanism without guessing the order of repo pull, container restart, migration, and verification steps.
25. Version/build information and compatibility state are visible enough that an operator can determine whether backend, frontend, worker, DB schema, and OpenClaw plugin are aligned.
