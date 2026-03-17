# Activity 08 — Install

Full end-to-end install sequence: from generating a token in Knotwork to a verified, running plugin. This is the happy path. For what happens after the plugin starts, see [Activity 02 (Plugin Startup)](../plugin/startup.md) and [Activity 01 (Pairing)](./pairing.md).

---

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Knotwork UI
    participant KB as Knotwork Backend
    participant FS as Filesystem
    participant OC as OpenClaw (CLI + Gateway)
    participant Plugin as OpenClaw Plugin

    rect rgb(240, 248, 255)
        Note over User,KB: Phase 1 — Generate install token (Knotwork side)
        User->>UI: Settings → Agents → OpenClaw → Connect
        UI->>KB: POST /api/v1/workspaces/{id}/openclaw/handshake-token
        Note right of KB: service.py:create_handshake_token L76
        KB->>KB: INSERT openclaw_handshake_tokens (token=kw_oc_..., expires 1yr)
        KB-->>UI: token
        UI-->>User: install URL /openclaw-plugin/install?token=kw_oc_...
    end

    rect rgb(248, 255, 240)
        Note over User,KB: Phase 2 — Fetch install bundle
        User->>KB: GET /openclaw-plugin/install?token=kw_oc_...
        Note right of KB: install_router.py:get_install_bundle L51
        KB->>KB: validate token exists + not expired
        KB->>KB: read settings.openclaw_plugin_package_url (config.py)
        KB-->>User: JSON bundle
        Note over User: bundle contains: uninstall_command, cleanup_command,<br/>download_command, install_command, config_snippet, verification_command
    end

    rect rgb(255, 248, 240)
        Note over User,OC: Phase 3 — Remove old install (if any)
        User->>OC: openclaw plugins uninstall knotwork-bridge
        OC-->>User: ok (or plugin not found — continue anyway)
        User->>FS: rm -rf ~/.openclaw/extensions/knotwork-bridge
        User->>FS: rm ~/.openclaw/knotwork-bridge-state.json (optional: fresh state)
    end

    rect rgb(255, 240, 255)
        Note over User,OC: Phase 4 — Download and install plugin artifact
        User->>OC: curl -fLJO ARTIFACT_URL
        OC-->>FS: knotwork-bridge-0.2.0.tar.gz saved locally
        User->>OC: openclaw plugins install knotwork-bridge-0.2.0.tar.gz
        OC->>OC: register plugin, extract to extensions/knotwork-bridge
        OC-->>User: prompt: grant permissions to knotwork-bridge?
        Note over User,OC: MUST pause here — agent-driven installs must hand<br/>control back to human for approval
        User->>OC: approve scopes (operator.read + operator.write)
        OC-->>User: plugin installed
    end

    rect rgb(240, 255, 255)
        Note over User,FS: Phase 5 — Write config
        User->>FS: edit ~/.openclaw/openclaw.json
        Note right of FS: add config_snippet block:<br/>knotworkBackendUrl<br/>handshakeToken<br/>autoHandshakeOnStart: true<br/>taskPollIntervalMs: 2000
    end

    rect rgb(255, 255, 240)
        Note over User,Plugin: Phase 6 — Restart and auto-handshake
        User->>OC: restart OpenClaw gateway
        OC->>Plugin: activate(api)
        Plugin->>FS: read ~/.openclaw/knotwork-bridge-state.json
        FS-->>Plugin: empty (no integrationSecret)
        Plugin->>OC: gatewayRpc chat.history (scope preflight: operator.read)
        OC-->>Plugin: ok
        Plugin->>OC: gatewayRpc agent (scope preflight: operator.write)
        OC-->>Plugin: ok
        Plugin->>OC: agents.list (discover available agents)
        OC-->>Plugin: agent list
        Plugin->>KB: POST /openclaw-plugin/handshake
        Note right of Plugin: token + plugin_instance_id + agents[]
        KB->>KB: validate token, upsert integration + remote agents
        KB-->>Plugin: integration_secret
        Plugin->>FS: write ~/.openclaw/knotwork-bridge-state.json
        Note right of FS: pluginInstanceId + integrationSecret
        Plugin->>Plugin: setInterval pollAndRun — poll loop started
    end

    rect rgb(248, 240, 255)
        Note over User,Plugin: Phase 7 — Verify
        User->>OC: openclaw gateway call knotwork.handshake
        OC->>Plugin: knotwork.handshake RPC
        Plugin->>KB: POST /openclaw-plugin/handshake (re-confirms pairing)
        KB-->>Plugin: integration_secret
        Plugin-->>OC: ok + pluginInstanceId
        OC-->>User: verified

        User->>UI: Settings → Agents → OpenClaw
        UI->>KB: GET /api/v1/workspaces/{id}/openclaw/integrations
        KB-->>UI: integration row (status=connected, last_seen_at=now)
        UI-->>User: Connected badge + synced agents list
    end
```

---

## Failure Conditions

The install is considered failed if any of these are true after Phase 7:

| Condition | Cause | Fix |
|---|---|---|
| `openclaw gateway call knotwork.handshake` returns missing-scope error | Scopes not granted during permission approval | Reinstall and approve `operator.read` + `operator.write` |
| `plugin not found: knotwork-bridge` | Standard installer did not complete | Re-run `openclaw plugins install <file>` |
| Plugin starts without `knotworkBackendUrl` or `handshakeToken` | Config not written to `~/.openclaw/openclaw.json` | Re-apply `config_snippet`, restart gateway |
| Knotwork UI shows no integration | Handshake POST never reached backend | Check `knotworkBackendUrl` in config; verify network |

Source: [`install_router.py:get_install_bundle L148`](../../../../../../backend/knotwork/openclaw_integrations/install_router.py#L148) — `installation_failure_conditions` list in bundle response.

---

## Files Read

| File | Phase | Who reads | Purpose |
|---|---|---|---|
| `~/.openclaw/openclaw.json` | 6 | Plugin via `bridge.ts:getConfig` (L30) | Read `knotworkBackendUrl`, `handshakeToken`, `taskPollIntervalMs` |
| `~/.openclaw/knotwork-bridge-state.json` | 6 | `plugin.ts:readPersistedState` (L132) | Check for existing `integrationSecret` |

## Files Written

| File | Phase | Who writes | What |
|---|---|---|---|
| `~/.openclaw/openclaw.json` | 5 | User (manual edit) | `config_snippet` block with backend URL + token |
| `~/.openclaw/knotwork-bridge-state.json` | 6 | `plugin.ts:persistSnapshot` (L157) | `pluginInstanceId` + `integrationSecret` |
| `~/.openclaw/knotwork-bridge-runtime.lock` | 6 | `plugin.ts:acquireRuntimeLease` (L214) | `{ pid, acquired_at }` |
| `~/.openclaw/extensions/knotwork-bridge/` | 4 | OpenClaw installer | Plugin bundle (extracted from `.tar.gz`) |

## DB Tables Written (backend)

| Table | Phase | Operation | Source |
|---|---|---|---|
| `openclaw_handshake_tokens` | 1 | INSERT | `service.py:create_handshake_token` (L76) |
| `openclaw_integrations` | 6 | INSERT | `service.py:plugin_handshake` (L142) |
| `openclaw_remote_agents` | 6 | INSERT per agent | `service.py:plugin_handshake` (L166) |
| `openclaw_handshake_tokens` | 6 | UPDATE `used_at` | `service.py:plugin_handshake` (L204) |
