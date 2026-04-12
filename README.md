# Knotwork

Visual agent workflow platform for non-technical operators. Design AI-powered business processes through conversation, run and monitor them from any device.

## Documentation

| Doc | Description |
|-----|-------------|
| [01 Vision](docs/01-vision.md) | Product overview, goals, phase 1 scope |
| [02 Architecture](docs/02-architecture.md) | System components and data flow |
| [03 Core Concepts](docs/03-core-concepts.md) | Graphs, nodes, knowledge, runs, roles |
| [04 Knowledge System](docs/04-knowledge-system.md) | MD files, versioning, health score, improvement loop |
| [05 Node Types](docs/05-node-types.md) | LLM Agent, Human Checkpoint, Router, Tool Executor |
| [06 Human-in-the-Loop](docs/06-human-in-the-loop.md) | Escalation, notifications, rating |
| [07 Tool Registry](docs/07-tool-registry.md) | Tool categories, built-ins, scoping |
| [08 Data Models](docs/08-data-models.md) | Database schemas |
| [09 API Spec](docs/09-api-spec.md) | REST endpoints, WebSocket events |
| [10 Frontend Spec](docs/10-frontend-spec.md) | UI/UX flows, mobile design, progressive education |
| [11 Runtime Spec](docs/11-runtime-spec.md) | LangGraph execution engine, folder-as-domain traversal |
| [12 MCP Spec](docs/12-mcp-spec.md) | MCP server, Telegram/WhatsApp, Claude Desktop |
| [13 Use Cases](docs/13-use-cases.md) | Actor overview and use case diagrams (Mermaid) |
| [14 Activity Diagrams](docs/14-activity-diagrams.md) | Key flow diagrams for all major scenarios (Mermaid) |

## Stack

- **Backend**: Python, FastAPI, LangGraph
- **Frontend**: React, React Flow, Tailwind CSS
- **Database**: PostgreSQL
- **Storage**: Local FS (dev) → S3 (prod) via adapter
- **Queue**: Background worker for async runs

## Development

The repo now supports multiple product distributions on the same codebase.

- `chimera`
  - full product surface
- `manticore`
  - reduced assets + workflows surface

Frontend shell:

```bash
cd core/app-shell
npm install
npm run dev:chimera
npm run dev:manticore
```

Docker dev stack:

```bash
docker compose --profile dev up -d --build
curl http://127.0.0.1:3000/
curl http://127.0.0.1:3001/
curl http://127.0.0.1:8000/health
```

Notes:

- `:3000` is Chimera
- `:3001` is Manticore
- both frontend shells can share one local backend, worker, database, and MCP
  server during development
