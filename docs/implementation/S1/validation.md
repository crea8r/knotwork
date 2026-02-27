# Session 1 — Visual Validation

Manual checklist. Each item has a ✅ pass / ❌ fail condition.
Automated tests live in `tests/` and cover the same ground programmatically.

Run automated tests first:
```bash
cd backend && .venv/bin/pytest ../docs/implementation/S1/tests/ -v
```

---

## 1. Start the stack

```bash
./dev.sh
```

✅ Terminal shows no red errors
✅ `http://localhost:8000/docs` loads Swagger UI
✅ `http://localhost:5173` loads the frontend (shows Graphs page)

---

## 2. Database tables exist

```bash
docker exec knotwork-postgres-1 psql -U knotwork -d knotwork -c "\dt"
```

✅ Lists 16+ tables (users, workspaces, graphs, runs, …)

---

## 3. Dev workspace seeded

```bash
cd backend && .venv/bin/python seed.py
```

✅ Prints "Using existing workspace: `<uuid>`"
✅ `frontend/.env.local` contains `VITE_DEV_WORKSPACE_ID=<uuid>`

---

## 4. Graphs page

Open `http://localhost:5173/graphs`

✅ Page loads, no console errors
✅ At least one graph in the list (seeded)

---

## 5. Create a graph

1. Click **New graph**, type a name, press Enter

✅ Graph appears in the list
✅ Clicking opens the graph detail page
✅ Page shows "No nodes yet" message

---

## 6. Add nodes + save

1. Click **Add node** → LLM Agent → name `Analyse` → **Add**
2. Click **Add node** → Human Checkpoint → name `Review` → **Add**
3. Click **Save**

✅ Canvas shows two boxes connected by an arrow
✅ **Save** button disappears after saving

---

## 7. Trigger a run

In the **Run input** field at the bottom:
```json
{"text": "The quick brown fox jumps over the lazy dog."}
```
Click **Run**.

✅ Browser redirects to `/runs/<uuid>`
✅ Run page shows status **Running** with a blinking "live" indicator

---

## 8. LLM Agent executes → run pauses

Watch the run page (polls every 2s automatically).

✅ Status changes **Queued → Running**
✅ After 5–15 s, status changes to **Paused — awaiting review**

> Troubleshoot: check arq worker terminal. Common causes:
> - `AuthenticationError` → bad `OPENAI_API_KEY` in `backend/.env`
> - Status stuck on Queued → worker not running or crashed on import

---

## 9. Verify via API

```bash
curl -s http://localhost:8000/api/v1/workspaces/<WORKSPACE_ID>/runs | python3 -m json.tool | head -40
```

✅ List contains the triggered run
✅ Run has `"status": "paused"`
