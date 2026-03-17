# System Design

Knotwork is a **visual agent workflow platform**. Non-technical operators design business processes via chat; a canvas shows the result. LangGraph executes them. Knowledge lives in Markdown files (the "Handbook").

This folder contains the authoritative system design for every layer of the platform.

---

## How to read this

The five folders map to five layers of the system, from abstract to concrete:

| Folder | Answers | Start here if you want to… |
|---|---|---|
| `concepts/` | *What is this and why?* | Understand the product, its goals, and core vocabulary |
| `data/` | *What are the nouns?* | Understand data models, schemas, and the knowledge system |
| `engine/` | *How does it run?* | Understand execution, node types, tools, and human-in-the-loop |
| `interfaces/` | *How do you call it?* | Understand the REST API, MCP server, and external integrations |
| `frontend/` | *What does it look like?* | Understand UI pages, UX principles, and deployment |

---

## Folder map

```
sysdesign/
│
├── concepts/               Why it exists and what it does
│   ├── vision.md           Product goals, philosophy, and north star
│   ├── diagrams.md         System-level diagrams
│   ├── workflow.md         Core vocabulary: Graph, Node, Edge, Run, Fragment
│   ├── quality.md          Knowledge health, confidence scoring, improvement loop
│   └── use-cases/          Concrete scenarios that drive design decisions
│
├── data/                   The static structure of the system
│   ├── models/             ORM + schema contracts for every entity
│   └── knowledge/          The Handbook — how files are stored, linked, and scored
│
├── engine/                 Dynamic behaviour at execution time
│   ├── architecture/       High-level overview and end-to-end data flow
│   ├── runtime/            LangGraph execution, knowledge loading, reliability
│   ├── nodes/              Agent node types, adapters, trust levels
│   ├── human-in-loop/      Escalation flows and notification channels
│   └── tools.md            Knotwork-native tools available to every agent
│
├── interfaces/             Every surface the system exposes externally
│   ├── api/                REST API contracts (core, runs, knowledge, settings)
│   ├── mcp/                MCP server — tool definitions for Claude Desktop etc.
│   └── integrations/       Third-party integrations (OpenClaw plugin)
│
└── frontend/               The user-facing layer
    ├── pages/              Per-page specs (Designer, Handbook, Operator, Settings)
    ├── ux-principles/      Design principles and cross-cutting UX patterns
    └── deployment/         Docker, networking, environment setup
```

---

## Suggested reading paths

**New to the project?**
`concepts/vision.md` → `concepts/workflow.md` → `engine/architecture/overview.md` → `engine/architecture/data-flow.md`

**Building a new node type or adapter?**
`data/models/graph-definition.md` → `engine/nodes/llm-and-human.md` → `engine/runtime/execution.md`

**Adding an API endpoint?**
`interfaces/api/core.md` → relevant data model in `data/models/`

**Working on the frontend?**
`frontend/ux-principles/principles.md` → the relevant page spec in `frontend/pages/`

**Integrating an external system?**
`interfaces/mcp/server-tools.md` or `interfaces/integrations/`
