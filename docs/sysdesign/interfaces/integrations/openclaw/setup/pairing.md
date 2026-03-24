# Activity 01 — Pairing

One-time process that links an OpenClaw plugin instance to a Knotwork workspace. After pairing, the plugin has an `integration_secret` it can use for all subsequent API calls. Pairing does **not** need to be repeated unless you disconnect or the secret is invalidated.

---

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Knotwork UI
    participant KB as Knotwork Backend
    participant FS as Filesystem
    participant Plugin as OpenClaw Plugin
    participant OC as OpenClaw Gateway

    User->>UI: Settings → Agents → OpenClaw → Connect
    UI->>KB: POST /workspaces/{id}/openclaw/handshake-token
    KB->>KB: INSERT openclaw_handshake_tokens (expires 1yr)
    KB-->>UI: token = kw_oc_...
    UI-->>User: copy install URL /openclaw-plugin/install?token=...

    User->>KB: GET /openclaw-plugin/install?token=...
    KB->>KB: validate token exists + not expired
    KB-->>User: JSON bundle (uninstall/download/install cmds + config_snippet)

    Note over User,OC: User (or an OpenClaw agent) runs the install steps

    User->>OC: openclaw plugins uninstall knotwork-bridge
    User->>FS: rm -rf ~/.openclaw/extensions/knotwork-bridge
    User->>OC: curl download artifact + openclaw plugins install <file>
    OC-->>User: prompt for permission approval (operator.read, operator.write)
    User->>OC: approve scopes
    User->>FS: write config_snippet to ~/.openclaw/openclaw.json
    User->>OC: restart OpenClaw gateway

    Note over Plugin: activate() called on startup

    Plugin->>FS: read ~/.openclaw/knotwork-bridge-state.json
    FS-->>Plugin: no integrationSecret found

    Plugin->>OC: gatewayRpc chat.history (scope preflight)
    OC-->>Plugin: ok (operator.read confirmed)
    Plugin->>OC: gatewayRpc agent (scope preflight)
    OC-->>Plugin: ok (operator.write confirmed)

    Plugin->>OC: agents.list or gateway call agents.list
    OC-->>Plugin: agent list

    Plugin->>KB: POST /openclaw-plugin/handshake
    Note right of Plugin: token, plugin_instance_id, agents[]

    KB->>KB: validate token (exists, not expired)
    KB->>KB: upsert openclaw_integrations row
    KB->>KB: upsert openclaw_remote_agents rows
    KB->>KB: token.used_at = now
    KB-->>Plugin: integration_secret + integration_id

    Plugin->>FS: write ~/.openclaw/knotwork-bridge-state.json
    Note right of FS: pluginInstanceId + integrationSecret

    Plugin->>Plugin: log handshake:ok secret=...xxxx

    Note over User,Plugin: Verification step

    User->>OC: openclaw gateway call knotwork.handshake
    OC->>Plugin: knotwork.handshake RPC
    Plugin->>KB: POST /openclaw-plugin/handshake (re-handshake)
    KB-->>Plugin: integration_secret
    Plugin-->>OC: ok + pluginInstanceId
    OC-->>User: pairing verified
