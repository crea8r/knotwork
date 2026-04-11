# Knotwork Agent Guide

This file is the minimal architecture brief for agents working inside a sub-project of Knotwork.

## What Knotwork Is

Knotwork is a workflow and operations platform:

- users define workflows and operational processes
- workflows run through a backend execution engine
- knowledge and assets live in a markdown/file-based asset system
- projects, communication, and administration are separate product areas

## Top-Level Architecture

There are only three places where application code should live:

- `core/`
  - app assembly, bootstrap, routing, runtime wiring, MCP, entrypoints
- `libs/`
  - reusable primitives shared across modules
- `modules/`
  - product behavior, organized by product area

If code does not fit one of those, the default assumption is that the ownership is wrong.

## Ownership Model

### `core/`

`core` owns composition, not product logic.

Current areas:
- `core/app-shell`
  - frontend entry, app shell, routing composition
- `core/api`
  - backend entry, FastAPI app assembly, router mounting, cross-module API composition
- `core/runtime-assembly`
  - backend runtime wiring and worker assembly
- `core/mcp`
  - MCP server integration

### `libs/`

`libs` owns shared primitives only.

Current areas:
- `libs/auth`
  - shared auth/session primitives
- `libs/data-models`
  - shared frontend contracts and data types
- `libs/sdk`
  - shared client/API transport substrate
- `libs/ui`
  - reusable UI primitives
- backend shared libs also exist directly under `libs/`
  - `config.py`
  - `database.py`
  - `participants.py`
  - `namegen.py`
  - `slugs.py`
  - `audit/backend`

### `modules/`

`modules` owns product behavior.

Current modules:
- `modules/admin`
  - auth-facing flows, workspaces, invitations, onboarding/guide
- `modules/communication`
  - channels, notifications, escalations, inbox-style flows
- `modules/assets`
  - knowledge, storage adapters, file/folder flows, conversion/suggestions/health
- `modules/projects`
  - projects, objectives, project orchestration
- `modules/workflows`
  - graphs, runs, runtime, designer, tools, ratings, public workflows, agent API

Each module may contain both frontend and backend code.

## Dependency Rules

These rules are not optional:

- modules may depend on `libs`
- modules may depend on `core`
- modules must not depend directly on another module’s internals
- cross-module coordination should go through `core`
- `libs` must stay generic
- `core` must stay thin

Practical rule:
- if the code names a specific product area, it probably belongs in a module
- if the code is generic and reusable across modules, it belongs in libs
- if the code assembles modules together, it belongs in core

## Entry Points

Current runtime entrypoints:

- frontend app entry:
  - `core/app-shell/App.tsx`
- frontend bundler/project shell:
  - `core/app-shell/`
- backend API entry:
  - `core/api/main.py`
- backend worker entry:
  - `core/runtime_assembly_tasks.py`

## Tech Stack

- Backend: Python 3.12, FastAPI, SQLAlchemy async, PostgreSQL, Pydantic v2
- Worker queue: arq + Redis
- Workflow engine: LangGraph
- Frontend: React, TypeScript, Vite, Zustand, TanStack Query, Tailwind
- Storage: adapter pattern, local FS in dev and S3 in prod
- MCP: server lives under `core/mcp`

## Important Domain Rules

These are high-signal rules for most backend work:

- Never access storage directly if a storage adapter exists.
  - asset and knowledge storage belongs behind the assets storage layer
- Do not hand-build cross-module behavior inside modules.
  - route it through `core`
- Workflow prompt construction, validation, and runtime behavior belong in `modules/workflows/backend`
- Communication behavior belongs in `modules/communication`
- Project behavior belongs in `modules/projects`
- Asset and knowledge behavior belongs in `modules/assets`

## Docs And Tests

The old `docs/implementation/` tree is legacy archive only.

Do not add new active docs or tests there.

New material should go next to owned code:

- module docs: `modules/<name>/docs/`
- module tests: `modules/<name>/tests/`
- core docs/tests: `core/<area>/docs/`, `core/<area>/tests/`
- lib docs/tests: `libs/<area>/docs/`, `libs/<area>/tests/`

When moving legacy tests or docs, do it module by module. Do not do repo-wide churn unless explicitly asked.

## Working Conventions

- Prefer small, readable files. Prefer less than 250 lines of code for a file.
- Re-read a file before editing if the task has been running a while.
- When changing names or moving code, search broadly for:
  - references
  - imports
  - re-exports
  - tests
  - string references where relevant
- Verify code after changes.

Minimum expected verification:

- frontend: `npx tsc --noEmit` from `core/app-shell`
- backend: focused `pytest` or targeted smoke checks
- Docker changes: `docker compose config`

## Useful Commands

### Frontend

```bash
cd core/app-shell
npm install
npm run dev
npx tsc --noEmit
```

### Backend

```bash
.venv/bin/python scripts/export_openapi_baseline.py
.venv/bin/pytest tests/backend
```

### Docker dev stack

```bash
docker compose --profile dev up -d --build
docker compose ps
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:3000/
```

## OpenClaw Plugin

OpenClaw integration work lives under:

- `agent-bridge/plugins/openclaw/`

This is adjacent to Knotwork, not part of `core/modules/libs`.

## If You Are Working In A Sub-Project

When dropped into a subfolder, orient yourself in this order:

1. Identify whether you are in `core`, `libs`, or a `module`
2. Read the nearest local `README.md`
3. Confirm the area’s allowed dependencies
4. Verify where local docs and tests should live
5. Avoid reaching across module boundaries directly

If the requested change seems to require direct module-to-module calls, stop and check whether the behavior should be routed through `core` instead.
