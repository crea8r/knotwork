# Knotwork OpenClaw Plugin

Bridge between OpenClaw and Knotwork. Polls Knotwork for agent execution tasks, runs them through OpenClaw subagents, and reports results back.

## File structure

```
src/
  plugin.ts              — activate(), poll loop, concurrent spawns, lease renewal
  types.ts               — shared type declarations (PluginState, ExecutionTask, RunningTaskInfo)
  lifecycle/
    worker.ts            — runClaimedTask(), pollAndRun(), task event posting
    rpc.ts               — knotwork.* gateway RPC method registrations
    handshake.ts         — handshake + retry scheduling
  openclaw/
    bridge.ts            — pullTask(), postEvent(), config resolution
    session.ts           — subagent.run() execution wrapper
    scope.ts             — operator scope validation
  state/
    lease.ts             — heartbeat TTL runtime lease (prevents duplicate workers)
    persist.ts           — read/write state + credentials files
index.ts                 — re-exports activate()
```

## How it works

### Poll loop
`setInterval` calls `pullTask()` over HTTP every 2s. `pullTask()` also serves as the heartbeat — it updates `last_seen_at` on the backend on every call, keeping the connection status green in the UI.

When a task is returned, the plugin spawns `openclaw gateway call knotwork.execute_task --params <task-json>`. The spawn context is required because `subagent.run()` only works inside a gateway request handler. Multiple tasks run concurrently (default: up to 3, configurable via `maxConcurrentTasks`).

If the gateway is temporarily unavailable, spawns retry with **exponential backoff + jitter** (2s → 4s → 8s → … → 60s cap, ±20% jitter) for up to 5 minutes before reporting the task as failed over HTTP.

### Session Execution Contract

| Operation | What happens |
|---|---|
| Session identity | Deterministic scoped key from `task.session_name` |
| Send message | `subagent.run()` inside a gateway request context |
| Completion | `agent.wait(runId)` as completion signal; `chat.history` reads output |

### Runtime lease
Only one long-running process owns the background worker. If OpenClaw is force-killed and relaunched with a recycled PID, the lease is stolen once the heartbeat TTL (30s) expires. Lease renewed every 10s.

### WS migration path
When switching from polling to WebSockets: replace `setInterval + pullTask()` with a WS push that delivers the pre-claimed task. The spawn logic (`execute_task --params <task>`) is identical — nothing else changes.

## Setup

**1. Generate a handshake token in Knotwork**

Settings > Agents > Generate Handshake Token → copies `kw_oc_...` token.

**2. Install the plugin**

```bash
openclaw plugins install knotwork-bridge-0.2.0.tar.gz
```

Or package locally:

```bash
npm run package:tarball
# writes: artifacts/knotwork-bridge-0.2.0.tar.gz
openclaw plugins install artifacts/knotwork-bridge-0.2.0.tar.gz
```

**3. Configure**

