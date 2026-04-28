# Knotwork OpenClaw Plugin

Bridge between OpenClaw and Knotwork. The live plugin authenticates as a Knotwork agent member with an ed25519 key, polls the workspace inbox, groups inbox deliveries into executable sessions, and runs each session through an OpenClaw subagent using the semantic action path.

## File structure

```text
src/
  plugin.ts                    activate(), state persistence, startup wiring
  types.ts                     shared plugin types
  lifecycle/
    auth.ts                    ed25519 challenge-response -> JWT
    rpc.ts                     knotwork.* gateway RPC registrations
    spawn.ts                   gateway subprocess spawning and retry policy
    startup.ts                 state hydration and runtime-lease startup
    timers.ts                  inbox polling, guide refresh, lease renewal
    worker.ts                  bundled task execution and delivery archiving
  openclaw/
    bridge.ts                  config resolution and Knotwork HTTP helpers
    session.ts                 subagent.run() / waitForRun() wrapper
    knotwork-mcp-proxy.mjs     optional global MCP proxy for OpenClaw
    scope.ts                   OpenClaw scope error helpers
  semantic/
    orchestrator.ts            work packet + contract driven task execution
    parser.ts                  json-task / json-action parsing
    prompt-builder.ts          semantic prompts for task and action phases
  state/
    lease.ts                   runtime lease ownership
    persist.ts                 ~/.openclaw/knotwork-bridge-state.json helpers
    task-claim.ts              local claim dedupe between concurrent workers
    tasklog.ts                 debug trace logging
  transport/
    knotwork-rest-transport.ts semantic transport over REST endpoints
    knotwork-mcp-transport.ts  semantic transport over Knotwork MCP
    contract-cache.ts          local MCP contract cache
index.ts                       re-exports activate()
```

## Runtime model

### 1. Activation contexts

The plugin behaves differently depending on how OpenClaw loads it:

- `runtime`: starts the long-running background worker if this process wins the runtime lease.
- `cli_gateway_call`: registers RPC methods only; used by spawned `openclaw gateway call knotwork.execute_task ...` subprocesses.
- `cli_plugins` / `cli_help`: passive contexts; no background worker.

Only the primary `runtime` process polls Knotwork.

### 2. Authentication

The plugin authenticate with:

1. `POST /api/v1/auth/agent-challenge`
2. Sign the returned nonce with the configured ed25519 private key
3. `POST /api/v1/auth/agent-token`
4. Persist the JWT locally and reuse it until it expires or a `401` forces re-auth

`autoAuthOnStart` controls whether the runtime should fetch a JWT automatically when startup finds no cached token.

### 3. Poll loop

The background worker does this every `taskPollIntervalMs`:

1. Fetch the workspace guide from `/api/v1/workspaces/{workspace_id}/guide`
2. Fetch unread inbox deliveries from `/api/v1/workspaces/{workspace_id}/inbox`
3. Collapse duplicate `mentioned_message` / `message_posted` siblings
4. Bundle related deliveries into one execution task by claim key
5. Spawn `openclaw gateway call knotwork.execute_task --params ...` for each task

The claim key is derived from the channel, run, escalation, proposal, or asset identity so repeated inbox deliveries for the same session do not fan out into duplicate work.

### 4. Task execution

Each spawned task runs inside a gateway request context because `api.runtime.subagent.run()` is only available there.

`worker.ts` always runs the semantic path:

1. Build a work packet
2. Load the matching MCP contract
3. Ask the OpenClaw subagent to complete the task in a constrained two-phase prompt
4. Dispatch the resulting Knotwork action through the selected bridge transport
5. Archive handled inbox deliveries

If semantic execution fails, the worker may post a failure message into the source channel and still archives the delivery to avoid delivery loops.

### 5. Bridge transport modes

`knotworkTransportMode` affects only the semantic bridge's internal read/write path:

- `rest`:
  - work packets, contracts, and action execution go through REST endpoints under `/api/v1/workspaces/{workspace_id}/mcp/...`
- `mcp`:
  - the bridge uses `@knotwork/mcp-client` against Knotwork's `/mcp` server for:
    - `list_my_channel_subscriptions`
    - `build_mcp_work_packet`
    - `get_mcp_contract`
    - `execute_mcp_action`

Inbox polling, guide fetches, auth, and channel failure posting remain REST in both modes.

### 6. OpenClaw session contract

The bridge drives OpenClaw subagents through `api.runtime.subagent`:

- Session key:
  - channel tasks -> `agent:<agentId>:channel:<channelId>`
  - other tasks -> `agent:<agentId>:<session_name or fallback>`
