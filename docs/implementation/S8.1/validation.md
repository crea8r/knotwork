# Session 8.1 — Visual Validation Checklist

Run after `docker compose --profile dev up` and migrations.

---

## A. Docker

### A1. Dev stack starts
- Run: `docker compose --profile dev up`
- ✅ Pass: All 5 services start (`postgres`, `redis`, `backend-dev`, `worker-dev`, `frontend-dev`). Backend logs show `alembic upgrade head` completing then `Application startup complete`.
- ❌ Fail: Any service exits with non-zero code. Check logs with `docker compose logs <service>`.

### A2. Frontend reachable
- Open: `http://localhost:3000`
- ✅ Pass: App loads (redirects to `/login`).
- ❌ Fail: Browser shows "Connection refused" or 502.

### A3. Backend health
- Open: `http://localhost:8000/health`
- ✅ Pass: JSON with `"status": "ok"` and `"database": { "status": "ok" }`.
- ❌ Fail: 503 or `"status": "degraded"`.

### A4. Hot reload works (dev profile)
- Edit any `.py` file in `backend/knotwork/`
- ✅ Pass: Backend logs show "Detected change" and reload within 2 seconds.
- ❌ Fail: No reload; must restart container.

---

## B. Login (magic link)

### B1. Login page renders
- Go to: `http://localhost:3000/login`
- ✅ Pass: "Sign in with a magic link" form with email input is visible.
- ❌ Fail: Blank page or error.

### B2. Protected routes redirect to login
- Go to: `http://localhost:3000/inbox` (not logged in)
- ✅ Pass: Redirected to `/login`.
- ❌ Fail: Page loads without auth or shows 401 error.

### B3. Magic link request (existing user)
- Pre-condition: A `users` row exists in DB. Can create via `POST /api/v1/auth/invitations/{token}/accept` (see B5) or directly via psql.
- Action: Enter email → Submit
- ✅ Pass: "Check your email" state shown. 202 in network tab.
- ❌ Fail: 4xx error or no state change.

### B4. Magic link verify
- From B3: Click the link in the email (or copy token from DB `user_magic_tokens` table)
- `GET http://localhost:3000/accept-invite?magic=<token>`
- ✅ Pass: Redirected to `/inbox`. Token present in localStorage under `knotwork_auth`.
- ❌ Fail: 401 or loop back to login.

---

## C. Workspace invitations

### C1. Invite form appears for owner
- Pre-condition: Logged in as a user with `role = 'owner'` in `workspace_members`
- Go to: Settings → Members tab
- ✅ Pass: "+ Invite member" button visible. Clicking it shows email + role form.
- ❌ Fail: Tab loads but no invite button (could mean role != owner).

### C2. Send invitation
- Fill form: email = `friend@example.com`, role = Operator → Send
- ✅ Pass: Success banner "Invitation sent to friend@example.com". Row appears in invitation list with "Pending" badge.
- ❌ Fail: 4xx error or no row added. Check SMTP config in `.env`.

### C3. Accept invitation (new user flow)
- Open the invite link in a new browser: `http://localhost:3000/accept-invite?token=<token>`
  (copy token from DB `workspace_invitations.token` or invitation email)
- ✅ Pass: "Join <workspace>" form with email pre-filled. Enter name → "Accept invitation" → redirected to `/inbox`.
- ❌ Fail: "Invalid or expired invitation" immediately (check `expires_at` in DB).

### C4. Already accepted
- Re-open the same invite link
- ✅ Pass: "Invitation already accepted" message shown.
- ❌ Fail: Allows re-acceptance or 500 error.

---

## D. OpenClaw plugin setup URL

### D1. Setup URL visible after token generation
- Settings → Agents → "Generate handshake token" → wait for response
- ✅ Pass: Two buttons visible: "Copy token" and "Copy setup URL". Below buttons: token + setup URL shown in the gray box.
- ❌ Fail: Only "Copy token" button, no setup URL.

