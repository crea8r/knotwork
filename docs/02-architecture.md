# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLIENTS                                 │
│                                                                  │
│   Web App (React)          Mobile/Tablet         Chat Apps       │
│   ┌────────────────┐      ┌──────────────┐      ┌────────────┐  │
│   │ Canvas         │      │ Operator     │      │ Telegram   │  │
│   │ Chat Designer  │      │ Dashboard    │      │ WhatsApp   │  │
│   │ Knowledge Editor│     │ Escalations  │      │ (Phase 2)  │  │
│   └────────────────┘      └──────────────┘      └────────────┘  │
└─────────────────┬───────────────────┬──────────────────┬────────┘
                  │ REST / WebSocket   │                  │ Webhook
┌─────────────────▼───────────────────▼──────────────────▼────────┐
│                         API LAYER (FastAPI)                      │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐    │
│  │ Graph API    │  │ Run API      │  │ Knowledge API       │    │
│  │ Node API     │  │ WebSocket    │  │ Tool API            │    │
│  │ Role API     │  │ Escalation   │  │ Notification API    │    │
│  └──────────────┘  └──────────────┘  └─────────────────────┘    │
└──────────────────────────────┬───────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────┐
│                       RUNTIME LAYER                              │
│                                                                  │
│   ┌────────────────────────────────────────────────────────┐     │
│   │                   LangGraph Engine                     │     │
│   │                                                        │     │
│   │  Graph Runner  ──►  Node Executor  ──►  State Manager  │     │
│   │       │                  │                   │         │     │
│   │  Checkpoint Mgr    Confidence Judge    Knowledge Loader│     │
│   └────────────────────────────────────────────────────────┘     │
│                                                                  │
│   ┌────────────────┐    ┌─────────────────┐                      │
│   │ Tool Registry  │    │ Notification     │                      │
│   │ (sync/async)   │    │ Dispatcher       │                      │
│   └────────────────┘    └─────────────────┘                      │
└──────────────────────────────┬───────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────┐
│                        DATA LAYER                                │
│                                                                  │
│   ┌──────────────────────┐    ┌────────────────────────────┐     │
│   │   PostgreSQL          │    │   Storage Adapter          │     │
│   │                      │    │                            │     │
│   │  - Graphs/Nodes      │    │  Local FS (dev)            │     │
│   │  - Runs & State      │    │  S3 / Blob (prod)          │     │
│   │  - Roles & Access    │    │                            │     │
│   │  - Knowledge Index   │    │  Knowledge .md files       │     │
│   │  - Audit Log         │    │  File versions             │     │
│   └──────────────────────┘    └────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

## Components

### Frontend (React)

Two primary modes:

**Designer Mode** — For building and editing workflows
- Chat interface: conversational graph design
- Canvas: React Flow-based drag-and-drop for visual refinement
- Knowledge editor: file/folder tree, markdown editor
- Both modes always available; chat is the entry point

**Operator Mode** — For running and monitoring workflows
- Run dashboard: active runs, history, status
- Escalation inbox: pending human actions
- Node inspector: per-node input/output/knowledge for any run
- Rating interface: review and rate node outputs

All views are mobile and tablet optimised. Touch targets, responsive layout, no feature gating on screen size.

### API Layer (FastAPI)

Stateless REST API with WebSocket support for real-time run updates.

Responsibilities:
- Validate and persist graph/node/knowledge changes
- Trigger and manage run lifecycle
- Relay escalations to notification channels
- Authenticate and authorise requests (JWT, role-based)

### Runtime Layer (LangGraph)

The execution engine. Converts a Knotwork graph definition into a LangGraph graph and executes it.

Responsibilities:
- Load graph and resolve node configurations at run time
- Fetch and snapshot the knowledge tree for each node
- Execute nodes (LLM calls, tool calls, human checkpoints, routers)
- Manage state passing between nodes
- Evaluate confidence and trigger escalation
- Run checkpoints and rating evaluation
- Persist run state after every node (resumable)

### Storage Adapter

An abstraction layer over the file storage backend. The adapter interface is fixed; the implementation is swappable.

```
StorageAdapter
  ├── LocalFSAdapter     (dev / self-hosted)
  └── S3Adapter          (production cloud)
```

All knowledge `.md` files go through this adapter. Object versioning is enabled at the storage layer (S3 versioning, or a version table for local FS).

### PostgreSQL

Stores structured data: graph definitions, run state, roles, knowledge file metadata (not content), audit log, notification history.

Knowledge file *content* lives in the storage adapter. PostgreSQL holds the index: file ID, path, version ID, owner, token count, linked files, last modified.

## Data Flow: Run Execution

```
1. Trigger (API call or manual)
   │
2. API creates Run record (status: queued), returns run_id + ETA
   │
3. Runtime picks up run, resolves graph definition
   │
4. For each node (parallel where graph allows):
   │
   ├── 4a. Load knowledge tree
   │       Fetch all linked .md files via StorageAdapter
   │       Snapshot version IDs → log to RunNodeState
   │       Flag if token count outside configured range
   │
   ├── 4b. Execute node
   │       LLM Agent: call LLM with knowledge + state + tools
   │       Human Checkpoint: pause, notify human, wait
   │       Conditional Router: evaluate condition, select edge
   │       Tool Executor: invoke tool, return result
   │
   ├── 4c. Evaluate output
   │       Run checkpoint rules
   │       Score confidence (structured output + rule signals)
   │       If checkpoint fails: apply fail-safe → retry → escalate
   │       If confidence low: escalate to human
   │
   ├── 4d. Persist RunNodeState
   │       input, output, knowledge_snapshot, confidence, status
   │
   └── 4e. Pass state to next node(s)
       │
5. Run completes → status: completed | failed | stopped
   │
6. Trigger post-run hooks (rating prompt, notifications, webhooks)
```

## Deployment (Cloud-First)

```
                    ┌─────────────────┐
                    │   CDN / Edge    │  Static frontend assets
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Load Balancer  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼──┐   ┌───────▼───┐   ┌─────▼──────┐
     │ API       │   │ Runtime   │   │ Worker     │
     │ (FastAPI) │   │ (LangGraph│   │ (Async     │
     │           │   │  Engine)  │   │  runs,     │
     └────────┬──┘   └───────┬───┘   │  notify)   │
              │              │       └─────┬──────┘
              └──────────────┼─────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼──┐   ┌───────▼───┐   ┌─────▼──────┐
     │ PostgreSQL│   │   S3      │   │  Queue     │
     │           │   │  (files)  │   │  (runs)    │
     └───────────┘   └───────────┘   └────────────┘
```

Phase 1 targets a single-region cloud deployment. Self-hosted is a Phase 2 option unlocked by the storage adapter abstraction already in place.

## Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage abstraction | Adapter pattern | Swap local FS → S3 without changing business logic |
| Knowledge versioning | Storage-layer versioning (S3) + DB index | Versioning is automatic, no Git complexity for users |
| Run state persistence | After every node | Enables resume, replay, and full inspection |
| Execution engine | LangGraph | Native support for conditional edges, parallel nodes, human interrupts, checkpointing |
| API style | REST + WebSocket | REST for CRUD, WebSocket for real-time run progress |
| Async runs | Queue + worker | Long runs don't block API; ETA returned on trigger |
| Model abstraction | LangChain model interface | Any provider, swappable per node |
