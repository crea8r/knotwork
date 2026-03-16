# OpenClaw ↔ Knotwork Integration

How the OpenClaw plugin connects to Knotwork, executes agent tasks, and reports results back.

---

## Overview

OpenClaw is an external agent runtime with its own UI and tool-execution environment. Knotwork uses it as an **execution backend** for nodes configured with an `openclaw:*` agent ref. The two systems are decoupled — they communicate over HTTP (Knotwork REST API) and WebSocket (OpenClaw local gateway). Neither system calls the other synchronously during execution; all coordination goes through the shared `OpenClawExecutionTask` database row.

```
Knotwork backend          OpenClaw plugin (runs inside OpenClaw)
─────────────────         ──────────────────────────────────────
Runtime adapter   ──DB──▶  OpenClawExecutionTask row (status: pending)
                           Plugin polls pull-task every 2 s
                  ◀──────  Plugin claims task (status: claimed)
                           Plugin calls OpenClaw gateway (WebSocket)
                           OpenClaw agent runs (can take minutes–hours)
                           Plugin posts event (status: completed/escalated/failed)
Runtime adapter ──DB──▶   Reads updated task row, yields NodeEvent
```

---

## Part 1: Connection — Handshake

### Prerequisites (plugin side)

Three values must be in the OpenClaw plugin config or env vars:

| Config key | Env var | Description |
|---|---|---|
| `knotworkBaseUrl` | `KNOTWORK_BASE_URL` | Base URL of the Knotwork backend (e.g. `http://localhost:8000`) |
| `handshakeToken` | `KNOTWORK_HANDSHAKE_TOKEN` | One-time token generated from Knotwork Settings → OpenClaw |
| `pluginInstanceId` | `KNOTWORK_PLUGIN_INSTANCE_ID` | Stable ID for this plugin instance (auto-generated if omitted) |

The OpenClaw plugin must also be granted gateway scopes:

1. `operator.read`
2. `operator.write`

Operational requirement:
1. Persist `knotworkBaseUrl` and `handshakeToken` in OpenClaw plugin config.
2. Use the standard `openclaw plugins install <knotwork-base-url>/openclaw-plugin/package/knotwork-bridge-0.2.0.tar.gz` flow so OpenClaw can register the plugin and run its normal permission-approval path.
3. Treat the Knotwork `/openclaw-plugin/install?token=...` URL as a setup bundle endpoint; it returns the tarball install command, config, and verification instructions.
4. Treat env vars only as bootstrap helpers for install commands, not as the durable runtime source of truth.
5. If OpenClaw requires interactive plugin-permission approval, an agent-assisted install must pause and hand control back to the human operator for approval.
6. Treat installation as failed unless `openclaw gateway call knotwork.handshake` succeeds after restart. Missing-scope, missing-config, or `plugin not found` errors from that verification step mean the install is invalid.

### Handshake flow

Only the primary long-running plugin runtime auto-handshakes on startup (`autoHandshakeOnStart: true` by default). CLI/plugin-load contexts must stay passive and should not consume the pairing token.

When the primary runtime starts, the plugin calls:

```
POST /openclaw-plugin/handshake
{
  token: "<handshake_token>",
  plugin_instance_id: "<instance_id>",
  plugin_version: "0.2.0",
  agents: [ { remote_agent_id, slug, display_name, tools, constraints } ]
}
```

**What the backend does:**
1. Validates the token against `OpenClawHandshakeToken` (must not be expired; reuse allowed for same `plugin_instance_id`).
2. Upserts an `OpenClawIntegration` row for this `(workspace, plugin_instance_id)` pair.
3. Upserts `OpenClawRemoteAgent` rows — one per agent reported by the plugin.
4. Returns `{ integration_secret, integration_id, workspace_id }`.

Before the plugin performs that Knotwork handshake, it probes the OpenClaw gateway for `operator.read` and `operator.write`. If either scope is missing, handshake must fail immediately with actionable remediation instead of allowing a "connected but unrunnable" installation.

The plugin persists `integration_secret` locally on the OpenClaw side and reuses it across routine restarts. This secret is required for all subsequent plugin API calls (sent as `X-Knotwork-Integration-Secret` header). **The token is the pairing/bootstrap credential; the secret is the ongoing runtime credential.**

Current local persistence behavior:
1. Plugin stores `pluginInstanceId` + `integrationSecret` in `~/.openclaw/knotwork-bridge-state.json`
2. On routine restart, plugin reuses the persisted secret instead of requiring a fresh handshake
3. If backend returns `401 Invalid plugin credentials`, plugin clears the persisted secret and automatically attempts a fresh handshake
4. CLI/plugin-load invocations do not auto-handshake or start background polling
5. The primary runtime uses a local runtime lease so only one process owns background handshake/polling at a time

Agent discovery runs at handshake time using a multi-step fallback:
1. `api.agents.list()` SDK method
2. `gateway.call('agents.list', {})` / `gateway.call('agent.list', {})`
3. `config.agents.list` static config
4. Default stub `{ remote_agent_id: 'main', slug: 'main', display_name: 'Main Agent' }`

