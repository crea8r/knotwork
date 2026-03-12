# Session 8.2 — Cloud Deployment (Clean Install)

## Goal

Deploy Knotwork as a clean install on a remote server with a reproducible operator runbook.

## In Scope

1. Production deployment guide for one remote server (Docker compose profile: `prod`).
2. Environment/secrets checklist for production values.
3. Migration/upgrade procedure (`alembic upgrade head`) for first install and updates.
4. Reverse proxy and TLS guidance.
5. Smoke-test checklist after deployment.

## Explicitly Out of Scope

1. Workspace creation flow.
2. Notification system implementation.

## Acceptance Criteria

1. Fresh server can run Knotwork end-to-end via documented steps.
2. Existing S8.1 features work after deploy (auth, workflow runs, public trigger pages).
3. Restarting services does not require manual DB patching.
4. Documentation is sufficient for another operator to reproduce without tribal knowledge.

## Risks

1. Incomplete env setup (`JWT_SECRET`, API keys, `APP_BASE_URL`) causing runtime/auth issues.
2. OpenClaw reconnect confusion after restart (requires clear handshake/reconnect steps).
3. TLS/proxy misconfiguration breaking websocket or callback flows.
