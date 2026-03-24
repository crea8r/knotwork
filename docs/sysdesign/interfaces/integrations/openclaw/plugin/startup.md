# Activity 02 — Plugin Startup

Happens every time OpenClaw starts or loads the plugin. The plugin must load persisted state, determine whether it is the primary runtime (lease), optionally auto-handshake, then start the background timer loop.

Key constraint: **only one process runs the poll loop at a time**. Multiple OpenClaw contexts (CLI calls, plugin-list commands) all invoke `activate()`, but only the `runtime` context acquires the lease and starts background work.

---

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    participant OC as OpenClaw Runtime
    participant Plugin as Plugin (plugin.ts)
    participant FS as Filesystem
    participant KB as Knotwork Backend

    OC->>Plugin: activate(api)
    Plugin->>Plugin: detectActivationContext (inspect process.argv)

    alt context is cli_gateway_call or cli_plugins or cli_help
        Plugin->>Plugin: backgroundWorkerEnabled = false
        Note over Plugin: passive — no polling, no handshake
    else context is runtime
        Plugin->>FS: read ~/.openclaw/knotwork-bridge-state.json
        alt file exists
            FS-->>Plugin: pluginInstanceId, recentTasks, logs
        else file not found
            FS-->>Plugin: empty state
        end

        Plugin->>FS: read ~/.openclaw/extensions/knotwork-bridge/credentials.json
        alt file exists AND instanceId matches
            FS-->>Plugin: integrationSecret
            Plugin->>Plugin: restore integrationSecret
        else file missing or instanceId mismatch
            Plugin->>Plugin: discard secret (log: instance_id_mismatch or no credentials)
        end

        Plugin->>FS: write ~/.openclaw/knotwork-bridge-state.json (normalised snapshot, no secret)
        Plugin->>Plugin: log gateway ws://127.0.0.1:PORT/ tokenPresent=...

        Plugin->>FS: open ~/.openclaw/knotwork-bridge-runtime.lock (O_EXCL)
        alt lock created successfully
            FS-->>Plugin: file handle
            Plugin->>FS: write pid + acquired_at to lock file
            Plugin->>Plugin: runtimeLockOwner = true, backgroundWorkerEnabled = true
        else lock file exists — read incumbent PID
            FS-->>Plugin: existing lock content
            alt incumbent process is alive (kill pid 0)
                Plugin->>Plugin: backgroundWorkerEnabled = false
                Note over Plugin: passive — another process owns the loop
            else incumbent is dead
                Plugin->>FS: rm lock file
                Plugin->>FS: retry open lock (O_EXCL)
                FS-->>Plugin: file handle
                Plugin->>Plugin: runtimeLockOwner = true, backgroundWorkerEnabled = true
            end
        end

        alt backgroundWorkerEnabled and integrationSecret missing and autoHandshakeOnStart
            Plugin->>OC: gatewayRpc (scope preflight)
            OC-->>Plugin: ok or scope error
            Plugin->>KB: POST /openclaw-plugin/handshake
            alt handshake ok
                KB-->>Plugin: integration_secret
                Plugin->>FS: write credentials.json (integrationSecret)
            else scope error
                Plugin->>Plugin: log startup:handshake-stopped (missing scope)
                Note over Plugin: polling disabled — human must fix scopes
            else other error
                Plugin->>Plugin: scheduleHandshakeRetry in 15s
            end
        end

        Plugin->>Plugin: setInterval every taskPollIntervalMs
        Note over Plugin: each tick is a no-op until both backgroundWorkerEnabled=true AND integrationSecret≠null<br/>each active tick reports capacity to Knotwork and may claim one task for subprocess execution
        Plugin->>Plugin: register SIGTERM / SIGINT / exit handlers
        Note over Plugin: plugin running — timer loop begins only after successful handshake
    end
