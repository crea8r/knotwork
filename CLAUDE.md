# Knotwork — Agent Instructions

## What This Is
Visual agent workflow platform. Users design business processes via chat; canvas is a read-only confirmation view (dagre layout, custom SVG — no drag-and-drop). LangGraph executes them. Knowledge lives in Markdown files (the "Handbook"). See `docs/` for full specs.

## Stack
- **Backend**: Python 3.12, FastAPI, SQLAlchemy 2 (async), PostgreSQL, LangGraph, Pydantic v2
- **Queue**: arq (async Redis task queue)
- **Storage**: adapter pattern — `LocalFSAdapter` dev, `S3Adapter` prod
- **Frontend**: React 18, TypeScript, Vite, custom SVG canvas + dagre (@dagrejs/dagre) layout, Tailwind CSS, Zustand, TanStack Query
- **Token counting**: tiktoken
- **Notifications**: SMTP email, Telegram Bot API, WhatsApp Business API

## Non-Negotiable Rules

### Module size
**150–200 lines max per file.** If a file grows beyond ~200 lines, split it. No exceptions. This keeps every file readable in a single context window.

### Storage adapter
**Never access the filesystem or S3 directly.** Always go through `StorageAdapter`. The active adapter is injected via `get_storage_adapter()` in `knotwork/knowledge/storage/__init__.py`. See `adapter.py` for the interface.

### Knowledge loading — folder-as-domain
**Never load all linked files blindly.** Use `load_knowledge_tree()` in `runtime/knowledge_loader.py`. It filters transitive links by folder domain. A `legal/` node must not load `finance/` files. Read `knowledge_loader.py` before touching this.

### Prompt construction — block order
**Every agent node gets these blocks in exact order.** Use `build_agent_prompt()` in `runtime/prompt_builder.py` for blocks 1–2. Never hand-build prompts inline in node code.

| # | Block | Always? |
|---|-------|---------|
| 1 | `=== GUIDELINES ===` — knowledge tree | Yes |
| 2 | `=== THIS CASE ===` — run input + prior node outputs | Yes |
| 3 | `[node system_prompt]` — per-node config | If set |
| 4 | `=== AUTONOMY LEVEL ===` — trust float 0.0–1.0 | Yes |
| 5 | `=== ROUTING ===` — per-branch condition labels | Only if node has >1 outgoing edge |
| 6 | `=== COMPLETION PROTOCOL ===` — json-decision block format | Yes, always last |

**On retry** (after escalation): `system_prompt = ""`, `user_prompt = human_guidance` only — no blocks at all.

**Conditional edges** (node with >1 outgoing) must have a `condition_label` on every edge — this is the question the agent evaluates to pick a branch. Missing labels are rejected by `validate_graph()` before the run starts.

### Layer separation
- `models.py` — SQLAlchemy ORM models only
- `schemas.py` — Pydantic request/response schemas only
- `service.py` — business logic, calls models and other services
- `router.py` — HTTP layer only, calls service, never touches models directly

### Session structure
Every session **must** produce three artifacts under `docs/implementation/S<N>/`:

- `spec.md` — what was built, key decisions, and any breaking changes from prior sessions
- `validation.md` — manual checklist the user runs to visually confirm the session works end-to-end. Every checklist item **must** include a ✅ pass condition and a ❌ fail condition so the tester knows exactly what to look for.
- `tests/` — automated pytest suite (SQLite in-memory, no live services needed)

Run one session: `cd backend && pytest ../docs/implementation/S<N>/tests/ -v`
Run all sessions: `cd backend && pytest ../docs/implementation/ -v`

### Regression policy
At the **start** of every new session, run the full suite (`pytest ../docs/implementation/`) and confirm all prior tests pass before writing any new code. This is the baseline.

If a new session **must** break a prior test (e.g. schema change, renamed endpoint):
1. Fix the old test to match the new contract, **or**
2. Mark it `@pytest.mark.xfail(reason="superseded by S<N>: <what changed>")` and document the breaking change in the new session's `spec.md` under a `## Breaking Changes` section.

Silent regressions are never acceptable. Intentional ones must be declared.

## File Map