```

---

## Input

### From user/Knotwork UI
- User action: click Connect in Settings → Agents → OpenClaw

### From plugin config (`~/.openclaw/openclaw.json`)
```json
{
  "plugins": { "entries": { "knotwork-bridge": {
    "config": {
      "knotworkBackendUrl": "https://...",
      "handshakeToken": "kw_oc_...",
      "autoHandshakeOnStart": true
    }
  }}}
}
```
Source: [`openclaw/bridge.ts:getConfig`](../../../../../../plugins/openclaw/src/openclaw/bridge.ts#L30) — merges `api.pluginConfig`, `api.config.plugins.entries`, and env vars.

**Note — `pluginInstanceId` is not set in `openclaw.json`.** The plugin resolves it with the following priority (see `plugin.ts` L108–109):

1. `openclaw.json` → `config.pluginInstanceId` (or env `KNOTWORK_PLUGIN_INSTANCE_ID`) — only if you want to pin a fixed ID
2. `~/.openclaw/knotwork-bridge-state.json` → `pluginInstanceId` — source of truth after the first run
3. Auto-generated: `knotwork-{random10}` via `resolveInstanceId()` — first run only

After a successful handshake the backend confirms (or reassigns) the ID in its response; the plugin immediately persists it to the state file. Every subsequent restart loads it from there, keeping the same integration identity.

### From plugin (sent to backend at handshake)
```json
{
  "token": "kw_oc_...",
  "plugin_instance_id": "knotwork-abc123",   // auto-generated on first run, then from state file
  "plugin_version": "0.2.0",
  "agents": [
    {
      "remote_agent_id": "main",
      "slug": "main",
      "display_name": "Main Agent",
      "tools": [],
      "constraints": {}
    }
  ]
}
```
Source: [`bridge.ts:doHandshake`](../../../../../../plugins/openclaw/src/openclaw/bridge.ts#L179)

---

## Output

### From backend to plugin
```json
{
  "integration_id": "uuid",
  "workspace_id": "uuid",
  "accepted": true,
  "synced_agents": 1,
  "integration_secret": "kwoc_..."
}
```
Source: [`service.py:plugin_handshake`](../../../../../../backend/knotwork/openclaw_integrations/service.py#L207) returns `PluginHandshakeResponse`.

### Written by plugin
- `~/.openclaw/knotwork-bridge-state.json` — persists `pluginInstanceId` (survives reinstall)
- `~/.openclaw/extensions/knotwork-bridge/credentials.json` — persists `integrationSecret` (auto-cleaned on uninstall)

Source: `plugin.ts:persistState` → calls `persistSnapshot` + `persistCredentials`

---

## Files Read

| File | Who reads | What for |
|---|---|---|
| `~/.openclaw/knotwork-bridge-state.json` | `plugin.ts:readPersistedState` | Recover `pluginInstanceId` across restarts — **primary source of truth for identity** |
| `~/.openclaw/extensions/knotwork-bridge/credentials.json` | `plugin.ts:readPersistedCredentials` | Recover `integrationSecret` across restarts |
| `~/.openclaw/openclaw.json` | OpenClaw runtime → `openclaw/bridge.ts:getConfig` | Read `knotworkBackendUrl`, `handshakeToken` (and optionally `pluginInstanceId` to pin a fixed ID) |

## Files Written

| File | Who writes | What |
|---|---|---|
| `~/.openclaw/knotwork-bridge-state.json` | `plugin.ts:persistSnapshot` | `pluginInstanceId`, `lastHandshakeAt`, `lastHandshakeOk` (no secret) |
| `~/.openclaw/extensions/knotwork-bridge/credentials.json` | `plugin.ts:persistCredentials` | `integrationSecret` only — auto-cleaned on uninstall |

## DB Tables Written (backend)

| Table | Operation | Source |
|---|---|---|
| `openclaw_handshake_tokens` | INSERT (token creation) | `service.py:create_handshake_token` (L76) |
| `openclaw_handshake_tokens` | UPDATE `used_at` | `service.py:plugin_handshake` (L204) |
| `openclaw_integrations` | INSERT or UPDATE | `service.py:plugin_handshake` (L142) |
| `openclaw_remote_agents` | INSERT or UPDATE per agent | `service.py:plugin_handshake` (L166) |

---

## Agent Discovery (plugin side)

Before calling `doHandshake`, the plugin discovers available OpenClaw agents via a four-step fallback:

```
1. api.agents.list()           ← SDK method (preferred)
2. gateway.call('agents.list') ← gateway RPC
3. gateway.call('agent.list')  ← alternate name
4. config.agents.list          ← static config
5. default stub: [{ remote_agent_id: 'main', slug: 'main' }]
```

Source: [`bridge.ts:discoverAgents`](../../../../../../plugins/openclaw/src/openclaw/bridge.ts#L117)

The discovered agents are sent in the handshake payload and persisted as `OpenClawRemoteAgent` rows.

---

## Scope Pre-flight

Before sending the handshake, the plugin probes the OpenClaw gateway for required scopes:

```typescript
// session.ts:verifyGatewayOperatorScopes
await rpc('chat.history', {})  // probes operator.read
await rpc('agent', {})         // probes operator.write
```

Source: [`openclaw/session.ts:verifyGatewayOperatorScopes`](../../../../../../plugins/openclaw/src/openclaw/session.ts)

If either probe returns a scope error, `isOperatorScopeError` returns true and the startup stops with a clear error message. Any non-scope error (business-logic rejection) is treated as proof the scope was granted.

Source: [`openclaw/scope.ts:isOperatorScopeError`](../../../../../../plugins/openclaw/src/openclaw/scope.ts)

---

## Re-pairing

If the `integrationSecret` is invalidated (backend returns 401), the plugin automatically clears it and re-handshakes. Manual re-handshake:

```bash
openclaw gateway call knotwork.handshake
```

Source: [`plugin.ts` RPC handler `knotwork.handshake`](../../../../../../plugins/openclaw/src/plugin.ts#L538)

To fully reset (useful after reconnecting to a different workspace):

```bash
openclaw gateway call knotwork.reset_connection
```

Source: [`plugin.ts` RPC handler `knotwork.reset_connection`](../../../../../../plugins/openclaw/src/plugin.ts#L552)
