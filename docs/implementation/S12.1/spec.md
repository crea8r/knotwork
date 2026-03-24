# Session 12.1 — OpenClaw Transport Upgrade (Post-S12 Re-evaluation)

## Goal

Re-evaluate whether the OpenClaw plugin should move from timer-driven HTTP polling to WebSocket after S12 has changed the plugin from an execution environment into an inbound communication path only. If the upgrade is still justified, replace the polling transport with WebSocket (or equivalent push model) and add full reliability semantics: reconnect, credential recovery, terminal-event replay/ACK, and degraded-state observability.

## Context

Before S12, the OpenClaw plugin uses a fixed timer (`taskPollIntervalMs`, default 2s) to call `POST /openclaw-plugin/pull-task`. Each poll also updates plugin liveness and capacity (`tasks_running`, `slots_available`) on the Knotwork side. When a task is returned, the runtime spawns `openclaw gateway call knotwork.execute_task --params ...`; the subprocess then executes the claimed task inside a gateway request context so OpenClaw APIs such as `subagent.run()` remain available.

That model made the WebSocket upgrade attractive because the plugin was both the transport and the execution environment.

After S12, the plugin/MCP split changes the decision surface:

- the OpenClaw plugin becomes the inbound Knotwork communication path only
- MCP becomes the agent -> Knotwork interaction surface
- the remaining plugin traffic pattern may be small enough that timer-driven HTTP is acceptable

S12.1 exists so the transport choice is made against the post-S12 architecture rather than the pre-S12 one.

## Decision Gate

Before implementation starts, confirm:

1. What messages still flow through the plugin after S12.
2. Whether the 2s timer remains materially noisy or operationally weak in that reduced role.
3. Whether explicit ACK/replay/resume semantics are still required for the remaining plugin-delivered events.
4. Whether WebSocket meaningfully improves operator visibility or delivery guarantees relative to simpler HTTP alternatives.

If the answer to those questions is "not enough benefit," S12.1 may be closed with a decision to keep HTTP polling.

## In Scope

1. Transport re-evaluation after the S12 MCP/plugin split.
   - confirm the plugin's post-S12 responsibilities
   - confirm whether polling remains a real problem
   - decide whether WebSocket is still justified
2. If justified, WebSocket frame contract between plugin and Knotwork:
   - plugin auth/identify on connect
   - plugin capacity + health updates over the same channel if still needed post-S12
   - task or event dispatch (server -> plugin)
   - plugin -> server event submission for whatever event classes remain in plugin scope
   - keepalive/heartbeat
   - ACK / retry semantics for terminal or otherwise durable events
   - reconnect / resume semantics so connection loss does not silently drop delivery
3. Auth-mode auto-resolution:
   - plugin startup resolves gateway auth strategy from OpenClaw runtime config
   - strategy matrix: `none`, `token`, `password`, `trusted-proxy`
   - `authAuto: true` default; optional config overrides available
4. Unified `callGateway(method, payload)` client wrapper:
   - applies resolved auth consistently across all gateway calls
   - retries once on auth errors with fallback strategy when safe
   - classifies failures into explicit codes: `AUTH_PASSWORD_MISSING`, `AUTH_INVALID`, `AUTH_MODE_UNSUPPORTED`, `AUTH_TRUSTED_PROXY_UNAVAILABLE`
5. Automatic credential recovery:
   - startup handshake retries with backoff until success
   - auth failures during dispatch/event submission trigger re-handshake automatically
   - stale credentials do not require manual restart as the primary recovery path
6. Degraded-state observability:
   - explicit states such as `connected`, `handshake_failed`, `auth_stale`, `gateway_unavailable`, `busy`, `idle`, `backlog`
   - visible timestamps: last successful handshake, last dispatch/poll, last terminal event submit
   - gateway auth diagnostics: detected auth mode, active strategy, last auth error code, next remediation suggestion
7. Deployment guidance:
   - reverse proxy / TLS configuration for long-lived WS connections if WS is chosen
   - update install/deploy docs to reflect the final transport requirements
8. Validation suite:
   - startup succeeds across supported gateway auth modes
   - plugin recovers from dropped connection without manual restart
   - durable events are not silently lost when transient backend/network failures occur
   - no regression in post-S12 plugin responsibilities

## Out of Scope

- Pre-S12 assumptions that the plugin remains the primary execution environment.
- Reworking the S12 MCP/plugin split itself.
- Long-term coexistence of polling + WS transports unless explicitly chosen as an interim migration strategy.

## Acceptance Criteria

1. S12.1 explicitly records whether WebSocket is adopted or rejected after evaluating the post-S12 architecture.
2. If WebSocket is adopted, the plugin communicates with Knotwork over WebSocket and polling is removed for the responsibilities that remain in plugin scope.
3. Durable events are not silently lost when transient backend/network failures occur.
4. Plugin recovers from routine disconnect or auth drift without requiring manual OpenClaw restart.
5. Operator-facing status/debug surfaces show explicit degraded-state diagnostics rather than only last-seen timestamps.
6. Auth failures surface with explicit error codes and remediation guidance.
7. Install/deploy docs match the final transport decision.