```
backend/knotwork/
  main.py                     FastAPI app factory, router registration
  config.py                   Settings via pydantic-settings (env vars)
  database.py                 Async SQLAlchemy engine + session factory

  auth/                       JWT auth, login, token refresh
  workspaces/                 Workspace + WorkspaceMember CRUD
  graphs/                     Graph + GraphVersion CRUD, import from MD
  runs/                       Run trigger, status, node state inspection
  knowledge/                  KnowledgeFile CRUD, health scoring
    storage/
      adapter.py              Abstract StorageAdapter interface  ← READ THIS
      local_fs.py             LocalFSAdapter (dev)
      s3.py                   S3Adapter (prod)
    health.py                 Health score computation
  tools/                      Tool registry CRUD + execution
    builtins/                 Built-in workspace tools
  escalations/                Escalation create/resolve
  notifications/              Dispatcher + per-channel senders
  ratings/                    Rating CRUD, triggers health recompute
  runtime/
    engine.py                 Compile GraphDefinition → LangGraph, execute
    knowledge_loader.py       load_knowledge_tree() — folder-as-domain  ← READ THIS
    prompt_builder.py         build_agent_prompt() — GUIDELINES/CASE     ← READ THIS
    confidence.py             Confidence scoring + rule evaluation
    checkpoints.py            Checkpoint rule evaluation
    nodes/
      llm_agent.py            LLM Agent node function
      human_checkpoint.py     Human Checkpoint node function
      conditional_router.py   Conditional Router node function
      tool_executor.py        Tool Executor node function
  designer/
    agent.py                  Chat designer LLM agent (description → graph delta)
    parser.py                 MD file → draft graph scaffold
  mcp/
    server.py                 MCP server, all tool definitions
  worker/
    tasks.py                  arq task: execute_run
  audit/
    service.py                append-only audit log writes

frontend/src/
  api/client.ts               axios instance, interceptors, base URL
  api/*.ts                    per-domain query hooks (React Query)
  store/canvas.ts             graph definition + canvas UI state (Zustand)
  store/run.ts                active run state + WebSocket connection
  store/auth.ts               JWT token + user
  types/                      TypeScript types — mirror backend schemas
  components/canvas/          Custom SVG canvas (dagre layout, read-only, click-to-select)
  components/designer/        Chat designer UI + node config panel
  components/handbook/        File tree, markdown editor, health display
  components/operator/        Dashboard, run trigger, run monitor, escalation
  components/shared/          Reusable UI: TokenBadge, HealthBadge, etc.
  pages/                      Route-level page components
```

## Dev Setup
```bash
# Backend
cd backend
cp .env.example .env          # fill in DB_URL, REDIS_URL, LLM API keys
pip install -e ".[dev]"
alembic upgrade head
uvicorn knotwork.main:app --reload

# Worker (separate terminal)
cd backend
arq knotwork.worker.tasks.WorkerSettings

# Frontend
cd frontend
npm install
npm run dev
```

## OpenClaw Plugin Dev Workflow

Source lives in `openclaw-plugin-knotwork/`. The running plugin is at `~/.openclaw/extensions/knotwork-bridge/` (Docker bind-mount prevents a direct symlink). After any source change:

```bash
# 1. Sync source → extension dir
cd openclaw-plugin-knotwork
./sync-to-openclaw.sh

# 2. Restart the gateway to pick up the new source
docker restart openclaw-openclaw-gateway-1
```

Then verify the plugin loaded:
```bash
docker logs openclaw-openclaw-gateway-1 2>&1 | grep knotwork-bridge | tail -5
# Should show: startup:background-enabled context=runtime
```

**File map:**
```
openclaw-plugin-knotwork/
  src/plugin.ts          — activate(), poll loop, concurrent spawn, lease renewal
  src/lifecycle/worker.ts — runClaimedTask(), pollAndRun(), task event posting
  src/lifecycle/rpc.ts   — knotwork.* gateway RPC method registrations
  src/lifecycle/handshake.ts — handshake + retry logic
  src/openclaw/bridge.ts — pullTask(), postEvent(), config resolution
  src/state/lease.ts     — heartbeat TTL runtime lease (prevents duplicate workers)
  src/types.ts           — shared types (PluginState, ExecutionTask, RunningTaskInfo)
  sync-to-openclaw.sh    — one-command sync script
```

**Key RPC methods** (callable via `openclaw gateway call <method>`):
| Method | Purpose |
|---|---|
| `knotwork.status` | Live state: connection, config, running tasks |
| `knotwork.logs` | Last 200 log lines |
| `knotwork.handshake` | Re-pair with Knotwork backend |
| `knotwork.execute_task` | Pull and run one task (or pass `--params '{"task":{...}}'`) |
| `knotwork.reset_connection` | Clear persisted credentials and re-pair |

## Environment Variables (required)
```
DATABASE_URL=postgresql+asyncpg://...
REDIS_URL=redis://localhost:6379
STORAGE_ADAPTER=local_fs          # or s3
LOCAL_FS_ROOT=./data/knowledge
OPENAI_API_KEY=...                # or ANTHROPIC_API_KEY
TELEGRAM_BOT_TOKEN=...
JWT_SECRET=...
```

## Implementation Sessions

Roadmap and per-session status: `docs/implementation/roadmap.md`

Before starting a session: read `docs/implementation/S<N>/spec.md` and run its tests to confirm the baseline passes.

## Key Design Decisions (do not change without updating docs/)
1. Folder-as-domain traversal — see `docs/04-knowledge-system.md`
2. Run Context files separate from Handbook — see `docs/03-core-concepts.md`
3. Knowledge health = composite score from 4 signals — see `docs/04-knowledge-system.md`
4. All runs are async — API returns run_id + ETA immediately
5. LLMs are swappable — model is a config field, never hardcoded
