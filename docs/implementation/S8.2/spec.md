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
10. OpenClaw connection hardening for deployed installs:
   - plugin persists `pluginInstanceId` and `integrationSecret` locally
   - routine OpenClaw restart does not require a fresh handshake token
   - plugin automatically re-handshakes on backend `401 Invalid plugin credentials`
   - operator has a documented reset/re-pair flow when intentionally starting over

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
7. Uninstaller creates a zip backup including manifest metadata, a PostgreSQL dump, and the handbook archive before destructive cleanup.
8. Routine OpenClaw restart/reload reuses persisted plugin credentials and does not require generating a new handshake token.

## Risks

1. Incomplete env setup (`JWT_SECRET`, API keys, `APP_BASE_URL`) causing runtime/auth issues.
2. OpenClaw reconnect confusion after restart (requires clear handshake/reconnect steps).
3. TLS/proxy misconfiguration breaking websocket or callback flows.
4. Plugin local state loss causing accidental re-pair attempts if reset flow is undocumented.

## Database Migration Policy

1. Alembic history is intentionally reset to a single clean baseline for S8.2 installs.
2. Fresh installs are supported via the new baseline only.
3. Pre-reset dev databases are not migration-upgraded through historical revisions; they are stamped to the new baseline if the schema already exists.
4. Installer validation target: no fresh install should hit duplicate-table errors from legacy revisions.

## Installer Default Workflow Candidates

The installer can let operators choose which starter workflows to import.
Current catalog seeds two workflows captured from existing production-like examples:

1. `landing-page-builder` (source graph id: `4e97e3dc-b57b-44ed-903a-565b4259c2b7`)
2. `simple-writing` (source graph id: `49552a7c-a337-49b4-b18a-089ef3e3e6b1`)

Implementation files:

1. `backend/knotwork/bootstrap/default_workflows.json` (catalog + definitions)
2. `backend/knotwork/bootstrap/handbook/` (self-contained sample handbook content)
3. `backend/knotwork/bootstrap/handbook_manifest.json` (handbook titles/metadata)
4. `backend/scripts/import_default_workflows.py` (list/select/import CLI for installer integration)

Handbook dependency behavior:

1. Importer reads each selected workflow's bootstrap `handbook_paths`.
2. Resolved files are loaded from the in-repo bootstrap handbook pack under `backend/knotwork/bootstrap/handbook/`.
3. Transitive wiki-linked dependencies are imported from that same bootstrap pack.
4. Existing handbook files are preserved by default (optional overwrite flag available).

## Installer Flow (S8.2)

Primary script:

1. `scripts/install_s8_2.sh`
2. `scripts/uninstall_s8_2.sh`
3. `scripts/promote_localhost_to_public.sh`

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
   - Backend startup uses `backend/scripts/migrate_or_stamp.py` to run the clean baseline on empty DBs and stamp legacy pre-reset dev DBs.
7. For non-local domains only, require preinstalled host `nginx` + `certbot`, then configure nginx reverse proxy for:
   - `/` -> frontend (`127.0.0.1:<FRONTEND_HOST_PORT>`)
   - `/api`, `/api/v1/ws`, `/ws`, `/agent-api`, `/openclaw-plugin`, `/health` -> backend (`127.0.0.1:<BACKEND_HOST_PORT>`)
8. For non-local domains, gate on DNS readiness and run Let's Encrypt (`certbot --nginx`).
9. For `localhost`, skip nginx/certbot entirely and use direct frontend/backend host ports.
10. Create/reuse owner user + owner workspace membership directly in DB bootstrap script.
11. Import both default workflows by default:
   - `landing-page-builder`
   - `simple-writing`
12. Import handbook dependencies for selected workflows.

Promotion behavior:

1. `scripts/promote_localhost_to_public.sh` upgrades an existing localhost install to a public domain without replacing data.
2. Requires an existing `.env` with localhost `APP_BASE_URL`.
3. Prompts for public domain, owner email, `RESEND_API`, and `EMAIL_FROM`.
4. Rewrites `.env` for public mode:
   - `APP_BASE_URL=https://<domain>`
   - `VITE_API_URL=https://<domain>/api/v1`
   - `AUTH_DEV_BYPASS_USER_ID=` (cleared)
5. Rebuilds/restarts the production stack, preserving the existing database and handbook files.
6. Configures host nginx, waits for DNS, requests Let's Encrypt TLS, and runs basic health checks.

Uninstaller behavior:

1. Create a timestamped backup zip outside the project directory.
2. Include manifest metadata, a `pg_dump` SQL export, and the handbook archive only. Do not back up the source tree.
3. Tear down project Docker containers/networks/volumes and remove local project images.
4. Support `runtime` cleanup (generated files only) and `full` cleanup (remove project tree contents except `.git`).

## OpenClaw Persistent Connection State

For S8.2 deployed installs, the Knotwork OpenClaw plugin now persists connection bootstrap state locally on the OpenClaw side.

Stored locally:

1. `pluginInstanceId`
2. `integrationSecret`

Behavior:

1. On normal OpenClaw restart, the plugin reuses the persisted `integrationSecret` and continues pulling tasks without requiring a new handshake token.
2. If backend rejects plugin auth with `401 Invalid plugin credentials`, the plugin clears the persisted secret and automatically attempts a fresh handshake using the configured handshake token.
3. If the operator intentionally wants to start over, the plugin connection can be reset locally and re-paired without editing the database.

Operational guidance:

1. Treat the handshake token as a pairing bootstrap credential, not the normal runtime credential.
2. Prefer a stable `pluginInstanceId` in OpenClaw config for predictable recovery.
3. For deliberate re-pair/reset, clear the local plugin connection state first, then handshake again.

Reset / start-over flow:

1. In OpenClaw, run `openclaw gateway call knotwork.reset_connection`
2. Restart OpenClaw plugin/runtime
3. Trigger `openclaw gateway call knotwork.handshake`
4. If the original handshake token is no longer valid for the intended reset path, generate a fresh token from Knotwork Settings → Agents and use that for the new pairing
