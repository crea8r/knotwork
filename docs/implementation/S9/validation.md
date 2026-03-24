# Session 9 — Manual Validation Checklist

## Install / Session-State Hardening

Run the backend and frontend locally (`uvicorn knotwork.main:app --reload` + `npm run dev`), then follow the steps below. Each item has a ✅ pass and ❌ fail condition.

---

### 1. `/health` exposes `installation_id`

**Steps:**
```bash
curl http://localhost:8000/health | jq .installation_id
```

✅ **Pass:** Returns a non-empty UUID string (e.g. `"a1b2c3d4-..."`).
❌ **Fail:** Field is missing, null, or not a valid UUID.

---

### 2. `installation_id` persists across server restarts

**Steps:**
1. Note the `installation_id` from step 1.
2. Stop and restart the backend.
3. Run the curl again.

✅ **Pass:** Same UUID returned after restart.
❌ **Fail:** A different UUID each restart (file not persisted).

---

### 3. `installation_id` changes after a fresh install

**Steps:**
1. Stop the backend.
2. Delete `backend/data/.installation_id`.
3. Restart the backend.
4. Run the curl again.

✅ **Pass:** A new, different UUID is returned.
❌ **Fail:** Same UUID as before (old file survived or was not cleared).

---

### 4. `installation_id` is stored in the browser after first login

**Steps:**
1. Open browser DevTools → Application → Local Storage → `http://localhost:5173`.
2. Log in (or let localhost auto-bootstrap).
3. Inspect the `knotwork_auth` key.

✅ **Pass:** `installationId` field is present and matches what `GET /health` returns.
❌ **Fail:** Field is missing or `null`.

---

### 5. Installation drift is detected after a fresh backend install

**Steps:**
1. Log in normally — `installationId` is stored in localStorage.
2. Stop the backend.
3. Delete `backend/data/.installation_id` (simulates fresh install / DB reset).
4. Restart the backend.
5. Reload the browser tab without clearing localStorage.

✅ **Pass:** Browser detects the mismatch, clears auth state, and redirects to `/login` (non-localhost) or re-runs the bootstrap flow (localhost). The stale `workspaceId` is not sent to the new backend.
❌ **Fail:** App loads normally with stale state and makes API calls with the old workspace ID, getting `404` or `403` errors.

---

### 6. First-time load (no stored `installationId`) does not block login

**Steps:**
1. Open DevTools → Application → Local Storage → clear `knotwork_auth`.
2. Reload the browser tab.

✅ **Pass:** App loads normally. After authentication, `installationId` is stored (no mismatch triggered since there was nothing to compare against).
❌ **Fail:** App clears or loops on load when there is no prior `installationId`.

---

### 7. Backend unreachable does not block the app

**Steps:**
1. Stop the backend.
2. Reload a protected page in the browser (with a valid token in localStorage).

✅ **Pass:** App does not hang or crash due to the failed `/health` call. It either shows the page (token is present) or falls through to the normal auth flow.
❌ **Fail:** Blank screen, infinite spinner, or unhandled error because the `/health` fetch threw.

---

### 8. Automated tests pass

```bash
cd backend && pytest ../docs/implementation/S9/tests/test_installation_id.py -v
```

✅ **Pass:** All 7 tests collected and passed.
❌ **Fail:** Any test fails or errors.

---

## Installation Update Mechanism

### 9. `/health` exposes schema version and plugin requirements

```bash
curl http://localhost:8000/health | jq '{schema_version, min_openclaw_version}'
```

✅ **Pass:** Both fields are present. `schema_version` is a non-empty alembic revision hash (e.g. `"a1b2c3d4e5f6"`). `min_openclaw_version` is a semver string (e.g. `"1.0.0"`).
❌ **Fail:** Either field is missing or null.

---

### 10. Runtime API URL injection works in the production frontend container

