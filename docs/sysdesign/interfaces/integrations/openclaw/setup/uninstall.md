# Activity 09 — Uninstall

How to fully remove the OpenClaw integration. Uninstall has two independent sides — plugin-side (OpenClaw machine) and Knotwork-side (backend/DB) — and they can be done in either order. Doing both is required for a clean removal.

---

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Knotwork UI
    participant KB as Knotwork Backend
    participant DB as PostgreSQL
    participant FS as Filesystem
    participant OC as OpenClaw (CLI + Gateway)
    participant Plugin as OpenClaw Plugin

    Note over User,Plugin: Plugin-side and Knotwork-side can be done in either order

    rect rgb(255, 240, 240)
        Note over User,Plugin: Plugin-side removal
        User->>OC: openclaw plugins uninstall "knotwork-bridge"
        OC->>Plugin: deactivate / process exit
        Plugin->>FS: releaseRuntimeLeaseSync (rm extensions/knotwork-bridge/runtime.lock)
        Note right of Plugin: process.once exit handler — plugin.ts
        OC-->>User: plugin unregistered

        User->>FS: rm -rf ~/.openclaw/extensions/knotwork-bridge
        Note right of FS: removes plugin bundle, runtime.lock, AND credentials.json<br/>(all co-located in extension dir — cleaned up automatically)

        User->>FS: rm ~/.openclaw/knotwork-bridge-state.json
        Note right of FS: removes pluginInstanceId + history<br/>(optional — intentionally survives reinstall to preserve pluginInstanceId)
    end

    rect rgb(240, 255, 240)
        Note over User,DB: Knotwork-side removal
        User->>UI: Settings → Agents → OpenClaw → Disconnect
        UI->>KB: DELETE /api/v1/workspaces/{id}/openclaw/integrations/{integration_id}
        Note right of KB: service.py:delete_integration L239

        KB->>DB: SELECT registered_agents WHERE openclaw_integration_id = id AND status != archived
        DB-->>KB: linked RegisteredAgent rows

        loop for each linked RegisteredAgent
            KB->>DB: UPDATE registered_agents SET status=archived, is_active=false, archived_at=now
            Note right of DB: agents no longer usable in new node configs
        end

        KB->>DB: SELECT openclaw_handshake_tokens WHERE workspace_id = id AND expires_at >= now
        DB-->>KB: unexpired token rows

        loop for each unexpired token
            KB->>DB: UPDATE openclaw_handshake_tokens SET used_at=NULL
            Note right of DB: tokens reset so they can be reused for re-pairing
        end

        KB->>DB: DELETE openclaw_integrations WHERE id = integration_id
        Note right of DB: cascades to openclaw_remote_agents and openclaw_execution_tasks<br/>(ondelete=CASCADE on integration_id FK)
        KB-->>UI: integration_id + archived_registered_agent_count
        UI-->>User: integration removed
    end

    rect rgb(255, 255, 220)
        Note over User,DB: What happens to in-flight tasks

        Note over DB: Any openclaw_execution_tasks rows are deleted<br/>by the CASCADE from deleting the integration row.<br/>The OpenClawAdapter polling loop will get a 404 or empty result<br/>on its next DB read and mark the run as failed.

        Note over Plugin: If the plugin is still running (race condition),<br/>the next pull-task call returns 401 (integration deleted).<br/>Plugin clears secret and attempts re-handshake —<br/>which also fails (integration gone).<br/>Plugin stops polling.
    end
```

---

## What Gets Deleted vs Preserved

| Item | On plugin uninstall | On Knotwork DELETE integration |
|---|---|---|
| `~/.openclaw/extensions/knotwork-bridge/` | Removed by `openclaw plugins uninstall` + `rm -rf` (includes `runtime.lock` + `credentials.json`) | Not touched |
| `~/.openclaw/knotwork-bridge-state.json` | **Not auto-removed** — persists `pluginInstanceId` for re-install. Delete manually only if fully removing the integration. | Not touched |
| `openclaw_integrations` row | Not touched | **Deleted** |
| `openclaw_remote_agents` rows | Not touched | **Deleted** (CASCADE) |
| `openclaw_execution_tasks` rows | Not touched | **Deleted** (CASCADE) |
| `openclaw_execution_events` rows | Not touched | **Deleted** (CASCADE) |
| `registered_agents` rows (provider=openclaw) | Not touched | **Archived** (status=archived, not deleted) |
| `openclaw_handshake_tokens` rows | Not touched | `used_at` reset to NULL (reusable) |
| Workflow node configs referencing the agent | Not touched | Node still references `registered_agent_id` — runtime will fail when node runs |

---

## Partial Uninstall Scenarios

**Plugin removed but Knotwork integration not deleted:**
- The `openclaw_integrations` row stays. Knotwork UI still shows the integration as connected.
- Any new tasks written to `openclaw_execution_tasks` will sit `pending` forever — no plugin is polling.
- The 15-minute stale recovery (Activity 06) can never fire for `pending` tasks (only `claimed`). They accumulate.
- Fix: also DELETE the integration from Knotwork Settings.

**Knotwork integration deleted but plugin still running:**
- The plugin's next `pull-task` call returns `401 Invalid plugin credentials` (integration row gone).
- Plugin attempts re-handshake — fails (no valid integration to link to).
- Plugin stops polling after failed re-handshake.
- Fix: no action needed — plugin self-stops.

---

## Re-installing After Uninstall

After a clean uninstall, re-installing follows the same flow as [Activity 08 (Install)](./install.md). The unexpired handshake token (`used_at` was reset to NULL) can be reused, so no new token needs to be generated.

If the token is expired or was deleted, generate a new one from Knotwork Settings.

---

## Files Written

| File | Operation | Who |
|---|---|---|
| `~/.openclaw/extensions/knotwork-bridge/runtime.lock` | DELETE (on clean exit) | `state/lease.ts:releaseRuntimeLeaseSync` |
| `~/.openclaw/extensions/knotwork-bridge/credentials.json` | DELETE (auto, via extension dir removal) | User / `openclaw plugins uninstall` |
| `~/.openclaw/extensions/knotwork-bridge/` | DELETE (manual) — removes `runtime.lock` + `credentials.json` + bundle | User / `openclaw plugins uninstall` |
| `~/.openclaw/knotwork-bridge-state.json` | DELETE (manual, only if fully removing) — **intentionally survives reinstall** (preserves `pluginInstanceId`) | User |

## DB Tables Written (backend)

| Table | Operation | Source |
|---|---|---|
| `registered_agents` | UPDATE `status=archived, is_active=false` | `service.py:delete_integration` (L257) |
| `openclaw_handshake_tokens` | UPDATE `used_at=NULL` | `service.py:delete_integration` (L269) |
| `openclaw_integrations` | DELETE | `service.py:delete_integration` (L271) |
| `openclaw_remote_agents` | CASCADE DELETE | FK `ondelete=CASCADE` from `openclaw_integrations` |
| `openclaw_execution_tasks` | CASCADE DELETE | FK `ondelete=CASCADE` from `openclaw_integrations` |
| `openclaw_execution_events` | CASCADE DELETE | FK `ondelete=CASCADE` from `openclaw_execution_tasks` |
