# Session 1 Validation Guide

This doc tells you exactly what to run, what to click, and what to look for.
Each section has a ✅ pass / ❌ fail condition.

---

## Prerequisites

Before starting, make sure `backend/.env` has at least:
```
DATABASE_URL=postgresql+asyncpg://knotwork:knotwork@localhost:5432/knotwork
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=sk-...        ← required for the LLM node to run
JWT_SECRET=any-string-here
```

---

## 1. Start the stack

```bash
cd /path/to/knotwork
./dev.sh
```

**Wait for all four lines to appear:**
```
[ok]  Docker services up.
[ok]  Postgres ready.
[ok]  Migrations up to date.
```
Then uvicorn, arq worker, and Vite should all start.

✅ Terminal shows no red errors
✅ `http://localhost:8000/docs` loads the Swagger UI
✅ `http://localhost:5173` loads the Knotwork frontend (shows "Graphs" page)

---

## 2. Database tables exist

```bash
docker exec knotwork-postgres-1 psql -U knotwork -d knotwork -c "\dt"
```

✅ Output lists 16 tables (users, workspaces, graphs, graph_versions, runs, run_node_states, …)
❌ If empty → run `cd backend && .venv/bin/alembic upgrade head`

---

## 3. Dev workspace is seeded

```bash
cd backend && .venv/bin/python seed.py
```

✅ Output says "Using existing workspace: \<uuid\>" and "Written …/.env.local"
✅ File `frontend/.env.local` exists and contains `VITE_DEV_WORKSPACE_ID=<uuid>`

> **Important:** After first running seed.py, restart Vite so it loads the env var.
> Stop `./dev.sh` with Ctrl+C, then run `./dev.sh` again.

---

## 4. Graphs page loads

Open `http://localhost:5173/graphs`

✅ Page loads (not blank, no console errors)
✅ "test graph" appears in the list (created by the seed + test run earlier)

---

## 5. Create a new graph

1. Click **"New graph"**
2. Type a name (e.g. `My First Graph`) and press Enter

✅ Graph appears in the list
✅ Clicking it opens the graph detail page
✅ Page shows "No nodes yet — use the chat designer to add nodes."

---

## 6. Add nodes manually

On the graph detail page:

1. Click **"Add node"** (top right area, next to Run)
2. Select type: **LLM Agent**, name it `Analyse`, click **Add**
3. Click **"Add node"** again
4. Select type: **Human Checkpoint**, name it `Review`, click **Add**
5. Click **Save**

✅ Canvas shows two boxes: `Analyse` (blue) → `Review` (amber), connected by an arrow
✅ "Save" button disappears after saving (no longer dirty)

> The second node is auto-connected to the first. If you add more nodes they chain automatically.

---

## 7. Trigger a run

Still on the graph detail page:

1. In the **Run input** field at the bottom, type:
   ```json
   {"text": "The quick brown fox jumps over the lazy dog."}
   ```
2. Click **Run**

✅ Browser redirects to `/runs/<uuid>`
✅ Run page shows status **"Running"** with a blinking "live" indicator

---

## 8. LLM Agent executes

Watch the run page (it polls every 2 seconds automatically).

✅ Status changes from **Queued → Running**
✅ After 5–15 seconds, status changes to **Paused — awaiting review**

> If it stays on "Running" for more than 60 seconds, check the arq worker terminal for errors.
> Most likely cause: missing or invalid `OPENAI_API_KEY` in `backend/.env`.

---

## 9. Check arq worker logs

In the terminal running `./dev.sh`, look for the arq worker output:

✅ Should see something like:
```
  queued  execute_run(run_id='...')
  ...
  complete execute_run(run_id='...') ●
```

❌ If you see a Python traceback → check the error. Common causes:
- `AuthenticationError` → bad API key
- `ImportError` → missing package (`pip install -e ".[dev]"`)
- `asyncpg` connection error → postgres not running

---

## 10. Verify run status via API

```bash
curl -s http://localhost:8000/api/v1/workspaces/<WORKSPACE_ID>/runs | python3 -m json.tool | head -40
```

Replace `<WORKSPACE_ID>` with the UUID from `frontend/.env.local`.

✅ Returns a list with at least one run
✅ The run you triggered has `"status": "paused"` (if LLM ran and hit the checkpoint)

---

## What S1 does NOT have yet

These are expected gaps — they are planned for S2+:

| Missing | Planned |
|---------|---------|
| Login / auth | S2 |
| Resuming a paused run via UI | S2 |
| WebSocket live updates | S2 (currently polls every 2s) |
| Chat designer to build graphs | S4 |
| Handbook (knowledge files) | S3 |
| Escalation inbox | S2 |
| Notification (Telegram/email) | S6 |

---

## Quick reference: what runs where

| Process | What it does | Port |
|---------|-------------|------|
| Vite dev server | Frontend | 5173 |
| uvicorn | FastAPI backend + REST API | 8000 |
| arq worker | Executes LangGraph runs in background | — |
| PostgreSQL (Docker) | Database | 5432 |
| Redis (Docker) | Run queue | 6379 |

All started by `./dev.sh`. All stopped by Ctrl+C.

---

## Full reset (if something is broken)

```bash
# Stop everything
Ctrl+C

# Wipe DB and restart fresh
cd knotwork
docker compose down -v
docker compose up -d
cd backend
.venv/bin/alembic upgrade head
.venv/bin/python seed.py

# Restart dev stack
cd ..
./dev.sh
```
