# Knotwork OpenClaw Plugin

Plugin-first bridge between OpenClaw and Knotwork.

## What it does

1. Calls Knotwork handshake endpoint with a one-time token.
2. Syncs available OpenClaw agents (`agents.list`) and tool metadata.
3. Polls Knotwork for execution tasks and executes them through session-oriented OpenClaw actions.
4. Sends execution events back to Knotwork (`completed`, `escalation`, `failed`, `log`).
5. Exposes gateway methods for status, manual re-sync, and manual task processing.

## Architecture

The plugin is split into 3 explicit layers:

1. Handshake (run once)
- Establishes trust and obtains `integration_secret`.
- Files: `src/handshake.ts`, `src/config.ts`.

2. Comm (polling now, WebSocket-ready)
- Current transport is polling (`pull_task` + `submit_task_event`).
- Abstraction is isolated so WebSocket can replace polling later.
- Files: `src/comm/polling.ts`, `src/comm/types.ts`, `src/comm/ws.ts` (placeholder).

3. Execution (session-oriented)
- Converts each Knotwork task into session actions only:
  - create/continue session
  - send message to session
  - sync/receive messages from session history
- Files: `src/execution/session.ts`, `src/execution/modes.ts`, `src/execution/history.ts`, `src/execution/index.ts`.

`src/main.ts` orchestrates these layers and does not contain execution internals.

## Install (local path)

From your OpenClaw environment:

```bash
openclaw plugins install /absolute/path/to/openclaw-plugin-knotwork
```

Then enable plugin in your OpenClaw config (`openclaw.config.json`), under `plugins.entries`:

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
          "pluginInstanceId": "openclaw-main-1",
          "autoHandshakeOnStart": true,
          "taskPollIntervalMs": 2000
        }
      }
    }
  }
}
```

## Required config

- `knotworkBaseUrl`: Knotwork URL reachable from Docker/OpenClaw runtime.
- `handshakeToken`: generated from Knotwork Settings > Agents.

## Recommended config

- `pluginInstanceId`: stable value per OpenClaw installation (do not rotate per restart).
- `taskPollIntervalMs`: start with `2000` and tune if needed.

## Optional config

- `autoHandshakeOnStart`: keep `true` for normal operation.

## Handshake flow

1. In Knotwork Settings > Agents, generate handshake token.
2. Put token in plugin config (`handshakeToken`).
3. Start/restart OpenClaw.
4. Plugin handshakes to `POST /openclaw-plugin/handshake`.
5. In Knotwork Settings > Agents, open discovered agents and register one.
6. Trigger a run with the registered `openclaw:*` agent. Plugin will poll task queue and execute.

## Gateway methods

- `knotwork.status`
- `knotwork.handshake`
- `knotwork.sync_agents`
- `knotwork.process_once`

You can call these from OpenClaw Gateway RPC tooling to verify integration.
