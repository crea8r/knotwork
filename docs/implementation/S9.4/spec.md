# Session 9.4 — OpenClaw Transport Upgrade

## Goal

Replace the polling-based OpenClaw task transport with WebSocket (or equivalent push model) with full reliability semantics — reconnect, credential recovery, event replay, and degraded-state observability.

## Context

The current OpenClaw plugin pulls tasks by polling `POST /openclaw-plugin/pull-task` on a fixed interval. This works but generates constant idle traffic, has no recovery path for dropped connections or stale credentials beyond manual plugin restart, and cannot distinguish "idle" from "broken."

This session is a direct replacement — no long-term coexistence of polling + WS.

## In Scope

1. WebSocket frame contract between plugin and Knotwork:
   - plugin auth/identify on connect
   - task dispatch (server → plugin)
   - task event submission: `log`, `completed`, `escalation`, `failed` (plugin → server)
   - keepalive/heartbeat
   - ACK / retry semantics: terminal events (`completed`, `escalation`, `failed`) must be acknowledged by backend; plugin retries until ACK received
   - reconnect / resume: plugin restart or network blip must not orphan a claimed task
2. Auth-mode auto-resolution:
   - plugin startup resolves gateway auth strategy from OpenClaw runtime config
   - strategy matrix: `none` → no auth headers; `token` → token only; `password` → password (+ token if required); `trusted-proxy` → delegated identity or fail with actionable message
   - `authAuto: true` default — plugin auto-detects mode; optional config overrides available
   - plugin config schema additions: `gatewayAuthMode`, `gatewayPassword`, `gatewayToken`, `authAuto`
3. Unified `callGateway(method, payload)` client wrapper:
   - applies resolved auth consistently across all gateway calls
   - retries once on auth errors with fallback strategy when safe
   - classifies failures into explicit codes: `AUTH_PASSWORD_MISSING`, `AUTH_INVALID`, `AUTH_MODE_UNSUPPORTED`, `AUTH_TRUSTED_PROXY_UNAVAILABLE`
   - no scattered auth/header logic across plugin modules
4. Automatic credential recovery:
   - startup handshake retries with backoff until success
   - auth failures during dispatch/event submission trigger re-handshake automatically
   - stale credentials do not require manual restart as the primary recovery path
5. Degraded-state observability — 7 explicit states visible in operator-facing debug surfaces:
   - `connected`, `handshake_failed`, `auth_stale`, `gateway_unavailable`, `busy`, `idle`, `backlog`
   - visible timestamps: last successful handshake, last task pull, last terminal event submit
   - gateway auth diagnostics: detected auth mode, active strategy, last auth error code, next remediation suggestion
   - queue diagnostics distinguish: task pending (no plugin claimed it) vs task pending (plugin at capacity) vs task pending (bootstrap unhealthy)
6. `/openclaw-plugin/install` payload update:
   - always returns `knotworkBaseUrl` and `handshakeToken`
   - may include `gatewayAuthMode` hint where safe/useful
   - must never force insecure defaults or fake credentials into the generated config
7. Persist recovered runtime gateway strategy safely:
   - cache resolved auth strategy/mode
   - do not persist raw gateway secrets unless strictly necessary
   - if secrets must be persisted, document scope and storage guarantees
8. Deployment guidance:
   - reverse proxy / TLS configuration for long-lived WS connections (idle timeout, proxy_read_timeout, upgrade headers)
   - update install/deploy docs to reflect WS requirements
9. Validation suite:
   - fresh startup succeeds across all gateway auth modes: `none`, `token`, `password`, `trusted-proxy`
   - plugin recovers from dropped connection without manual restart
   - terminal events are not lost when transient backend/network failures occur
   - reduced idle request noise vs polling baseline
   - no regression in run completion or escalation handling
   - auth-mode mismatch surfaces a clear diagnostic, not an opaque websocket error

## Out of Scope

- Concurrency upgrade (default 2 tasks/agent) — already delivered in S9.
- Collaborative run-context participant addressing — S9.1.
- Long-term coexistence of polling + WS transports.

## Acceptance Criteria

1. OpenClaw communicates with Knotwork backend via WebSocket; polling is removed.
2. Plugin recovers from routine disconnect or auth drift without requiring manual OpenClaw restart.
3. Terminal task events (`completed`, `escalation`, `failed`) are not silently lost when transient backend/network failures occur.
4. Operator-facing status/debug surfaces show explicit state: connected, degraded, busy, backlogged — not just last-seen timestamp.
5. Gateway auth mode is auto-detected on startup; manual config overrides are supported but not required.
6. Auth failures surface with explicit error codes and remediation guidance, not opaque WS errors.
7. Plugin install payload includes all fields needed for mode-aware WS setup.
8. Reverse proxy / TLS configuration guidance is documented for deployed installs.