- Idempotency key:
  - `knotwork:task:<task_id>`
- Message delivery:
  - `subagent.run({ sessionKey, message, extraSystemPrompt, idempotencyKey, deliver: false })`
- Completion:
  - `waitForRun(runId, timeoutMs=900000)`
  - then `getSessionMessages(sessionKey)`

System prompts are only resent when the session is new or the system prompt changed.

### 7. Lease and retry behavior

- One runtime process owns the background worker via a local runtime lease.
- Lease renewal runs on an interval; stale ownership is retried automatically.
- Spawn retry behavior distinguishes:
  - gateway saturation: fixed retry interval
  - gateway unavailable: exponential backoff with a bounded attempt count
- A watchdog evicts stuck subprocess entries after the spawn TTL.

## Setup

### 1. Generate an ed25519 key

```bash
openssl genpkey -algorithm ed25519 -out ~/.openclaw/knotwork.key
openssl pkey -in ~/.openclaw/knotwork.key -pubout -out /dev/stdout | openssl pkey -pubin -outform DER | tail -c 32 | base64 | tr '+/' '-_' | tr -d '='
```

The second command prints the base64url public key.

### 2. Register the agent in Knotwork

Add the public key to the workspace as an agent member in Knotwork. The live bridge expects that public key to resolve to an active workspace member before auth will succeed.

### 3. Install the plugin

```bash
openclaw plugins install knotwork-bridge-1.0.0.tar.gz
```

Or package locally:

```bash
npm run package:tarball
openclaw plugins install artifacts/knotwork-bridge-1.0.0.tar.gz
```

### 4. Configure `~/.openclaw/openclaw.json`

```json
{
  "plugins": {
    "entries": {
      "knotwork-bridge": {
        "enabled": true,
        "config": {
          "knotworkBackendUrl": "http://host.docker.internal:8000",
          "workspaceId": "<workspace-uuid>",
          "privateKeyPath": "/home/node/.openclaw/knotwork.key",
          "pluginInstanceId": "my-openclaw-1",
          "autoAuthOnStart": true,
          "taskPollIntervalMs": 30000,
          "semanticProtocolDebug": false,
          "knotworkTransportMode": "rest"
        }
      }
    }
  }
}
```

### 5. Start OpenClaw and verify auth

```bash
openclaw gateway call knotwork.status
openclaw gateway call knotwork.auth
```

If `privateKeyPath` is configured, you can also confirm the derived public key:

```bash
openclaw gateway call knotwork.get_public_key
```

## Config reference

### Supported keys

| Key | Required | Default | Notes |
|---|---|---|---|
| `knotworkBackendUrl` | yes | - | Knotwork backend base URL reachable from OpenClaw |
| `workspaceId` | yes | - | Workspace UUID |
| `privateKeyPath` | yes for auth | - | Absolute path to the ed25519 private key PEM |
| `pluginInstanceId` | no | auto-generated | Stable instance identifier persisted in state |
| `autoAuthOnStart` | no | `true` | Auto-fetch JWT on startup when none is cached |
| `taskPollIntervalMs` | no | `30000` | Inbox poll interval; runtime clamps to at least 500 ms |
| `semanticProtocolDebug` | no | `false` | Enables verbose logs, markdown traces, and `knotwork.debug_run_prompt` |
| `knotworkTransportMode` | no | `rest` | Internal semantic transport: `rest` or `mcp` |

### Compatibility keys currently exposed by the schema

These keys are still parsed from config because they remain in `openclaw.plugin.json`, but the current worker path does not branch on them:

| Key | Current behavior |
|---|---|
| `semanticActionProtocolEnabled` | Parsed, but semantic orchestration is always used for task execution |
| `semanticActionStrictMode` | Parsed, but no active runtime branch changes behavior based on it |

## Persistent state

The plugin persists state to:

```text
~/.openclaw/knotwork-bridge-state.json
```

It currently stores:

- `pluginInstanceId`
- `jwt`
- `jwtExpiresAt`
- `guideVersion`
- `lastAuthAt`
- `lastAuthOk`
- `lastError`
- `lastTaskAt`
- `runtimeLockPath`
- `runtimeLeaseOwnerPid`
- `recentTasks`

Important: the state file contains a live bearer token. Treat it as a credential.

When `semanticProtocolDebug` is enabled, the plugin also writes:

- `tasks.log`
- per-session markdown traces under `sessions/`

under the plugin runtime directory.

## Gateway RPC methods

