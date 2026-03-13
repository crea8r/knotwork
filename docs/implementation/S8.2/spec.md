# Session 8.2 — Cloud Deployment (Clean Install)

## Goal

Deploy Knotwork as a clean install on a remote server with a reproducible operator runbook.

## In Scope

1. Production deployment guide for one remote server (Docker compose profile: `prod`).
2. Environment/secrets checklist for production values.
3. Migration/upgrade procedure (`alembic upgrade head`) for first install and updates.
4. Reverse proxy and TLS guidance.
5. Smoke-test checklist after deployment.
6. Settings IA cleanup for scope clarity: hide `Workspace` and `Notifications` tabs until S9.
7. Installer bootstrap support for default workflow import selection.
8. Single-command installer for owner bootstrap + host nginx setup + Let's Encrypt automation.

## Explicitly Out of Scope

1. Workspace creation flow.
2. Notification system implementation.

## Acceptance Criteria

1. Fresh server can run Knotwork end-to-end via documented steps.
2. Existing S8.1 features work after deploy (auth, workflow runs, public trigger pages).
3. Restarting services does not require manual DB patching.
4. Documentation is sufficient for another operator to reproduce without tribal knowledge.
5. Settings page only exposes tabs backed by shipped features in S8.2 (`Account`, `Members`, `Agents`).
6. Installer prompts owner identity and domain, bootstraps owner workspace, and preloads default workflows.

## Risks

1. Incomplete env setup (`JWT_SECRET`, API keys, `APP_BASE_URL`) causing runtime/auth issues.
2. OpenClaw reconnect confusion after restart (requires clear handshake/reconnect steps).
3. TLS/proxy misconfiguration breaking websocket or callback flows.

## Installer Default Workflow Candidates

The installer can let operators choose which starter workflows to import.
Current catalog seeds two workflows captured from existing production-like examples:

1. `landing-page-builder` (source graph id: `4e97e3dc-b57b-44ed-903a-565b4259c2b7`)
2. `simple-writing` (source graph id: `49552a7c-a337-49b4-b18a-089ef3e3e6b1`)

Implementation files:

1. `backend/knotwork/bootstrap/default_workflows.json` (catalog + definitions)
2. `backend/scripts/import_default_workflows.py` (list/select/import CLI for installer integration)

Handbook dependency behavior:

1. Importer reads each selected workflow's `knowledge_paths`.
2. Resolved files (including folder-scoped refs) are copied from source workspace into target workspace.
3. Transitive wiki-linked dependencies are imported via `load_knowledge_tree`.
4. Existing handbook files are preserved by default (optional overwrite flag available).

## Installer Flow (S8.2)

Primary script:

1. `scripts/install_s8_2.sh`

Bootstrap helper scripts:

1. `backend/scripts/bootstrap_owner.py`
2. `backend/scripts/import_default_workflows.py`

Installer behavior:

1. Prompt owner `name` + `email`.
2. Prompt server domain (`localhost` supported for local installs).
3. Write `.env` from `.env.docker.example` and inject required production values.
4. Start Docker stack with `docker compose --profile prod up -d --build`.
5. Configure host nginx reverse proxy for:
   - `/` -> frontend (`127.0.0.1:3000`)
   - `/api`, `/ws`, `/agent-api`, `/openclaw-plugin`, `/health` -> backend (`127.0.0.1:8000`)
6. For non-local domains, gate on DNS readiness and run Let's Encrypt (`certbot --nginx`).
7. Create/reuse owner user + owner workspace membership directly in DB bootstrap script.
8. Import both default workflows by default:
   - `landing-page-builder`
   - `simple-writing`
9. Import handbook dependencies for selected workflows.
