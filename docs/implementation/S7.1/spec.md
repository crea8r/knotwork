# Session 7.1: Agent Registration

## Context

S7 introduced the unified `agent` node type and adapter architecture, but the designer's agent dropdown
still shows a hardcoded list of provider:model strings (`AGENT_REF_OPTIONS` in `utils/models.ts`). Users
have no way to provide their own API keys or name their agents. S7.1 introduces a proper registration
flow: users configure their agents once in **Settings → Agents**, then pick them by display name in the
designer. The runtime uses the stored API key for that workspace's API calls, falling back to env vars
for backward compatibility.

---

## What will be built

### Backend — new `registered_agents` module

**`backend/knotwork/registered_agents/models.py`**
```
RegisteredAgent
  id             UUID pk
  workspace_id   UUID → workspaces.id
  display_name   str       e.g. "My Legal Claude"
  provider       str       'anthropic' | 'openai' | 'openclaw'
  agent_ref      str       "anthropic:claude-sonnet-4-6" | "openclaw:my-agent"
  api_key        str?      plaintext for MVP (anthropic/openai); null for openclaw
  endpoint       str?      future openclaw endpoint URL
  is_active      bool = True
  created_at     DateTime
```

**`backend/knotwork/registered_agents/schemas.py`**
- `RegisteredAgentCreate` — display_name, provider, agent_ref, api_key?, endpoint?
- `RegisteredAgentOut` — all fields; `api_key_hint` exposes last 4 chars only

**`backend/knotwork/registered_agents/service.py`**
- `list_agents(db, workspace_id)`
- `create_agent(db, workspace_id, data)` — validates provider ↔ agent_ref prefix match
- `delete_agent(db, workspace_id, agent_id)` — 404 guard

**`backend/knotwork/registered_agents/router.py`**
- `GET  /workspaces/{id}/agents` → list
- `POST /workspaces/{id}/agents` → create (201)
- `DELETE /workspaces/{id}/agents/{agent_id}` → 204

**`backend/alembic/versions/a1b2c3d4e5f6_s7_1_registered_agents.py`** — creates the table (chains from `b8e3f1a2c4d5`)

**`backend/knotwork/main.py`** — import model + register router

### Runtime — per-workspace credential lookup

**`backend/knotwork/runtime/nodes/agent.py`**

Before calling `get_adapter()`, look up the registered agent record:
```python
registered_agent_id = node_def.get("registered_agent_id")
api_key = None
if registered_agent_id:
    ra = await db.get(RegisteredAgent, UUID(registered_agent_id))
    if ra:
        api_key = ra.api_key
        agent_ref = ra.agent_ref   # agent_ref from DB overrides node's field
adapter = get_adapter(agent_ref, api_key=api_key)
```
Falls back to env var if no `registered_agent_id` set (keeps all existing legacy nodes working).

**`backend/knotwork/runtime/adapters/__init__.py`** — `get_adapter(agent_ref, api_key=None)` signature
**`backend/knotwork/runtime/adapters/claude.py`** — `ClaudeAdapter(api_key=None)`; uses `api_key or settings.anthropic_api_key`
**`backend/knotwork/runtime/adapters/openai_adapter.py`** — same pattern

### Frontend

**`frontend/src/api/agents.ts`** (new)
```typescript
interface RegisteredAgent { id, display_name, provider, agent_ref, api_key_hint, created_at }
useRegisteredAgents()   // GET /workspaces/{id}/agents
useCreateAgent()        // POST
useDeleteAgent()        // DELETE
```

**`frontend/src/components/settings/AgentsTab.tsx`** (new, ~170 lines)
Two sections in a card:
1. **Registered agents list** — display_name, provider badge, masked key hint (last 4 chars), trash icon
2. **Add agent form** (below list):
   - Provider: Anthropic | OpenAI | OpenClaw *(disabled, "coming soon")*
   - Display name input
   - Model dropdown (Anthropic: Opus/Sonnet/Haiku, OpenAI: gpt-4o/gpt-4o-mini)
   - API key input (type=password)
   - Submit

**`frontend/src/pages/SettingsPage.tsx`**
- Add `'agents'` to `Tab` type and `TABS` array
- Render `<AgentsTab />` for that tab

**`frontend/src/components/designer/config/AgentNodeConfig.tsx`**
- Replace hardcoded `AGENT_REF_OPTIONS` with `useRegisteredAgents()` data
- "Human" is always present as a fixed option (no registration needed)
- Selecting an agent sets both `agent_ref` (routing) and `registered_agent_id` (credential lookup)
- If list is empty: show inline nudge "No agents registered — add one in Settings → Agents."
- If node references a deleted agent: show a warning badge

**`frontend/src/types/index.ts`**
- Add `registered_agent_id?: string` to `NodeDef`

---

## Key design decisions

1. **`agent_ref` stays as provider:model string** — adapter routing unchanged; no UUID-based routing
2. **`registered_agent_id` is separate** — node stores both fields; runtime uses the ID for credential lookup but `agent_ref` for adapter dispatch
3. **Env var fallback** — nodes without `registered_agent_id` keep working with existing env vars (all legacy graphs unaffected)
4. **API key stored plaintext** — acceptable for MVP; encryption at rest is a Phase 2 item
5. **OpenClaw deferred** — UI shows the option as disabled with "coming soon"; no adapter implementation yet
6. **Human is always built-in** — no registration entry needed; always shown as first option in designer dropdown

## Breaking changes

None. All existing graphs and env-var configs continue to work.

## Files created / modified

```
backend/knotwork/registered_agents/      ← new module
  models.py
  schemas.py
  service.py
  router.py
backend/alembic/versions/a1b2c3d4e5f6_s7_1_registered_agents.py
backend/knotwork/main.py                 modified
backend/knotwork/runtime/adapters/__init__.py   api_key param
backend/knotwork/runtime/adapters/claude.py     api_key ctor
backend/knotwork/runtime/adapters/openai_adapter.py  api_key ctor
backend/knotwork/runtime/nodes/agent.py         DB lookup before adapter
frontend/src/api/agents.ts               new
frontend/src/components/settings/AgentsTab.tsx  new
frontend/src/pages/SettingsPage.tsx      add agents tab
frontend/src/components/designer/config/AgentNodeConfig.tsx  API data
frontend/src/types/index.ts              registered_agent_id on NodeDef
```
