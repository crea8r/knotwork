# Activity 07 — Error Recovery

How the plugin handles the different failure modes: invalid credentials, missing gateway scopes, execution timeouts, and operator stops.

---

## 401 — Credential Recovery

Happens when the backend rejects the plugin's `integration_secret`. The plugin clears the stale secret and immediately attempts a fresh handshake.

```mermaid
sequenceDiagram
    autonumber
    participant Plugin as Plugin (plugin.ts)
    participant FS as Filesystem
    participant KB as Knotwork Backend

    Plugin->>KB: POST /openclaw-plugin/pull-task or tasks/{id}/event
    KB-->>Plugin: 401 Invalid plugin credentials

    Plugin->>Plugin: isInvalidCredentialsError -> true
    Plugin->>Plugin: log auth:pull-task-invalid-credentials
    Plugin->>Plugin: state.integrationSecret = null
    Plugin->>FS: write knotwork-bridge-state.json (secret cleared)

    Plugin->>KB: POST /openclaw-plugin/handshake (recoverCredentials)
    alt handshake ok
        KB-->>Plugin: new integration_secret
        Plugin->>FS: write knotwork-bridge-state.json (new secret)
        Plugin->>Plugin: log handshake:recovered
        Plugin->>KB: retry original call (pullTask or postEvent)
        KB-->>Plugin: ok
    else scope error
        KB-->>Plugin: error
        Plugin->>Plugin: log handshake:recover-stopped (missing scope)
        Note over Plugin: polling permanently stopped — human must fix scopes
    else other error
        KB-->>Plugin: error
        Plugin->>Plugin: log handshake:recover-failed
        Plugin->>Plugin: scheduleHandshakeRetry in 15s
        Note over Plugin,KB: retry loop continues until ok or scope error
    end
```