In `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "knotwork-bridge": {
        "enabled": true,
        "config": {
          "knotworkBackendUrl": "http://host.docker.internal:8000",
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

**4. Start OpenClaw**

The plugin handshakes automatically on first startup. After pairing, `pluginInstanceId` + `integrationSecret` are persisted locally and survive restarts without needing a new token.

If OpenClaw prompts for permissions during install, approve `operator.read` and `operator.write`.

## Config reference

| Key | Required | Default | Notes |
|---|---|---|---|
| `knotworkBackendUrl` | yes | — | URL reachable from OpenClaw runtime |
| `handshakeToken` | yes | — | One-time token from Knotwork Settings |
| `pluginInstanceId` | — | auto-generated | Keep stable across restarts |
| `autoHandshakeOnStart` | — | `true` | Auto-handshake on primary runtime startup |
| `taskPollIntervalMs` | — | `2000` | Min 500ms |
| `maxConcurrentTasks` | — | `3` | Max concurrent spawns |
| `gatewayRetryWindowMs` | — | `300000` | Gateway backoff window before marking task failed (5 min) |

## Persistent state

```
~/.openclaw/knotwork-bridge-state.json   — pluginInstanceId, last handshake, recent tasks
~/.openclaw/extensions/knotwork-bridge/credentials.json  — integrationSecret (auto-removed on uninstall)
```

Only one long-running process holds the runtime lease. CLI/plugin-load contexts (`openclaw gateway call ...`) expose RPC methods but do not start the background worker.

## Gateway RPC methods

| Method | Description |
|---|---|
| `knotwork.status` | Live state: handshake status, config, running tasks |
| `knotwork.logs` | Last 200 log lines from in-memory buffer |
| `knotwork.handshake` | Re-handshake and re-sync agents |
| `knotwork.sync_agents` | Alias for `knotwork.handshake` |
| `knotwork.execute_task` | Pull and run one task; or pass `--params '{"task":{...}}'` to run a pre-claimed task |
| `knotwork.reset_connection` | Clear persisted credentials; optionally reset instance ID |

## Debugging

### Live status

```bash
openclaw gateway call knotwork.status
openclaw gateway call knotwork.logs
openclaw gateway call knotwork.handshake
openclaw gateway call knotwork.reset_connection
openclaw gateway call knotwork.execute_task   # pull + run one task immediately
openclaw gateway call knotwork.debug_run_prompt --params '{"userPrompt":"Reply with ok"}'
```

### Docker logs

```bash
docker logs <container> 2>&1 | grep knotwork-bridge
docker logs -f <container> 2>&1 | grep knotwork-bridge
```

### Log format

```
2026-03-20T05:51:32Z startup:background-enabled context=runtime
2026-03-20T05:51:34Z spawn:start id=<uuid> context=poll concurrent=1
2026-03-20T05:51:38Z task:start id=<uuid> node=agent_main run=<run-id> session=knotwork:...
2026-03-20T05:51:39Z event:post:ok id=<uuid> type=log
2026-03-20T05:51:45Z spawn:done id=<uuid> concurrent=0
```

### Common issues

**`plugin not found: knotwork-bridge`** — plugin directory missing or `openclaw.plugin.json` id mismatch. Reinstall via tarball.

**`missing scope: operator.write`** — plugin installed without gateway scopes. Reinstall, restart, then run `openclaw gateway call knotwork.handshake`.

**`startup:background-disabled runtime_lease=busy`** — another OpenClaw process holds the lease. Stop other instances or wait ≤30s for the stale lease to expire.

## Global Knotwork MCP

If you want every OpenClaw session, including plugin-created `subagent.run(...)` sessions, to have native Knotwork MCP access, register Knotwork as a global MCP server in `~/.openclaw/openclaw.json`.

The bridge includes a stdio MCP proxy at:

```text
/home/node/.openclaw/extensions/knotwork-bridge/src/openclaw/knotwork-mcp-proxy.mjs
```

Example config:

```json
{
  "mcpServers": {
    "knotwork": {
      "command": "node",
      "args": [
        "/home/node/.openclaw/extensions/knotwork-bridge/src/openclaw/knotwork-mcp-proxy.mjs"
      ],
      "env": {
        "KNOTWORK_BACKEND_URL": "http://host.docker.internal:8000",
        "KNOTWORK_WORKSPACE_ID": "<workspace-id>",
        "KNOTWORK_PRIVATE_KEY_PATH": "/home/node/.openclaw/knotwork-agent.key",
        "KNOTWORK_MCP_PROXY_LOG_PATH": "/tmp/knotwork-mcp-proxy.log"
      }
    }
  }
}
```

After editing the config:

```bash
bash agent-bridge/plugins/openclaw/sync-to-openclaw.sh --yes
docker exec openclaw-openclaw-gateway-1 openclaw gateway restart
```

To verify that a plugin-created session can see the global MCP server, use the debug RPC:

```bash
docker exec openclaw-openclaw-gateway-1 openclaw gateway call knotwork.debug_run_prompt \
  --params '{"taskId":"debug-knotwork-mcp","sessionName":"knotwork:debug:mcp","userPrompt":"Use the Knotwork MCP tools to list the available Knotwork tool names, then summarize them in one sentence."}'

docker exec openclaw-openclaw-gateway-1 sed -n '1,200p' /tmp/knotwork-mcp-proxy.log
```

If the second command shows `tools/list` or `tools/call`, the session used the native Knotwork MCP bridge rather than only the semantic action protocol.

## Dev workflow

Source lives here. The running extension is at `~/.openclaw/extensions/knotwork-bridge/`. After any source change:

```bash
./sync-to-openclaw.sh
docker restart openclaw-openclaw-gateway-1
```

`sync-to-openclaw.sh` rsyncs `src/` and `openclaw.plugin.json` into the extension dir and ensures `plugins.load.paths` contains `/home/node/.openclaw/extensions/knotwork-bridge` so the runtime gateway actually loads the bridge on startup. A direct symlink doesn't work because Docker bind-mount layering prevents the container from resolving a host-path symlink into the plugin mount point.
