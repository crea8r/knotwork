# Knotwork OpenClaw Plugin

Bridge between OpenClaw and Knotwork. Polls Knotwork for agent execution tasks, runs them through OpenClaw, and reports results back.

## File structure

```
src/
  types.ts    — shared type declarations (no logic)
  bridge.ts   — config resolution, agent discovery, Knotwork HTTP calls
  session.ts  — task execution (Session Execution Contract)
  plugin.ts   — activate(), polling loop, gateway RPC methods
index.ts      — re-exports activate()
```

Four files, each under 200 lines.

## Session Execution Contract

Every task is executed as three logical operations:

| Operation | What happens |
|---|---|
| `create_session` | Implicit — OpenClaw auto-creates on first message. Identity = deterministic scoped key from `task.session_name`. |
| `send_message` | `POST /v1/responses` (primary) or `gateway.call('agent', ...)` (fallback). Idempotency key = `knotwork:task:<taskId>` — deterministic, retry-safe. |
| `sync_session` | `agent.wait(runId)` as completion signal; `chat.history` reads output. `runId` is the correlation token. |

**Execution paths (in order):**
1. HTTP `POST /v1/responses` — synchronous, session-persistent via `x-openclaw-session-key` + `user` field. No polling.
2. `gateway.call('agent')` + `agent.wait` — for environments with HTTP endpoint disabled.

Both paths use the same deterministic idempotency key so retries never produce duplicate agent runs.

## Setup

**1. Generate a handshake token in Knotwork**

Settings > Agents > Generate Handshake Token → copies `kw_oc_...` token.

**2. Configure the plugin**

In your OpenClaw config (`openclaw.config.json`):

```json
{
  "plugins": {
    "entries": {
      "knotwork-bridge": {
        "enabled": true,
        "source": "/absolute/path/to/openclaw-plugin-knotwork",
        "config": {
          "knotworkBaseUrl": "http://host.docker.internal:8000",
          "handshakeToken": "kw_oc_...",
          "pluginInstanceId": "my-openclaw-1",
          "autoHandshakeOnStart": true,
          "taskPollIntervalMs": 2000
        }
      }
    }
  }
}
```

Or via env vars: `KNOTWORK_BASE_URL`, `KNOTWORK_HANDSHAKE_TOKEN`, `KNOTWORK_PLUGIN_INSTANCE_ID`.

**3. Start/restart OpenClaw**

Plugin handshakes automatically. In Knotwork Settings > Agents you'll see the discovered agents. Register one, then trigger a run — the plugin picks it up from the task queue.

## Config reference

| Key | Required | Default | Notes |
|---|---|---|---|
| `knotworkBaseUrl` | ✓ | — | URL reachable from OpenClaw runtime |
| `handshakeToken` | ✓ | — | One-time token from Knotwork Settings |
| `pluginInstanceId` | — | auto | Keep stable across restarts |
| `autoHandshakeOnStart` | — | `true` | Handshake on plugin load |
| `taskPollIntervalMs` | — | `2000` | Min 500ms |

## Debugging

### Live status (no restart needed)

```bash
# Plugin health, config, current task
openclaw gateway call knotwork.status

# Last 200 log lines from in-memory buffer
openclaw gateway call knotwork.logs

# Re-handshake and re-sync agents on demand
openclaw gateway call knotwork.handshake

# Pull and execute exactly one task right now (useful for testing)
openclaw gateway call knotwork.process_once
```

### Docker logs (persistent, survives restarts)

All log lines are written to stdout with `[knotwork-bridge]` prefix:

```bash
docker logs <container> 2>&1 | grep knotwork-bridge
docker logs -f <container> 2>&1 | grep knotwork-bridge   # follow
```

### Log format

```
2026-01-15T10:23:01.123Z handshake:start instanceId=my-openclaw-1 agents=2
2026-01-15T10:23:01.456Z handshake:ok secret=...ab12
2026-01-15T10:23:03.789Z task:start id=<uuid> node=classify session=agent:main:ws:run:<uuid>
2026-01-15T10:23:08.123Z task:done id=<uuid> type=completed
```

### Code changes in Docker

OpenClaw loads plugins at startup. After editing plugin source:

```bash
docker restart <openclaw-container>
```

No gateway restart needed — the gateway is part of the same process.

To avoid restarts during development: mount the plugin directory as a volume and configure OpenClaw with `"watchPlugins": true` if supported by your OpenClaw version.

## Gateway RPC methods

| Method | Description |
|---|---|
| `knotwork.status` | Live state: handshake status, running task, config |
| `knotwork.logs` | Last 200 log lines from memory buffer |
| `knotwork.handshake` | Re-handshake and re-sync agents |
| `knotwork.sync_agents` | Alias for `knotwork.handshake` |
| `knotwork.process_once` | Pull and execute one task immediately |