```

---

## Input

### From OpenClaw runtime
- `api: OpenClawApi` — the OpenClaw plugin API object passed to `activate()`
- `process.argv` — used to detect activation context

Source: [`plugin.ts:activate`](../../../../../../plugins/openclaw/src/plugin.ts#L43), [`plugin.ts:detectActivationContext`](../../../../../../plugins/openclaw/src/plugin.ts#L124)

### From filesystem
- `~/.openclaw/knotwork-bridge-state.json` — persisted identity + history (`pluginInstanceId`, `recentTasks`, logs)
- `~/.openclaw/extensions/knotwork-bridge/credentials.json` — persisted secret (`integrationSecret`); absent after fresh install
- `~/.openclaw/extensions/knotwork-bridge/runtime.lock` — runtime lease mutex

### From config (`~/.openclaw/openclaw.json` via `api.config`)
- `gateway.port` / `OPENCLAW_GATEWAY_PORT` — WebSocket gateway port (default: 18789)
- `gateway.auth.token` / `OPENCLAW_GATEWAY_TOKEN` — auth token for gateway
- `plugins.entries.knotwork-bridge.config.taskPollIntervalMs` — poll interval (default: 2000ms)

Source: [`openclaw/bridge.ts:getGatewayConfig`](../../../../../../plugins/openclaw/src/openclaw/bridge.ts#L60), [`openclaw/bridge.ts:getConfig`](../../../../../../plugins/openclaw/src/openclaw/bridge.ts#L30)

---

## Output

### In-memory `PluginState`

```typescript
// types.ts:PluginState
{
  pluginInstanceId: string | null
  integrationSecret: string | null
  stateFilePath: string | null
  runtimeLockPath: string | null
  activationContext: string | null       // "runtime" | "cli_gateway_call" | ...
  backgroundWorkerEnabled: boolean       // true only for runtime context with lease
  lastHandshakeAt: string | null
  lastHandshakeOk: boolean
  lastError: string | null
  lastTaskAt: string | null
  runningTaskId: string | null
  runtimeLeaseOwnerPid: number | null
  recentTasks: RecentTask[]
  logs: string[]
}
```

Source: [`types.ts:PluginState`](../../../../../../plugins/openclaw/src/types.ts#L97)

### Files written

| File | When | What |
|---|---|---|
| `~/.openclaw/knotwork-bridge-state.json` | After state load (`stateHydrated = true`) | Normalised snapshot — `pluginInstanceId` + history, **no secret** |
| `~/.openclaw/extensions/knotwork-bridge/credentials.json` | After successful handshake | `{ integrationSecret }` |
| `~/.openclaw/extensions/knotwork-bridge/runtime.lock` | On lease acquisition | `{ pid, acquired_at, plugin_id }` |

Source: [`plugin.ts:persistSnapshot`](../../../../../../plugins/openclaw/src/plugin.ts#L157), [`plugin.ts:acquireRuntimeLease`](../../../../../../plugins/openclaw/src/plugin.ts#L214)

---

## Files Read

| File | Read by | Purpose |
|---|---|---|
| `~/.openclaw/knotwork-bridge-state.json` | `plugin.ts:readPersistedState` | Recover `pluginInstanceId` + history across restarts |
| `~/.openclaw/extensions/knotwork-bridge/credentials.json` | `plugin.ts:readPersistedCredentials` | Recover `integrationSecret` across restarts (absent = not yet paired) |
| `~/.openclaw/extensions/knotwork-bridge/runtime.lock` | `state/lease.ts:acquireRuntimeLease` | Read incumbent PID to check if process is still alive |
| `~/.openclaw/openclaw.json` *(via OpenClaw api)* | `openclaw/bridge.ts:getConfig` (L30), `openclaw/bridge.ts:getGatewayConfig` (L60) | Read plugin config + gateway port/token |

---

## Files Written

| File | Written by | What |
|---|---|---|
| `~/.openclaw/knotwork-bridge-state.json` | `plugin.ts:persistSnapshot` | `pluginInstanceId` + history — **no `integrationSecret`** |
| `~/.openclaw/extensions/knotwork-bridge/credentials.json` | `plugin.ts:persistCredentials` | `{ integrationSecret }` — auto-cleaned on uninstall |
| `~/.openclaw/extensions/knotwork-bridge/runtime.lock` | `state/lease.ts:acquireRuntimeLease` | `{ pid, acquired_at, plugin_id }` JSON |

---

## Runtime Lease Detail

The lease uses `open(path, 'wx')` — the `x` flag means "fail if file exists". This gives mutual exclusion without an external lock service.

On lease acquisition failure, the incumbent PID is checked with `process.kill(pid, 0)`. If the process is dead (throws ESRCH), the stale lock is removed and acquisition retries.

On clean exit (`SIGTERM`, `SIGINT`, `process.exit`), the lock file is removed. On crash, the next startup detects the dead PID and cleans up.

Source: [`plugin.ts:acquireRuntimeLease`](../../../../../../plugins/openclaw/src/plugin.ts#L214), [`plugin.ts:releaseRuntimeLease`](../../../../../../plugins/openclaw/src/plugin.ts#L184), [`plugin.ts:releaseRuntimeLeaseSync`](../../../../../../plugins/openclaw/src/plugin.ts#L194)

---

## Log Lines (for debugging)

```
startup:background-disabled context=cli_gateway_call  ← passive context
startup:background-disabled runtime_lease=busy        ← another process owns the lease
startup:background-enabled context=runtime            ← this process owns the lease
gateway: ws://127.0.0.1:18789/ tokenPresent=true      ← always emitted for diagnostics
state:loaded secret=...xxxx                           ← persisted secret restored
state:ignored persisted secret due_to_instance_id_mismatch=true
startup:handshake-failed <error>
startup:handshake-stopped reason=missing_required_operator_scope
```

All lines written to: stdout + `state.logs` ring buffer (last 200 lines).

Source: [`plugin.ts:log`](../../../../../../plugins/openclaw/src/plugin.ts#L66)
