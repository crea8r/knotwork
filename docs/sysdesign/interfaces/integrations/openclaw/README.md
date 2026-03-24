# OpenClaw Integration — Overview

OpenClaw is an external autonomous agent runtime with its own UI, tools, and session management. Knotwork uses it as an **execution backend**: when a workflow node has `agent_ref = "openclaw:<slug>"`, instead of running the LLM directly, Knotwork delegates the task to an OpenClaw agent and waits for the result.

The integration works through a shared database row — neither system calls the other synchronously. The `OpenClawExecutionTask` table is the handoff point.

---

## How It Fits Into Knotwork

```
User runs a workflow
  └─► LangGraph executes a node with agent_ref="openclaw:my-agent"
      └─► OpenClawAdapter writes OpenClawExecutionTask row (status: pending)
          └─► OpenClaw plugin polls /openclaw-plugin/pull-task every 2s
              └─► Plugin claims task, calls OpenClaw gateway (WebSocket)
                  └─► OpenClaw agent runs (minutes to hours)
                      └─► Plugin posts result to /openclaw-plugin/tasks/{id}/event
                          └─► OpenClawAdapter reads updated row, yields NodeEvent
                              └─► LangGraph advances to next node
```

The plugin runs **inside OpenClaw** as a bridge. It polls Knotwork for tasks and drives the OpenClaw agent on Knotwork's behalf.

---

## Install

### 1. Generate a handshake token in Knotwork

In Knotwork Settings → Agents → OpenClaw, click **Connect OpenClaw**. This calls:

```
POST /api/v1/workspaces/{workspace_id}/openclaw/handshake-token
```