| Method | Description |
|---|---|
| `knotwork.status` | Current state, redacted JWT status, runtime lease info, recent/running tasks |
| `knotwork.logs` | In-memory log ring buffer |
| `knotwork.task_history` | Recent task history |
| `knotwork.clear_log` | Clear the current in-memory log buffer |
| `knotwork.get_public_key` | Derive the configured public key from `privateKeyPath` |
| `knotwork.auth` | Run ed25519 challenge-response auth immediately |
| `knotwork.handshake` | Backward-compat alias for `knotwork.auth` |
| `knotwork.execute_task` | Execute a pre-claimed task or, if no task params are passed, run one poll cycle |
| `knotwork.process_once` | Backward-compat alias for `knotwork.execute_task` |
| `knotwork.debug_run_prompt` | Run an arbitrary prompt through the OpenClaw subagent runtime; requires `semanticProtocolDebug=true` |
| `knotwork.reset_connection` | Clear cached JWT, last error, logs, and recent task state |

## Debugging

### Basic runtime checks

```bash
openclaw gateway call knotwork.status
openclaw gateway call knotwork.logs
openclaw gateway call knotwork.task_history
openclaw gateway call knotwork.auth
openclaw gateway call knotwork.reset_connection
```

### Semantic debug prompt

Only available when `semanticProtocolDebug` is enabled:

```bash
openclaw gateway call knotwork.debug_run_prompt --params '{"userPrompt":"Reply with ok"}'
```

### Docker logs

```bash
docker logs <container> 2>&1 | grep knotwork-bridge
docker logs -f <container> 2>&1 | grep knotwork-bridge
```

### Typical log lines

```text
2026-04-08T10:00:00Z startup:background-enabled context=runtime
2026-04-08T10:00:01Z guide:loaded version=4 hasContent=true
2026-04-08T10:00:01Z poll:got count=2 sessions=1 active=0
2026-04-08T10:00:01Z spawn:start id=<task-id> claim=channel:<channel-id> context=poll concurrent=1
2026-04-08T10:00:03Z task:start id=<task-id> session=channel-<channel-id>
2026-04-08T10:00:12Z task:semantic id=<task-id> batch=applied
2026-04-08T10:00:12Z task:archived id=<task-id> delivery=<delivery-id>
```

## Common issues

**`plugin not found: knotwork-bridge`**

- The plugin is not installed where OpenClaw expects it, or the plugin metadata does not match the loaded extension. Reinstall from the packaged tarball.

**`Missing knotworkBackendUrl in plugin config` / `Missing workspaceId in plugin config` / `Missing privateKeyPath in plugin config`**

- The runtime cannot authenticate or poll until those values are configured.

**`No agent account for this public key`**

- The configured key is not registered as an active agent member in the target workspace.

**`startup:background-disabled runtime_lease=busy`**

- Another OpenClaw runtime process currently owns the background worker lease.

**`startup:background-disabled runtime_subagent=missing`**

- OpenClaw did not expose `api.runtime.subagent` in this context, so the bridge cannot execute tasks.

**`semanticProtocolDebug must be enabled to use knotwork.debug_run_prompt`**

- Set `semanticProtocolDebug: true` in plugin config, reload the plugin, and retry.

## Global Knotwork MCP

The plugin can optionally ship Knotwork into OpenClaw as a global MCP server for every OpenClaw session, including plugin-created `subagent.run(...)` sessions.

This is separate from the bridge's internal semantic transport:

- the bridge still polls inbox items and executes its own semantic work-packet flow
- enabling global MCP also gives the model direct native Knotwork tools inside OpenClaw sessions

The proxy lives at:

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
        "KNOTWORK_PRIVATE_KEY_PATH": "/home/node/.openclaw/knotwork.key",
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

To verify that a plugin-created session can see the global MCP server:

```bash
docker exec openclaw-openclaw-gateway-1 openclaw gateway call knotwork.debug_run_prompt \
  --params '{"taskId":"debug-knotwork-mcp","sessionName":"knotwork:debug:mcp","userPrompt":"Use the Knotwork MCP tools to list the available Knotwork tool names, then summarize them in one sentence."}'

docker exec openclaw-openclaw-gateway-1 sed -n '1,200p' /tmp/knotwork-mcp-proxy.log
```

If the proxy log shows `tools/list` or `tools/call`, the session is using the global Knotwork MCP server directly.

## Dev workflow

Source lives here. The running extension is at `~/.openclaw/extensions/knotwork-bridge/`. After any source change:

```bash
./sync-to-openclaw.sh
docker restart openclaw-openclaw-gateway-1
```

`sync-to-openclaw.sh` syncs `src/` and `openclaw.plugin.json` into the extension directory and ensures `plugins.load.paths` includes the bridge path inside the OpenClaw runtime.
