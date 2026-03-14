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
9. Backup-first uninstaller for Docker teardown and file cleanup.

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
7. Uninstaller creates a zip backup including a PostgreSQL dump before destructive cleanup.

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
2. `scripts/uninstall_s8_2.sh`

Bootstrap helper scripts:

1. `backend/scripts/bootstrap_owner.py`
2. `backend/scripts/import_default_workflows.py`

Installer behavior:

1. Prompt owner `name` + `email`.
2. Prompt server domain (`localhost` supported for local installs).
3. Write `.env` from `.env.docker.example` and inject required production values.
4. Ask operator-selected host ports for backend/frontend (no hardcoded `8000`/`3000` assumption).
5. Keep postgres/redis internal to Docker network (no host port exposure in installer path).
6. Start Docker stack with `docker compose --profile prod up -d --build`.
7. Configure host nginx reverse proxy for:
   - `/` -> frontend (`127.0.0.1:<FRONTEND_HOST_PORT>`)
   - `/api`, `/api/v1/ws`, `/ws`, `/agent-api`, `/openclaw-plugin`, `/health` -> backend (`127.0.0.1:<BACKEND_HOST_PORT>`)
8. For non-local domains, gate on DNS readiness and run Let's Encrypt (`certbot --nginx`).
9. Create/reuse owner user + owner workspace membership directly in DB bootstrap script.
10. Import both default workflows by default:
   - `landing-page-builder`
   - `simple-writing`
11. Import handbook dependencies for selected workflows.

Uninstaller behavior:

1. Create a timestamped backup zip outside the project directory.
2. Include project files plus a `pg_dump` SQL export.
3. Tear down project Docker containers/networks/volumes and remove local project images.
4. Support `runtime` cleanup (generated files only) and `full` cleanup (remove project tree contents except `.git`).
