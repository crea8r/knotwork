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
| `send_message` | `gateway.call('agent', ...)`. Idempotency key = `knotwork:task:<taskId>` — deterministic, retry-safe. |
| `sync_session` | `agent.wait(runId)` as completion signal; `chat.history` reads output. `runId` is the correlation token. |

**Execution path:**
1. `gateway.call('agent')` + `agent.wait` over the OpenClaw local gateway.

This requires the plugin to be granted OpenClaw gateway scopes:
1. `operator.read`
2. `operator.write`

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
        "package": "@knotwork/knotwork-bridge@0.2.0",
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

Preferred install path:

```bash
openclaw plugins install <install-url-from-knotwork>
```

Use the standard OpenClaw plugin installer so OpenClaw can register the plugin and request the required permissions.
If startup says `plugin not found: knotwork-bridge`, the standard installer did not complete correctly and the installation is failed.

For a durable install, persist the plugin config in `openclaw.config.json`.
Do not rely on one-shot shell env vars alone, because OpenClaw may not preserve them across restarts.

**3. Start/restart OpenClaw**

The primary long-running plugin runtime handshakes automatically on first pairing. CLI/plugin-load contexts stay passive and do not consume the handshake token on startup. After pairing, the plugin persists `pluginInstanceId` + `integrationSecret` locally and should survive normal OpenClaw restarts without needing a new handshake token. In Knotwork Settings > Agents you'll see the discovered agents. Register one, then trigger a run — the plugin picks it up from the task queue.

If OpenClaw prompts for plugin permissions during install, approve:
1. `operator.read`
2. `operator.write`

The plugin manifest now declares both scopes, so a correct OpenClaw install flow should request them during installation/approval.
If installation is being driven by another agent through chat, that agent must stop and ask the user to approve the interactive permission prompt. This is a trust-boundary step and should not be silently assumed.

If you see `missing scope: operator.write` or `missing scope: operator.read`, the plugin was installed without the required gateway scopes. Reinstall or update the plugin permissions, restart OpenClaw, then run:

```bash
openclaw gateway call knotwork.handshake
```

The plugin now checks these scopes during handshake/startup. A bad install should fail at pairing time instead of waiting until the first workflow run.
Treat installation as failed unless `openclaw gateway call knotwork.handshake` succeeds after the install/restart step.

## Config reference

| Key | Required | Default | Notes |
|---|---|---|---|
| `knotworkBaseUrl` | ✓ | — | URL reachable from OpenClaw runtime |
| `handshakeToken` | ✓ | — | One-time token from Knotwork Settings |
| `pluginInstanceId` | — | auto | Keep stable across restarts |
| `autoHandshakeOnStart` | — | `true` | Handshake on primary runtime startup |
| `taskPollIntervalMs` | — | `2000` | Min 500ms |

## Persistent state

The plugin stores local connection state in:

`~/.openclaw/knotwork-bridge-state.json`

Stored fields:

1. `pluginInstanceId`
2. `integrationSecret`

It also keeps a local runtime lease so only one long-running process owns background handshake/polling. Transient CLI/plugin-load contexts still expose RPC methods, but they do not auto-start the worker loop.

This is used so normal OpenClaw restarts do not require a new handshake token.

## Debugging

### Live status (no restart needed)

```bash
# Plugin health, config, current task
openclaw gateway call knotwork.status

# Last 200 log lines from in-memory buffer
openclaw gateway call knotwork.logs

# Re-handshake and re-sync agents on demand
openclaw gateway call knotwork.handshake

# Reset local connection state while keeping the current plugin instance id
openclaw gateway call knotwork.reset_connection

# Pull and execute exactly one task right now (useful for testing)
openclaw gateway call knotwork.process_once
```

If the backend reports invalid plugin credentials, the plugin now clears the persisted secret and automatically re-handshakes using the configured token.

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
| `knotwork.reset_connection` | Clear persisted local connection state so the plugin can be re-paired |
| `knotwork.process_once` | Pull and execute one task immediately |