### D2. Setup endpoint returns JSON
- Generate a token, then open: `http://localhost:8000/openclaw-plugin/install?token=<token>`
- ✅ Pass: JSON with `install_command`, `setup_url`, `config_snippet`, `instructions`, `plugin_package`, `knotwork_base_url`.
- ❌ Fail: 404 or 500.

### D3. Invalid token rejected
- Open: `http://localhost:8000/openclaw-plugin/install?token=invalid`
- ✅ Pass: 404 response.
- ❌ Fail: 200 with empty data or 500.

---

## E. Agent description

### E1. Description flows from plugin handshake
- Plugin source: add `description` to a remote agent payload in the handshake request body
- Manually POST to `/openclaw-plugin/handshake` with an agent that has `description: "Handles customer research"`
- ✅ Pass: After handshake, `openclaw_remote_agents.description = "Handles customer research"` in DB.
- ❌ Fail: `description` is NULL in DB.

### E2. Description shows in UI
- Settings → Agents → OpenClaw bridge debug → select integration → Discovered Agents
- ✅ Pass: Agent card shows description text below the display name.
- ❌ Fail: Only display_name and slug shown.

---

## F. Regression (existing tests still pass)

- Run: `cd backend && pytest ../docs/implementation/ -v`
- ✅ Pass: All prior tests pass (or are marked xfail with documented reasons). 0 unexpected failures.
- ❌ Fail: Previously passing tests now fail.

---

## G. Public workflow trigger pages (MVP extension)

### G1. Owner can create public link with required description
- Pre-condition: logged in as workspace `owner`, workflow exists with valid `input_schema`
- Open workflow detail → Public links → Create link
- Enter markdown description (non-empty, <= 1000 chars), choose version behavior, save
- ✅ Pass: Link row appears with public workflow URL, status `active`
- ❌ Fail: Create succeeds without description, or allows >1000 chars

### G2. Non-owner cannot publish
- Pre-condition: logged in as `operator`
- Try to create/edit/disable public link
- ✅ Pass: 403 and UI hides/disables owner-only controls
- ❌ Fail: Operator can publish or edit public links

### G3. Public workflow page renders description + trigger panel only
- Open public URL: `http://localhost:3000/public/workflows/<token>`
- ✅ Pass: page shows markdown description, trigger form (from `input_schema`), "test/future paid" notice, and rate-limit notice
- ❌ Fail: page leaks internal workspace info, node list, or operator controls

### G4. Trigger creates public run and redirects
- Submit valid input from G3
- ✅ Pass: run is triggered and browser redirects to `http://localhost:3000/public/runs/<token>`
- ❌ Fail: no redirect or redirect uses authenticated/internal run route

### G5. Public run page only exposes allowed fields
- On `/public/runs/<token>`
- ✅ Pass: only workflow description, submitted input, and final output are shown
- ❌ Fail: page shows logs, node timeline, tool traces, escalation details, or workspace metadata

### G6. Pending state + email capture
- Trigger run that takes noticeable time or intentionally delays final output
- ✅ Pass: run page shows "system is working on it" pending state and allows email input for completion notification
- ❌ Fail: pending run appears as error, or no email capture option appears

### G7. Completion email is sent (best effort)
- In G6, provide a reachable email
- Wait for run completion
- ✅ Pass: completion email is sent once final output exists
- ❌ Fail: no email attempt after completion (check backend logs / notification channel)

### G7.1 Aborted run email is sent (best effort)
- In G6, provide a reachable email, then abort the run before final output is produced
- ✅ Pass: aborted email is sent to subscribed address; run page remains without final output
- ❌ Fail: no email attempt after abort

### G8. Rate limit is enforced and visible
- Rapidly trigger the same public workflow repeatedly from one IP
- ✅ Pass: after threshold, API returns `429`; UI clearly communicates limit and retry guidance
- ❌ Fail: unlimited triggers or hidden/unclear limit behavior

### G9. Disabled/invalid token behavior
- Disable a public link (owner flow) and open its URL; also test random token
- ✅ Pass: both return 404-style not-found UX (no token existence leakage)
- ❌ Fail: endpoint reveals whether token exists but disabled
