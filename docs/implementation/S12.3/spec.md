# Session 12.3 — OpenClaw Plugin Redesign

## Goal

Rewrite the OpenClaw plugin to match the S12.1 boundary: credential holder + inbound notification channel only. Strip the execution layer. Upgrade transport if justified by S12.1's notification contract.

S12.3 can run in parallel with S12.2 (Agent Zero, representatives, workload honesty). Both depend only on S12.1's boundary being defined.

## Context

The current OpenClaw plugin was built as both transport and execution environment — it claims tasks, spawns subprocesses via `openclaw gateway call knotwork.execute_task`, and runs LLM calls inside the gateway request context. After S12.1 defines the plugin as notification-only, the execution code must be stripped and the plugin rewritten around its reduced role.

## In Scope

### 1. Transport decision

Informed by S12.1's notification contract, decide whether to upgrade from HTTP polling to WebSocket:

- If notification volume is low and ACK semantics are simple → keep HTTP polling (simpler, proven)
- If real-time delivery matters and ACK/replay/resume semantics are needed → upgrade to WebSocket

The decision must be recorded with rationale in this spec after S12.1 is complete.

### 2. If WebSocket is adopted

- Frame contract: auth/identify on connect, event dispatch (server → plugin), ACK/retry, keepalive/heartbeat
- Reconnect/resume: connection loss does not silently drop notifications
- Remove polling code for responsibilities that move to WebSocket

### 3. Auth-mode auto-resolution

Plugin startup resolves gateway auth strategy from OpenClaw runtime config:

- Strategy matrix: `none`, `token`, `password`, `trusted-proxy`
- `authAuto: true` default; optional config overrides
- Startup resolves strategy once, applies consistently

### 4. Unified `callGateway()` wrapper

- Applies resolved auth consistently across all gateway calls
- Retries once on auth errors with fallback strategy when safe
- Classifies failures into explicit codes: `AUTH_PASSWORD_MISSING`, `AUTH_INVALID`, `AUTH_MODE_UNSUPPORTED`, `AUTH_TRUSTED_PROXY_UNAVAILABLE`

### 5. Automatic credential recovery

- Startup handshake retries with backoff until success
- Auth failures during notification delivery trigger re-handshake automatically
- Stale credentials do not require manual restart as the primary recovery path

### 6. Degraded-state observability

- Explicit states: `connected`, `handshake_failed`, `auth_stale`, `gateway_unavailable`, `idle`
- Visible timestamps: last successful handshake, last notification received, last heartbeat
- Gateway auth diagnostics: detected auth mode, active strategy, last auth error code, next remediation suggestion

### 7. Strip execution layer

Remove from plugin:
- Task execution subprocess spawning (`openclaw gateway call knotwork.execute_task`)
- `subagent.run()` integration for task execution
- Concurrency management (`maxConcurrentTasks`, slot tracking)
- Claim loop and task lifecycle management beyond receiving notifications

### 8. Deployment guidance

- Reverse proxy / TLS configuration for long-lived WS connections (if WS chosen)
- Update install/deploy docs to reflect the final transport
- Document the new plugin role for operators migrating from the old model

## Explicitly Out of Scope

- Plugin boundary definition (→ S12.1, already settled)
- Agent Zero, representatives, workload honesty (→ S12.2)
- Re-adding execution capabilities to the plugin
- Long-term coexistence of polling + WS unless explicitly chosen as interim migration

## Acceptance Criteria

1. Plugin matches S12.1 boundary — credential + notification only, no execution code remains.
2. Transport decision is recorded with rationale.
3. No silent notification loss on transient backend/network failures.
4. Plugin recovers from routine disconnect or auth drift without requiring manual OpenClaw restart.
5. Operator-facing status/debug surfaces show explicit degraded-state diagnostics.
6. Auth failures surface with explicit error codes and remediation guidance.
7. Install/deploy docs match the final transport decision.
