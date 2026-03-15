# Session 8.1 — Early Adopter Sharing

## What Was Built

### A. Docker — Full-stack compose

**New files:**
- `Dockerfile.backend` — Python 3.12-slim; runs uvicorn API or arq worker (different CMD)
- `Dockerfile.frontend` — multi-stage: build stage (Node 20) → nginx prod / vite dev
- `docker-compose.yml` — extended with two profiles: `dev` (hot-reload, volume mounts) + `prod` (built images)
- `.env.docker.example` — template for Docker env vars (DB/Redis auto-configured by compose)

**Usage:**
```bash
# Dev mode (hot reload, edit files locally)
cp .env.docker.example .env && vim .env  # fill in API keys + SMTP
docker compose --profile dev up

# Prod mode (built images, share with friends)
docker compose --profile prod up
```

The backend entrypoint runs `alembic upgrade head` before starting uvicorn, so migrations apply automatically.

### B. OpenClaw Plugin — Agent-triggered install + description field

**New backend endpoint:** `GET /openclaw-plugin/install?token=<handshake_token>`
- Public endpoint (no JWT required, only validates the token exists + isn't expired)
- Returns: `{ install_command, setup_url, config_snippet, instructions, plugin_package, knotwork_base_url, token }`
- This endpoint is a setup bundle, not the plugin artifact itself
- The OpenClaw agent fetches this URL and follows the returned instructions to configure the plugin after installing the published package

**Frontend:** "Copy setup URL" button added to Settings → Agents → OpenClaw plugin connection section. URL format: `<backend-origin>/openclaw-plugin/install?token=<token>`

**Agent description field:**
- `RemoteAgent.description?: string` added to plugin `types.ts`
- `normalizeAgent()` in `bridge.ts` picks `description ?? about ?? shortDescription ?? summary`
- `openclaw_remote_agents.description` DB column added (nullable, max 500 chars)
- Displayed in Settings → Agents → Discovered Agents section

**npm publish:** Plugin `package.json` updated: `private: false`, `publishConfig: { access: 'public' }`, `files: [dist, openclaw.plugin.json]`, `prepublishOnly: npm run build`

### C. Auth — Magic link (passwordless, own SMTP)

**No passwords.** Login = receive email with 15-min one-time token → click link → JWT issued (30-day TTL).

**New files:**
- `backend/knotwork/auth/service.py` — `create_access_token()`, `decode_access_token()`, `create_magic_link_token()`, `consume_magic_link_token()`
- `backend/knotwork/auth/deps.py` — `get_current_user()` (JWT bearer), `get_workspace_member()`, `require_owner()`
- `backend/knotwork/auth/models.py` — added `UserMagicToken` model (id, user_id FK, token, expires_at, used)

**Updated `auth/router.py`:**
- `POST /api/v1/auth/magic-link-request` — `{ email }` → sends magic link email for existing users; unknown email returns 404
- `POST /api/v1/auth/magic-link-verify` — `{ token }` → JWT
- `GET /api/v1/auth/me` — current user (requires JWT)
- `POST /api/v1/auth/logout` — no-op (JWT discarded client-side)

**Config additions:** `smtp_host`, `smtp_port`, `smtp_user`, `smtp_password`, `frontend_url`, `auth_dev_bypass_user_id`

**Dev bypass:** If `AUTH_DEV_BYPASS_USER_ID=<uuid>` is set, all requests authenticate as that user without JWT. This keeps existing integration tests passing without auth wiring.

### D. Multi-user Workspace — Invitations

**New files:**
- `backend/knotwork/workspaces/invitations/models.py` — `WorkspaceInvitation` (id, workspace_id, invited_by, email, role, token, expires_at, accepted_at)
- `backend/knotwork/workspaces/invitations/schemas.py` — CreateInvitationRequest, InvitationOut, InvitationVerifyOut, AcceptInvitationRequest, AcceptInvitationOut
- `backend/knotwork/workspaces/invitations/service.py` — create (sends email), list, verify, accept (upserts user + member, returns JWT)
- `backend/knotwork/workspaces/invitations/router.py` — protected + public invitation endpoints

**Endpoints:**
- `POST /api/v1/workspaces/{id}/invitations` — create invitation (owner only)
- `GET /api/v1/workspaces/{id}/invitations` — list invitations (owner only)
- `GET /api/v1/auth/invitations/{token}` — verify token (public)
- `POST /api/v1/auth/invitations/{token}/accept` — accept: `{ name }` → creates user + member + JWT (public)

**Invitation TTL:** 7 days. Sends email via `notifications/channels/email.py` `send()` directly (not through dispatcher).

### E. Frontend

**New pages:**
- `LoginPage.tsx` — email → magic link request → "Check your email" state
- `AcceptInvitePage.tsx` — handles both `?token=` (invite) and `?magic=` (login) params

**New component:** `RequireAuth.tsx` — redirects to `/login` if no JWT in auth store

**Updated `App.tsx`:** Added `/login` + `/accept-invite` public routes; wrapped all other routes in `<RequireAuth>`

**Updated `store/auth.ts`:** Added `user: UserInfo | null` field; `login()` action; `setAuth()` for legacy compat

**Updated `api/client.ts`:** Reads token from `useAuthStore.getState().token` (Zustand) instead of raw localStorage

**New `api/auth.ts`:** `useRequestMagicLink`, `useVerifyMagicLink`, `useGetInvitation`, `useAcceptInvitation`, `useMe`, `useWorkspaceInvitations`, `useCreateInvitation`

**New `MembersTab.tsx`:** Real invitation list + invite form (owner only); replaces mock data in SettingsPage

**Updated `AgentsTab.tsx`:** "Copy setup URL" button, agent description display

### F. Roadmap

- `docs/implementation/roadmap.md` updated: new S8.1 (this session) + S8.2 (cloud deploy) + S9 adjusted
- `docs/gitflow.md` created

---

## Database Migrations (in order)

```
a9b8c7d6e5f4 (existing HEAD)
  ↓
f1e2d3c4b5a6_s8_1_agent_description    — adds openclaw_remote_agents.description
  ↓
b2c3d4e5f6a7_s8_1_auth_invitations     — adds user_magic_tokens + workspace_invitations
```

Run: `cd backend && alembic upgrade head`

---

## Key Design Decisions

1. **Magic link only, no passwords.** Users with `hashed_password = "!no-password"` can only authenticate via magic link. The column is kept for schema compatibility.
2. **Dev bypass via env var.** `AUTH_DEV_BYPASS_USER_ID` allows development and CI testing without implementing full auth flows in every test.
3. **Invitation email is best-effort.** If SMTP fails, the invitation row is still saved — the owner can resend or share the URL manually.
4. **JWT TTL 30 days.** Long TTL is appropriate for early adopters (no frequent re-logins). Can be tuned later.
5. **Install endpoint is public.** The handshake token itself is the auth material. Anyone with the token URL can fetch install instructions, but the token is workspace-scoped and expires in 365 days.
6. **No breaking changes to existing routes.** JWT enforcement is additive: `get_current_user()` is only added to routes where auth makes sense; the `AUTH_DEV_BYPASS_USER_ID` bypass keeps tests green.

---

## Files Created / Modified

### Backend
- `knotwork/auth/models.py` — added `UserMagicToken`
- `knotwork/auth/router.py` — implemented magic link endpoints + /me
- `knotwork/auth/service.py` — **NEW**
- `knotwork/auth/deps.py` — **NEW**
- `knotwork/config.py` — added SMTP + frontend_url + auth_dev_bypass_user_id
- `knotwork/main.py` — wired invitations router + install router + model imports
- `knotwork/openclaw_integrations/install_router.py` — **NEW**
- `knotwork/openclaw_integrations/models.py` — added description column
- `knotwork/openclaw_integrations/schemas.py` — added description field
- `knotwork/openclaw_integrations/service.py` — persist + return description
- `knotwork/workspaces/invitations/__init__.py` — **NEW**
- `knotwork/workspaces/invitations/models.py` — **NEW**
- `knotwork/workspaces/invitations/schemas.py` — **NEW**
- `knotwork/workspaces/invitations/service.py` — **NEW**
- `knotwork/workspaces/invitations/router.py` — **NEW**
- `alembic/versions/f1e2d3c4b5a6_s8_1_agent_description.py` — **NEW**
- `alembic/versions/b2c3d4e5f6a7_s8_1_auth_invitations.py` — **NEW**

### Frontend
- `src/store/auth.ts` — added UserInfo, login(), fixed setAuth()
- `src/api/client.ts` — reads token from Zustand store
- `src/api/auth.ts` — **NEW**
- `src/api/agents.ts` — added description? to OpenClawRemoteAgent
- `src/pages/LoginPage.tsx` — **NEW**
- `src/pages/AcceptInvitePage.tsx` — **NEW**
- `src/App.tsx` — added /login, /accept-invite, RequireAuth wrapper
- `src/components/shared/RequireAuth.tsx` — **NEW**
- `src/components/settings/MembersTab.tsx` — **NEW** (real data + invite form)
- `src/components/settings/AgentsTab.tsx` — setup URL button + description display

### Plugin
- `openclaw-plugin-knotwork/src/types.ts` — added description to RemoteAgent
- `openclaw-plugin-knotwork/src/bridge.ts` — pick description in normalizeAgent
- `openclaw-plugin-knotwork/package.json` — npm publish config
- `openclaw-plugin-knotwork/.npmignore` — **NEW**

### Docker
- `Dockerfile.backend` — **NEW**
- `Dockerfile.frontend` — **NEW**
- `docker-compose.yml` — extended with full-stack services
- `.env.docker.example` — **NEW**

### Docs
- `docs/implementation/roadmap.md` — updated S8.1/S8.2/S9
- `docs/gitflow.md` — **NEW**

---

## S8.1 Extension — Public Workflow Run Trigger (MVP)

### Goal

Allow workspace owners to publish a workflow to a secret-link public page so external experts can try the workflow without signing in.

### Product rules (confirmed)

1. Scope stays inside **S8.1** (early-adopter value validation).
2. A workflow can have **multiple public links**, including links pinned to different workflow versions.
3. Public URL shape is fixed:
   - `/public/workflows/{token}`
   - `/public/runs/{token}`
4. Access is **secret-token only** (no login required).
5. Publish/unpublish/edit is **owner only**.
6. Workflow public description is required:
   - max length `1000`
   - markdown allowed
   - edited with current markdown WYSIWYG editor
7. Public trigger form uses the same `input_schema` as internal run trigger.
8. Public run page shows only:
   - workflow description
   - submitted input
   - final output
   - if final output is not ready: "system is working on it" state
   - if run is aborted before final output: keep pending/aborted state and send email notification to subscribed email
9. Public pages must hide intermediate node logs, tool traces, internal metadata, and other non-final artifacts.
10. Public trigger endpoint has basic rate limit, and UI displays the limit clearly.
11. Public page UI must clearly state:
   - this is a test/preview experience
   - usage will be charged in the future

### Existing version support (current system)

- `graph_versions` already stores workflow versions.
- `runs.graph_version_id` already pins each run to the exact executed version.
- MVP publish links can therefore be tied to:
  - latest version at trigger time, or
  - an explicit `graph_version_id` at publish time (recommended for stable expert trials).

### Backend additions

1. Data model: public workflow publish entity
   - `id` (uuid)
   - `workspace_id` (uuid FK)
   - `graph_id` (uuid FK)
   - `graph_version_id` (uuid FK, nullable for "latest")
   - `token` (string, unique, secret)
   - `description_md` (text, required, max 1000 chars)
   - `status` (`active` | `disabled`)
   - `created_by` (uuid FK user)
   - `created_at`, `updated_at`

2. Data model: public run share entity
   - `id` (uuid)
   - `workspace_id` (uuid FK)
   - `run_id` (uuid FK)
   - `public_workflow_id` (uuid FK)
   - `token` (string, unique, secret)
   - `email` (nullable, for completion notification)
   - `notified_at` (nullable)
   - `created_at`

3. Owner-protected endpoints
   - `POST /api/v1/workspaces/{workspace_id}/graphs/{graph_id}/public-links`
   - `GET /api/v1/workspaces/{workspace_id}/graphs/{graph_id}/public-links`
   - `PATCH /api/v1/workspaces/{workspace_id}/graphs/{graph_id}/public-links/{id}`
   - `POST /api/v1/workspaces/{workspace_id}/graphs/{graph_id}/public-links/{id}/disable`

4. Public endpoints (token auth)
   - `GET /api/v1/public/workflows/{token}`: description + input schema + rate-limit hint + legal notice flags
   - `POST /api/v1/public/workflows/{token}/trigger`: create run + create public run token + optional email capture
   - `GET /api/v1/public/runs/{token}`: description + submitted input + final output-or-pending state only

5. Rate limiting
   - Basic IP + token limiter on `POST /public/workflows/{token}/trigger`
   - Return `429` with retry hint
   - Expose limit information for UI display (for example via response headers + payload field)

6. Notification
   - If trigger request includes `email`, send completion email when final output arrives.
   - If a public run is aborted (`status = stopped`) before final output, send an aborted email to subscribed email.
   - Initial MVP uses existing email channel path (best effort).

### Frontend additions

1. Owner workflow management UI
   - Add "Public links" section on workflow detail page.
   - Owner can create link, choose version behavior, and must enter description via markdown WYSIWYG.
   - Owner can edit description and disable a link.

2. Public workflow page (`/public/workflows/:token`)
   - Shows:
     - markdown-rendered description
     - clear "test preview / future paid usage" notice
     - clear trigger rate-limit notice
     - run trigger form generated from workflow `input_schema`

3. Public run page (`/public/runs/:token`)
   - Shows only:
     - markdown-rendered workflow description
     - submitted input
     - final output, or pending state text
   - Optional email form appears while pending if email not already provided.

### Security and privacy constraints

1. Secret token is bearer credential; generate high-entropy random tokens.
2. Public responses never expose:
   - node-by-node timeline
   - agent logs
   - tool call details
   - escalation internals
   - workspace/member metadata
3. Disabled/invalid token returns `404` (do not leak existence).
4. Output rendering should stay markdown-safe and consistent with existing sanitizer.

### Out of scope for this MVP

1. Payment collection or billing enforcement.
2. Advanced anti-abuse controls (CAPTCHA, WAF rules, reputation scoring).
3. Full analytics dashboard for public link conversion.
