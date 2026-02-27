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

### Prompt construction — GUIDELINES / CASE
**Every LLM Agent node gets two sections, always.** Use `build_agent_prompt()` in `runtime/prompt_builder.py`. Never hand-build prompts inline in node code. The structure is:
```
=== GUIDELINES (how to work) ===
[knowledge tree]

=== THIS CASE (what you are working on) ===
[run state fields + Run Context files]
```

### Layer separation
- `models.py` — SQLAlchemy ORM models only
- `schemas.py` — Pydantic request/response schemas only
- `service.py` — business logic, calls models and other services
- `router.py` — HTTP layer only, calls service, never touches models directly

### Tests
Mirror source structure: `tests/test_runtime/` mirrors `knotwork/runtime/`. Every public function in `runtime/` must have a test. Run with `cd backend && pytest`.

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

## Session Plan

| Phase | Goal | Sessions |
|-------|------|----------|
| **S1 (now)** | Walking skeleton: graph CRUD, trigger run, LLM Agent + Human Checkpoint, dagre canvas, polling status | 2-3 |
| S2 | WebSocket run monitor, confidence scoring, escalation resolve flow | 3-4 |
| S3 | Handbook CRUD UI, health scoring, token badges, progressive education | 2-3 |
| S4 | Chat designer agent, graph delta application, node config panel | 2-3 |
| S5 | Full canvas (run state overlay), operator dashboard, escalation inbox | 2-3 |
| S6 | Tool registry, built-in tools, notifications (Telegram, WhatsApp, email) | 2-3 |
| S7 | MCP server (full tool set) | 1-2 |
| S8 | Polish, E2E tests, mobile layout, auth flow | 2-3 |

**Token estimate**: ~4.4M total | **Cost**: 1 Claude Code account ($20/mo) × 3 months + ~$30 API overflow = ~$90

## Current State
- [x] Scaffold: directories, stubs, models, routers, stores, TypeScript types
- [x] Implemented: `runtime/knowledge_loader.py`, `runtime/prompt_builder.py`, `knowledge/storage/adapter.py`, `knowledge/storage/__init__.py`
- [x] All SQLAlchemy models defined
- [x] Canvas tech: custom SVG + @dagrejs/dagre (no drag-and-drop; chat is primary design surface)
- [x] Session 1 complete:
      - `knowledge/storage/local_fs.py` — LocalFSAdapter implemented
      - `graphs/schemas.py`, `graphs/service.py`, `graphs/router.py` — graph CRUD
      - `runs/schemas.py`, `runs/service.py`, `runs/router.py` — run trigger + status
      - `runtime/engine.py` — compile_graph + execute_run (MemorySaver)
      - `runtime/nodes/llm_agent.py` — LLM call with knowledge loading
      - `runtime/nodes/human_checkpoint.py` — interrupt() pause
      - `worker/tasks.py` — arq execute_run task
      - Frontend: GraphCanvas, GraphsPage, GraphDetailPage, RunDetailPage
- [ ] `alembic upgrade head` — create initial migration (run manually: `cd backend && alembic revision --autogenerate -m "initial" && alembic upgrade head`)
- [ ] Auth not yet wired to endpoints — endpoints currently unauthenticated (Session 2)
- [ ] WebSocket not yet implemented — frontend polls every 2s (Session 2)

## Key Design Decisions (do not change without updating docs/)
1. Folder-as-domain traversal — see `docs/04-knowledge-system.md`
2. Run Context files separate from Handbook — see `docs/03-core-concepts.md`
3. Knowledge health = composite score from 4 signals — see `docs/04-knowledge-system.md`
4. All runs are async — API returns run_id + ETA immediately
5. LLMs are swappable — model is a config field, never hardcoded
