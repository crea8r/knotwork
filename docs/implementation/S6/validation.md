# S6 Validation Checklist

Run the dev stack before starting:
```bash
# terminal 1
cd backend && uvicorn knotwork.main:app --reload

# terminal 2
cd frontend && npm run dev
```

---

## 1. Built-in tools list

**Steps:** Navigate to `/tools`.

- ✅ **Pass:** Four built-in tool cards appear: Web Search, Web Fetch, HTTP Request, Calculator. Each shows the `builtin` badge and its slug.
- ❌ **Fail:** Page shows a spinner indefinitely, or cards show mock data with "tools S6" label.

---

## 2. Calculator test (no API key required)

**Steps:** `POST /api/v1/workspaces/{ws}/tools/builtins` is not a test endpoint — instead, create a workspace tool first:

```bash
curl -s -X POST http://localhost:8000/api/v1/workspaces/dev-workspace/tools \
  -H 'Content-Type: application/json' \
  -d '{"name":"Calc","slug":"calc","category":"builtin","definition":{}}' | jq .
```

Then test it:
```bash
TOOL_ID=$(curl -s http://localhost:8000/api/v1/workspaces/dev-workspace/tools | jq -r '.[0].id')
curl -s -X POST "http://localhost:8000/api/v1/workspaces/dev-workspace/tools/$TOOL_ID/test" \
  -H 'Content-Type: application/json' \
  -d '{"input":{"expression":"2+2*3"}}' | jq .
```

- ✅ **Pass:** Response contains `{"output":{"expression":"2+2*3","result":8.0},"error":null,...}`.
- ❌ **Fail:** `error` field is non-null, or `result` is wrong.

---

## 3. Tool CRUD via API

```bash
# Create
curl -s -X POST http://localhost:8000/api/v1/workspaces/dev-workspace/tools \
  -H 'Content-Type: application/json' \
  -d '{"name":"My HTTP Tool","slug":"my-http","category":"http","definition":{"url":"https://httpbin.org/get","method":"GET"}}' | jq .id

# List
curl -s http://localhost:8000/api/v1/workspaces/dev-workspace/tools | jq length

# Delete (use id from Create step)
curl -s -X DELETE "http://localhost:8000/api/v1/workspaces/dev-workspace/tools/<ID>" -o /dev/null -w "%{http_code}"
```

- ✅ **Pass:** Create returns a UUID; list shows count > 0; delete returns `204`.
- ❌ **Fail:** Any step returns `4xx` or `500`.

---

## 4. Notification preferences — get (auto-create)

```bash
curl -s http://localhost:8000/api/v1/workspaces/dev-workspace/notification-preferences | jq .
```

- ✅ **Pass:** Returns JSON with `email_enabled: false`, `telegram_enabled: false`, `whatsapp_enabled: false` (defaults).
- ❌ **Fail:** `404` or `500`.

---

## 5. Notification preferences — toggle email via API

```bash
curl -s -X PATCH http://localhost:8000/api/v1/workspaces/dev-workspace/notification-preferences \
  -H 'Content-Type: application/json' \
  -d '{"email_enabled":true,"email_address":"test@example.com"}' | jq '.email_enabled, .email_address'
```

- ✅ **Pass:** Returns `true` and `"test@example.com"`.
- ❌ **Fail:** Fields unchanged or error.

---

## 6. Settings → Notifications tab (frontend)

**Steps:** Open `/settings`, click "notifications" tab.

- ✅ **Pass:** Three toggles appear (Email, Telegram, WhatsApp). Clicking a toggle immediately updates it (optimistic, then confirmed by API). No "notifications S6" mock badge visible.
- ❌ **Fail:** Toggle does nothing, or mock badge still shown.

---

## 7. Notification log (after an escalation)

**Steps:** Trigger a run that causes an escalation (low-confidence node). Then:

```bash
curl -s http://localhost:8000/api/v1/workspaces/dev-workspace/notification-log | jq .
```

- ✅ **Pass:** Log entry appears with `channel`, `status` (`sent` or `failed`), and `sent_at`. If no channels are enabled, log is empty (which is also correct).
- ❌ **Fail:** `500` from the endpoint.

---

## 8. WhatsApp deep link

```bash
curl -s -X PATCH http://localhost:8000/api/v1/workspaces/dev-workspace/notification-preferences \
  -H 'Content-Type: application/json' \
  -d '{"whatsapp_enabled":true,"whatsapp_number":"1234567890"}'

# Trigger an escalation (create one directly for testing):
curl -s http://localhost:8000/api/v1/workspaces/dev-workspace/notification-log | jq '.[0]'
```

- ✅ **Pass:** Log entry shows `channel: "whatsapp"`, `status: "sent"`, and `detail` contains a `https://wa.me/1234567890?text=...` URL.
- ❌ **Fail:** No log entry, or `detail` is null.

---

## 9. Tool executor node in a graph run

**Steps:**
1. Create a graph with a `tool_executor` node (via designer chat or API).
2. Trigger a run.
3. Check `/api/v1/workspaces/{ws}/runs/{run_id}/nodes`.

- ✅ **Pass:** Node state shows `status: "completed"` and `output` contains the tool result.
- ❌ **Fail:** Node shows `status: "failed"` or node state is missing.

---

## 10. calc builtin — safe evaluation guard

```bash
python3 -c "
from knotwork.tools.builtins.calc import calc
import asyncio
# Should raise ValueError, not execute __import__
try:
    asyncio.run(calc('__import__(\"os\").system(\"echo pwned\")'))
    print('FAIL: no error raised')
except Exception as e:
    print('PASS:', e)
"
```

Run from `backend/` with the venv active.

- ✅ **Pass:** Prints `PASS: ...` with a ValueError message.
- ❌ **Fail:** Prints `FAIL` or executes the expression.