### Re-handshake

You can force a re-handshake (e.g. after adding a new agent) via the gateway RPC:
```
openclaw gateway call knotwork.handshake
openclaw gateway call knotwork.sync_agents   # alias
```

To intentionally reset local plugin pairing state:
```
openclaw gateway call knotwork.reset_connection
```

---

## Part 2: Task Lifecycle

### Step 1 — Runtime creates the task

When LangGraph executes an agent node with `agent_ref: "openclaw:*"`, the `OpenClawAdapter.run_node()` method:
1. Resolves `integration_id` and `remote_agent_id` from the registered agent or by slug lookup.
2. Builds `system_prompt` + `user_prompt` via `build_agent_prompt()`.
3. Writes an `OpenClawExecutionTask` row with `status: "pending"`.
4. Yields `NodeEvent("started", ...)` and enters the polling loop.

### Step 2 — Plugin claims the task

The plugin calls `POST /openclaw-plugin/pull-task` every 2 seconds (`taskPollIntervalMs`). The backend returns the oldest pending task for this integration.

**Current concurrency model (S8/S8.1):**
- One OpenClaw plugin instance claims and executes **one task at a time**.
- This limit is per `openclaw_integration` / plugin instance, **not** per remote agent.
- If one plugin instance reports multiple agents, they still share the same single-task consumer today.
- Additional tasks remain `pending` in `openclaw_execution_tasks` until the currently claimed task completes.

On claiming, the task transitions: `pending → claimed`. The response includes:

```json
{
  "task": {
    "task_id": "...",
    "session_name": "knotwork:<agent_key>:<workspace_id>:run:<run_id>",
    "system_prompt": "...",
    "user_prompt": "...",
    "session_token": "...",
    "execution_contract": {
      "type": "session",
      "operations": ["create_session", "send_message", "sync_session"]
    }
  }
}
```

**Session name format:** `knotwork:<agent_key>:<workspace_id>:<mode>` where mode is `run:<run_id>` for workflow runs or `main` for the persistent agent chat.

### Step 3 — Plugin executes via OpenClaw gateway

The plugin calls `executeTask(api, task)` in `session.ts`. This uses the **Session Execution Contract** — three logical operations over the OpenClaw local WebSocket gateway (`ws://127.0.0.1:<port>/`):

If those gateway scopes are not granted, task execution fails before the first `agent` call with an error like `missing scope: operator.write`.

#### Wire protocol
Each call opens a new WebSocket connection with a two-step handshake:
1. `→ connect` (with auth token embedded in `connectParams.auth`)
2. `← res: hello-ok`
3. `→ req: { type:"req", id, method, params }`
4. `← res: { type:"res", id, ok, payload|error }`

#### create_session (implicit)
OpenClaw auto-creates a named session on the first `agent` call if one doesn't exist for `sessionKey`. No explicit call needed.

#### send_message
```js
gatewayRpc('agent', {
  agentId,
  sessionKey,      // "agent:<id>:knotwork:<key>:<ws>:run:<run_id>"
  idempotencyKey,  // "knotwork:task:<task_id>" — makes retries safe
  message,         // the user_prompt from the task
  extraSystemPrompt // the system_prompt from the task
})
// Returns: { runId, ... }
```

#### sync_session
```js
// Wait for agent to finish (up to 15 min)
gatewayRpc('agent.wait', { runId, timeoutMs: 900_000 })
// → { status: "ok" | "timeout" | "error" }

// Read chat history
gatewayRpc('chat.history', { sessionKey, limit: 50 })
// → { messages: [...] }
```

On `agent.wait` timeout, the plugin falls back to reading chat history directly — the response may already be there even if the wait timed out.

### Step 4 — Agent signals completion via decision block

The agent ends its final message with a structured block:

```
```json-decision
{"decision": "confident", "output": "<full answer>", "next_branch": null}
```
```

Or for escalation:
```
```json-decision
{"decision": "escalate", "question": "Need approval for X", "options": ["Approve", "Reject"]}
```
```

`parseDecisionBlock()` extracts this from the end of the last assistant message. If absent, the full message text is treated as a confident completion.

### Step 5 — Plugin posts result event

```
POST /openclaw-plugin/tasks/<task_id>/event
X-Knotwork-Integration-Secret: <secret>

{ plugin_instance_id, event_type: "completed", payload: { output, next_branch } }
```

Event types: `completed`, `escalated`, `failed`, `log` (for progress messages).

The backend handler (`plugin_submit_task_event`) updates the task row immediately. The Knotwork adapter's polling loop sees the status change within 2 seconds.

### Step 6 — Adapter picks up the result

The adapter polls the `OpenClawExecutionTask` row every 2 seconds. When `task.status` transitions to `completed/escalated/failed`, it yields the corresponding `NodeEvent` and returns.

---

## Part 3: Liveness and Failure Modes