**Steps:**
1. Build the prod frontend image: `docker compose build frontend-prod`
2. Run a one-off container with a custom `API_URL`:
   ```bash
   docker run --rm -e API_URL=http://example-api:9999/api/v1 \
     $(docker compose config --images | grep frontend-prod | head -1) \
     cat /usr/share/nginx/html/env.js
   ```
   Wait — the entrypoint replaces in-place and starts nginx. Instead, override entrypoint:
   ```bash
   docker run --rm --entrypoint sh \
     -e API_URL=http://example-api:9999/api/v1 \
     knotwork-local-frontend-prod:latest \
     -c 'sed -i "s|RUNTIME_API_URL|${API_URL}|g" /usr/share/nginx/html/env.js && cat /usr/share/nginx/html/env.js'
   ```

✅ **Pass:** Output shows `window._env = { API_URL: 'http://example-api:9999/api/v1' };` — placeholder is replaced.
❌ **Fail:** Output still contains `RUNTIME_API_URL` (substitution did not run).

---

### 11. Dev frontend falls back to Vite env (not the runtime placeholder)

**Steps:**
1. Open the running dev frontend in a browser.
2. Open DevTools → Console → run `window._env`.

✅ **Pass:** `window._env.API_URL` is `'RUNTIME_API_URL'` (literal placeholder), but API calls succeed because `client.ts` detects the placeholder and uses `VITE_API_URL` instead. No `RUNTIME_API_URL` appears in any network request URL.
❌ **Fail:** Network requests to the backend use `RUNTIME_API_URL` as the host (substitution was incorrectly applied in dev mode).

---

### 12. `scripts/update.sh --help` equivalent (dry-run sanity check)

**Steps:**
```bash
# Should fail fast with a clear error, not silently succeed
./scripts/update.sh --root-dir /nonexistent/path
```

✅ **Pass:** Exits with `ERROR: Install dir not found: /nonexistent/path`.
❌ **Fail:** Script hangs, crashes with an unhandled error, or silently does nothing.

---

## Worker Liveness & Version Warning Banner

### 13. `/health` exposes worker status

**Steps:**
```bash
# With worker running:
arq knotwork.worker.tasks.WorkerSettings &
sleep 35  # wait for first heartbeat
curl http://localhost:8000/health | jq .worker
```

✅ **Pass:** `{ "alive": true, "last_seen_seconds_ago": <number ≤ 30> }`
❌ **Fail:** `alive` is `false` or `null` while the worker is running.

---

### 14. Worker status shows `false` when worker is stopped

**Steps:**
1. Stop the arq worker process.
2. Wait 90 seconds (TTL expiry).
3. `curl http://localhost:8000/health | jq .worker`

✅ **Pass:** `{ "alive": false, "last_seen_seconds_ago": null }` — Redis key expired.
❌ **Fail:** Still reports `alive: true` after the worker is stopped and TTL has expired.

---

### 15. Version warning banner appears when worker is down

**Steps:**
1. Stop the arq worker and wait 90 s for the heartbeat key to expire.
2. Open the frontend (any page in AppLayout — e.g. `/inbox`).

✅ **Pass:** An amber banner appears at the top of the page with text containing "Background worker is not running".
❌ **Fail:** No banner, or banner appears on a white background with no styling.

---

### 16. Version warning banner disappears when worker is healthy

**Steps:**
1. Start the arq worker.
2. Wait up to 60 s for the `/health` refetch interval to fire.
3. Observe the banner.

✅ **Pass:** Banner disappears without a page reload once the health query returns `worker.alive: true`.
❌ **Fail:** Banner persists after the worker is running and health data has refreshed.

---

### 17. Settings → System tab shows version info

**Steps:**
1. Open the frontend, navigate to **Settings → System**.

✅ **Pass:** The System tab renders with rows for: API version, Schema version, Installation ID (truncated), Background worker status. Worker status row shows a green checkmark if running, red X if down.
❌ **Fail:** Tab is missing, or any row shows "undefined" / "null".

---

### 18. Plugin compatibility shown in System tab

**Steps:**
1. Ensure at least one OpenClaw integration is registered.
2. Open **Settings → System**.
3. Observe the "Plugin Compatibility" section.

✅ **Pass:** Each plugin shows its version and a green ✅ if ≥ `min_openclaw_version`, or red ✗ if outdated. The required version row shows `≥ <min_openclaw_version>`.
❌ **Fail:** Plugin rows are missing, or all show unknown version when the integration does have a `plugin_version` set.