Source: [`backend/knotwork/openclaw_integrations/service.py:create_handshake_token`](../../../../../backend/knotwork/openclaw_integrations/service.py#L76)

The token is prefixed `kw_oc_` and expires after 1 year.

### 2. Get the install bundle

Copy the install URL and open it (or share it with an OpenClaw agent):

```
GET /openclaw-plugin/install?token=<token>
```

Source: [`backend/knotwork/openclaw_integrations/install_router.py:get_install_bundle`](../../../../../backend/knotwork/openclaw_integrations/install_router.py#L51)

This returns a JSON bundle with all commands and a config snippet. The bundle contains:

| Field | What it is |
|---|---|
| `uninstall_command` | `openclaw plugins uninstall "knotwork-bridge"` |
| `cleanup_command` | `rm -rf ~/.openclaw/extensions/knotwork-bridge` |
| `download_command` | `curl -fLJO "<artifact-url>"` — downloads the `.tar.gz` |
| `install_command` | `openclaw plugins install "<downloaded-file>"` |
| `config_snippet` | JSON block for `~/.openclaw/openclaw.json` with `knotworkBackendUrl` + `handshakeToken` |
| `verification_command` | `openclaw gateway call knotwork.handshake` |

The artifact URL comes from `settings.openclaw_plugin_package_url` (env: `OPENCLAW_PLUGIN_PACKAGE_URL`).

Source: [`backend/knotwork/config.py`](../../../../../backend/knotwork/config.py)

### 3. Run the install steps

```bash
# In OpenClaw terminal
openclaw plugins uninstall "knotwork-bridge"
rm -rf ~/.openclaw/extensions/knotwork-bridge
curl -fLJO "<artifact-url>"
openclaw plugins install "knotwork-bridge-0.2.0.tar.gz"
```

Then add the config snippet to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "knotwork-bridge": {
        "enabled": true,
        "config": {
          "knotworkBackendUrl": "https://your-knotwork-backend.com",
          "handshakeToken": "kw_oc_...",
          "autoHandshakeOnStart": true,
          "taskPollIntervalMs": 2000
        }
      }
    }
  }
}
```

**Important:** OpenClaw will prompt for permission approval. The plugin requires:
- `operator.read`
- `operator.write`

Both must be granted, or the plugin will refuse to run tasks.

### 4. Restart and verify

```bash
# Restart OpenClaw gateway, then:
openclaw gateway call knotwork.handshake
```

Installation succeeds only when this command returns without missing-scope or missing-config errors. Then verify in Knotwork Settings → Agents → OpenClaw — you should see the integration status and the synced agents.

---

## Uninstall

### Plugin-side

```bash
openclaw plugins uninstall "knotwork-bridge"
rm -rf ~/.openclaw/extensions/knotwork-bridge
rm ~/.openclaw/knotwork-bridge-state.json   # removes persisted secret
```

### Knotwork-side

```
DELETE /api/v1/workspaces/{workspace_id}/openclaw/integrations/{integration_id}
```

Source: [`backend/knotwork/openclaw_integrations/service.py:delete_integration`](../../../../../backend/knotwork/openclaw_integrations/service.py#L239)

This:
1. Archives all `RegisteredAgent` rows linked to this integration
2. Resets `used_at` on any unexpired handshake tokens (so they can be reused)
3. Deletes the `OpenClawIntegration` row

After deletion, any `pending` tasks for this integration are orphaned — the plugin no longer polls for them. The arq 24h timeout will eventually fail any stuck runs.

---

## Key Files

### Plugin (TypeScript) — `plugins/openclaw/src/`

| File | Role |
|---|---|
| [`types.ts`](../../../../../plugins/openclaw/src/types.ts) | All shared types: `ExecutionTask`, `TaskResult`, `PluginState`, `OpenClawApi`, `PluginConfig` |
| [`openclaw/bridge.ts`](../../../../../plugins/openclaw/src/openclaw/bridge.ts) | Config resolution, agent discovery, HTTP calls to Knotwork (`doHandshake`, `pullTask`, `postEvent`) |
| [`openclaw/gateway.ts`](../../../../../plugins/openclaw/src/openclaw/gateway.ts) | Raw WebSocket RPC transport: `gatewayRpc` |
| [`openclaw/scope.ts`](../../../../../plugins/openclaw/src/openclaw/scope.ts) | Scope error detection: `missingScope`, `isOperatorScopeError`, `scopeHelp` |
| [`openclaw/session.ts`](../../../../../plugins/openclaw/src/openclaw/session.ts) | Task execution: `executeTask`, `parseDecisionBlock`, session key construction |
| [`state/persist.ts`](../../../../../plugins/openclaw/src/state/persist.ts) | State file read: `readPersistedState`, `PersistedPluginState` |
| [`state/lease.ts`](../../../../../plugins/openclaw/src/state/lease.ts) | Runtime process lock: `acquireRuntimeLease`, `releaseRuntimeLease` |
| [`lifecycle/handshake.ts`](../../../../../plugins/openclaw/src/lifecycle/handshake.ts) | Handshake, credential recovery, retry scheduling |
| [`lifecycle/worker.ts`](../../../../../plugins/openclaw/src/lifecycle/worker.ts) | Task poll loop: `pollAndRun`, heartbeat, event posting |
| [`lifecycle/rpc.ts`](../../../../../plugins/openclaw/src/lifecycle/rpc.ts) | Inbound gateway RPC registrations: `knotwork.*` methods |
| [`plugin.ts`](../../../../../plugins/openclaw/src/plugin.ts) | Entry point: `activate()`, state init, context wiring, poll interval, exit handlers |

### Plugin (compiled artifact)

| File | Role |
|---|---|
| [`plugins/openclaw/artifacts/knotwork-bridge-0.2.0.tar.gz`](../../../../../plugins/openclaw/artifacts/knotwork-bridge-0.2.0.tar.gz) | Pre-built plugin artifact. Rebuild: `cd plugins/openclaw && npm run build` |

### Backend (Python) — `backend/knotwork/openclaw_integrations/`

| File | Role |
|---|---|
| [`models.py`](../../../../../backend/knotwork/openclaw_integrations/models.py) | ORM: `OpenClawHandshakeToken`, `OpenClawIntegration`, `OpenClawRemoteAgent`, `OpenClawExecutionTask`, `OpenClawExecutionEvent` |
| [`schemas.py`](../../../../../backend/knotwork/openclaw_integrations/schemas.py) | Pydantic request/response shapes |
| [`service.py`](../../../../../backend/knotwork/openclaw_integrations/service.py) | Business logic: handshake, pull-task, submit-event, stale recovery, debug state |
| [`router.py`](../../../../../backend/knotwork/openclaw_integrations/router.py) | REST endpoints for plugin callbacks + admin endpoints |
| [`install_router.py`](../../../../../backend/knotwork/openclaw_integrations/install_router.py) | `GET /openclaw-plugin/install` — returns the install bundle |

### Runtime adapter (to be implemented)

The `OpenClawAdapter` (referenced in this doc as the Knotwork side of the polling loop) will live in `backend/knotwork/runtime/adapters/openclaw.py`. It writes `OpenClawExecutionTask` rows and polls them for results.

---

## Local State Files (plugin-side)

| Path | Written by | Purpose |
|---|---|---|
| `~/.openclaw/knotwork-bridge-state.json` | [`plugin.ts:persistSnapshot`](../../../../../plugins/openclaw/src/plugin.ts#L157) | Persists `pluginInstanceId`, `integrationSecret`, last handshake info, recent task history, log ring buffer |
| `~/.openclaw/knotwork-bridge-runtime.lock` | [`plugin.ts:acquireRuntimeLease`](../../../../../plugins/openclaw/src/plugin.ts#L214) | Mutex: only one process runs the background poll loop. Contains `{ pid, acquired_at }` |

---

## Activities

Seven distinct activities make up the integration lifecycle:

| # | Activity | Description |
|---|---|---|
| [01](./setup/pairing.md) | **Pairing** | One-time token exchange that links a plugin instance to a Knotwork workspace |
| [02](./plugin/startup.md) | **Plugin startup** | State loading, scope probe, lease acquisition, background loop start |
| [03](./plugin/poll-loop.md) | **Task poll loop** | Steady-state: pull → claim → execute → post result → repeat |
| [04](./plugin/task-execution.md) | **Task execution** | Gateway WebSocket protocol, session naming, decision block parsing |
| [05](./knotwork/adapter-polling.md) | **Adapter polling** | Knotwork runtime side: write task row, poll for status change, yield NodeEvent |
| [06](./knotwork/stale-recovery.md) | **Stale task recovery** | Auto-fail tasks stuck in `claimed` for >15 min when both sides go silent |
| [07](./plugin/error-recovery.md) | **Error recovery** | 401 re-handshake loop, scope errors, gateway timeouts, operator stop |
| [08](./setup/install.md) | **Install** | Full install sequence: token → bundle → download → install → config → handshake → verify |
| [09](./setup/uninstall.md) | **Uninstall** | Plugin-side removal + Knotwork-side DELETE, what cascades, partial uninstall scenarios |

---

## Debugging

```bash
openclaw gateway call knotwork.status       # connection state, running task, last error
openclaw gateway call knotwork.logs         # log ring buffer (last 200 lines) + recent tasks
openclaw gateway call knotwork.handshake    # force re-handshake / re-sync agents
openclaw gateway call knotwork.process_once # trigger one pull-task + execute cycle manually
openclaw gateway call knotwork.reset_connection  # clear local secret (triggers fresh pairing)
```

Knotwork admin endpoint:
```
GET /api/v1/workspaces/{workspace_id}/openclaw/debug-state
```

Source: [`backend/knotwork/openclaw_integrations/service.py:get_debug_state`](../../../../../backend/knotwork/openclaw_integrations/service.py#L281)
