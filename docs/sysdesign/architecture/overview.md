# Architecture — System Overview

## System Diagram

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
│   │ AgentAdapters  │    │ Notification     │                      │
│   │ Claude/OAI/Hum │    │ Dispatcher       │                      │
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
- Chat interface: conversational graph design (primary surface)
- Canvas: custom SVG with dagre auto-layout (read-only; click-to-select nodes, no drag-and-drop)
- Knowledge editor: file/folder tree, markdown editor (the Handbook)
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
- Execute nodes via AgentAdapter (Claude, OpenAI, Human)
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