Source: [`plugin.ts:recoverCredentials`](../../../../../../plugins/openclaw/src/plugin.ts#L311), [`plugin.ts:pollAndRun L356`](../../../../../../plugins/openclaw/src/plugin.ts#L356)

---

## Missing Scope Error

Happens when the OpenClaw gateway denies an RPC call because `operator.read` or `operator.write` was not granted. Requires human intervention — no automatic recovery.

```mermaid
sequenceDiagram
    autonumber
    participant Plugin as Plugin (session.ts)
    participant GW as OpenClaw Gateway

    Plugin->>GW: WebSocket connect + RPC call
    GW-->>Plugin: error (missing scope: operator.write)

    Plugin->>Plugin: missingScope(error) -> operator.write
    Plugin->>Plugin: isOperatorScopeError -> true
    Plugin->>Plugin: scopeHelp: build descriptive error message

    Note over Plugin: error propagates up to caller

    alt caught during handshake or startup
        Plugin->>Plugin: log startup:handshake-stopped (missing scope)
        Note over Plugin: do NOT scheduleHandshakeRetry
    else caught during recoverCredentials
        Plugin->>Plugin: log handshake:recover-stopped (missing scope)
        Note over Plugin: stop polling permanently
    end

    Note over Plugin: Human must reinstall plugin with correct scopes,<br/>then run: openclaw gateway call knotwork.handshake
```

Source: [`openclaw/scope.ts:missingScope`](../../../../../../plugins/openclaw/src/openclaw/scope.ts#L30), [`openclaw/scope.ts:isOperatorScopeError`](../../../../../../plugins/openclaw/src/openclaw/scope.ts#L38), [`lifecycle/handshake.ts:scheduleHandshakeRetry`](../../../../../../plugins/openclaw/src/lifecycle/handshake.ts)

---

## Handshake Retry Loop

When a handshake fails for a non-scope reason (network down, backend offline), the plugin retries every 15 seconds until it succeeds.

```mermaid
sequenceDiagram
    autonumber
    participant Plugin as Plugin (plugin.ts)
    participant KB as Knotwork Backend

    Plugin->>KB: POST /openclaw-plugin/handshake
    KB-->>Plugin: error (non-scope: network / backend offline)

    Plugin->>Plugin: log handshake:retry-failed
    Plugin->>Plugin: scheduleHandshakeRetry(reason)
    Note right of Plugin: guard: handshakeRetryTimer != null prevents stacking

    loop every 15s until success or scope error
        Plugin->>KB: POST /openclaw-plugin/handshake
        alt ok
            KB-->>Plugin: integration_secret
            Plugin->>Plugin: polling resumes
        else scope error
            KB-->>Plugin: scope error
            Plugin->>Plugin: stop permanently (no retry)
        else other error
            KB-->>Plugin: error
            Plugin->>Plugin: scheduleHandshakeRetry again
        end
    end
```

Source: [`plugin.ts:scheduleHandshakeRetry`](../../../../../../plugins/openclaw/src/plugin.ts#L266)

---

## Execution Timeout

When `agent.wait` returns `timeout` after 15 minutes, the plugin tries to read the chat history as a fallback before declaring failure.

```mermaid
sequenceDiagram
    autonumber
    participant Plugin as Plugin (session.ts)
    participant GW as OpenClaw Gateway
    participant KB as Knotwork Backend

    Plugin->>GW: req agent.wait (runId, timeoutMs: 900000)
    GW-->>Plugin: res status: timeout

    Plugin->>GW: req chat.history (sessionKey, limit: 50)
    alt history has assistant message
        GW-->>Plugin: messages[]
        Plugin->>Plugin: parseDecisionBlock or use full message
        Plugin->>KB: POST tasks/{id}/event (completed or escalation)
    else no message or history call failed
        GW-->>Plugin: empty or error
        Plugin->>Plugin: return failed (agent timed out after 900s)
        Plugin->>KB: POST tasks/{id}/event (failed)
        KB->>KB: UPDATE task status=failed
        KB->>KB: UPDATE run_node_states status=failed
    end
```

Source: [`openclaw/session.ts:executeTask`](../../../../../../plugins/openclaw/src/openclaw/session.ts)

---

## Operator Stop

When an operator clicks "Stop run", `run.status` is set to `stopped`. The adapter detects this on its next poll (Activity 05).

```mermaid
sequenceDiagram
    autonumber
    actor Operator
    participant KB as Knotwork Backend
    participant Adapter as OpenClawAdapter
    participant DB as PostgreSQL

    Operator->>KB: POST /runs/{id}/abort
    KB->>DB: UPDATE runs SET status=stopped

    loop adapter poll every 2s
        Adapter->>DB: SELECT runs WHERE id = run_id
        DB-->>Adapter: run.status = stopped
        Adapter->>DB: UPDATE run_node_states SET status=failed
        Adapter-->>KB: yield NodeEvent failed (Run was stopped by operator)
        Note over Adapter: exits poll loop — task row left in claimed state
    end

    Note over KB: Plugin continues executing OpenClaw agent until natural finish,<br/>then posts an event that nobody reads. Task row orphaned as completed/failed.<br/>Acceptable — the run is already marked stopped.
```

---

## Gateway WebSocket Errors

```mermaid
sequenceDiagram
    autonumber
    participant Plugin as Plugin (session.ts)
    participant GW as OpenClaw Gateway

    Plugin->>GW: WebSocket connect
    alt ws.onerror fires
        GW-->>Plugin: error event
        Plugin->>Plugin: reject: WebSocket error calling gateway method
    else ws.onclose with non-1000/1001 code
        GW-->>Plugin: close event (code, reason)
        Plugin->>Plugin: reject: WebSocket closed (code reason)
    else RPC timeout
        Plugin->>Plugin: reject: gateway method timed out after Nms
    end

    Plugin->>Plugin: check missingScope(error)
    alt scope error
        Plugin->>Plugin: scopeHelp: descriptive error, throw upward
    else other error
        Plugin->>Plugin: throw as-is
        Note right of Plugin: executeTask throws<br/>pollAndRun catches -> submitEvent failed
    end
```

Source: [`openclaw/gateway.ts:gatewayRpc`](../../../../../../plugins/openclaw/src/openclaw/gateway.ts)

---

## Summary: What Requires Human Intervention

| Error | Auto-recovery | Human action needed |
|---|---|---|
| 401 Invalid credentials | Yes — re-handshakes automatically | Only if `handshakeToken` is also expired or revoked |
| Missing scope | No — stops permanently | Reinstall plugin with `operator.read` + `operator.write` scopes |
| Backend unreachable | Yes — retries every 15s | Only if backend stays down indefinitely |
| `agent.wait` timeout | Partial — tries chat.history | Check OpenClaw agent for hang; consider task-size reduction |
| arq 24h timeout | No | Investigate stuck run; restart worker |
| Operator stop | N/A (intentional) | None |

---

## Files Read / Written

| File | When | Operation |
|---|---|---|
| `~/.openclaw/knotwork-bridge-state.json` | On credential reset | WRITE: clear `integrationSecret` |
| `~/.openclaw/knotwork-bridge-state.json` | After successful recovery handshake | WRITE: new `integrationSecret` + `lastHandshakeAt` |

Source: [`plugin.ts:resetPersistedSecret`](../../../../../../plugins/openclaw/src/plugin.ts#L253), [`plugin.ts:persistState`](../../../../../../plugins/openclaw/src/plugin.ts#L180)

## DB Tables Written (backend — on failed event)

| Table | Operation | Source |
|---|---|---|
| `openclaw_execution_tasks` | UPDATE `status=failed`, `error_message`, `completed_at` | `service.py:plugin_submit_task_event` (L630) |
| `openclaw_execution_events` | INSERT `event_type=failed` | `service.py:plugin_submit_task_event` (L606) |
| `run_node_states` | UPDATE `status=failed`, `error` | `service.py:plugin_submit_task_event` (L636) |
| `runs` | UPDATE `status=failed`, `error` | `service.py:plugin_submit_task_event` (L652) |