### Plugin heartbeat (15 s)

While `executeTask()` is running, the plugin sends `log` events every 15 seconds:
```
POST /tasks/<id>/event  { event_type: "log", payload: { content: "OpenClaw is still working (heartbeat N)" } }
```
This is **user-visible** in the run debug panel. It's non-fatal: if this POST fails, the task continues.

### Adapter heartbeat (5 min)

The Knotwork adapter (`openclaw.py`) also touches `task.updated_at` every 5 minutes by writing directly to the DB. This is **invisible to the user** — its purpose is to prevent the stale-recovery mechanism from misfiring on legitimate long-running tasks.

### Stale task recovery (15 min)

On every `pull-task` call, the backend scans for tasks where:
- `status == "claimed"`
- `updated_at < now - 15 min`

These are marked `failed` with the message `"Plugin task timeout while waiting for OpenClaw result"`. This fires only when **both** the adapter AND the plugin have been silent for 15 minutes — i.e. one side has crashed.

The 15-minute threshold is 3× the adapter heartbeat interval (5 min), ensuring the adapter's regular touches keep legitimate tasks alive.

### arq job timeout (24 h)

The `execute_run` arq job has `job_timeout = 86400` (24 hours). This is a safety net — it kills genuinely hung jobs (infinite loop, DB deadlock) without affecting normal long-running OpenClaw tasks. Under normal operation this limit is never reached.

### agent.wait timeout (15 min)

The `agent.wait` gateway call times out after 15 minutes (`AGENT_WAIT_TIMEOUT_MS = 900_000`). On timeout, the plugin reads chat history as a fallback before giving up. This is a separate, plugin-side timeout — it does not affect the Knotwork adapter's polling loop.

### Operator stop

If an operator clicks "Stop run", `run.status` is set to `"stopped"`. The adapter polls this on every iteration and exits cleanly, yielding `NodeEvent("failed", { error: "Run was stopped by operator" })`.

### Summary table

| Mechanism | Interval / Threshold | Who triggers | What it protects against |
|---|---|---|---|
| Plugin heartbeat log | every 15 s | Plugin | Operator visibility during long tasks |
| Adapter heartbeat (DB write) | every 5 min | Knotwork backend | Stale recovery misfiring on live tasks |
| Stale task recovery | > 15 min silence | Backend (on pull-task) | Both sides crashed, task stuck in "claimed" forever |
| agent.wait timeout | 15 min | Plugin (gateway RPC) | OpenClaw agent hanging inside a run |
| arq job timeout | 24 h | arq worker | Infinite loop or DB deadlock in execute_run |
| Operator stop | on demand | Human | Manual cancellation of any run |

---

## Part 4: Debugging

### Plugin-side RPC methods (callable from any terminal)

```bash
openclaw gateway call knotwork.status       # connection state, last task, last error
openclaw gateway call knotwork.logs         # in-memory ring buffer (last 200 lines)
openclaw gateway call knotwork.handshake    # force re-handshake / agent sync
openclaw gateway call knotwork.process_once # manually trigger one pull-task + execute cycle
```

Logs also go to stdout: `docker logs <container> | grep knotwork-bridge`

### Knotwork-side debug

In the run detail page, the **OpenClaw Debug** panel (collapsed by default) shows:
- Per-node IN → OUT: system prompt, user prompt, human guidance, output
- Agent logs: all `log` events posted by the plugin
- Node status badges

The **Settings → OpenClaw** page shows:
- Integration status and `last_seen_at`
- Task counts by status (pending/claimed/completed/failed/escalated)
- List of synced remote agents

### Common failure patterns

| Symptom | Likely cause | Fix |
|---|---|---|
| Run fails immediately, no plugin logs | Handshake not done or secret mismatch | `knotwork.handshake` RPC |
| Node stuck in "running" for > 15 min | Plugin crashed, no heartbeat | Check plugin logs; restart plugin; stale recovery will clean up after 15 min |
| Run fails but OpenClaw chat shows success | Old bug: arq 300 s timeout (now fixed to 24 h) | Restart worker with latest code |
| "No OpenClaw binding found" error | `registered_agent_id` doesn't match any active integration | Re-register agent in Settings → Agents |
| Agent doesn't include json-decision block | Agent prompt didn't include COMPLETION PROTOCOL | System prompt injection is automatic; check node system_prompt override |

---

## Part 5: Design Constraints

**Each node task should be scoped to complete within ~1 hour on the happy path.** The system supports longer tasks but they carry higher operational risk (plugin restarts, network partitions). Split long processes across multiple nodes.

**Sessions are named and persistent.** The same `session_name` always maps to the same OpenClaw chat session. This means a retried node picks up where it left off. The `idempotencyKey` prevents duplicate messages if the `agent` RPC is called twice.

**The plugin and the backend are fully decoupled.** The plugin can restart at any time. The `OpenClawExecutionTask` row is the handoff point — the adapter waits for the row's status to change; the plugin updates it via `postEvent`. Neither side blocks the other.
