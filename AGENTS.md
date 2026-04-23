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
- `distributions/`
  - concrete product shells that compose modules into named products

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
  - auth-facing flows, workspaces, invitations, guide, system/member administration
- `modules/agents`
  - registered-agent registry, capability sync, provider onboarding, harness-facing flows
- `modules/communication`
  - channels, notifications, escalations, inbox-style flows
- `modules/assets`
  - knowledge, storage adapters, file/folder flows, conversion/suggestions/health
- `modules/projects`
  - projects, objectives, project orchestration
- `modules/workflows`
  - graphs, runs, runtime, designer, tools, ratings, public workflows, agent API

Each module may contain both frontend and backend code.

### `distributions/`

`distributions` owns named product composition.

Current distributions:
- `distributions/chimera`
  - full Knotwork product
- `distributions/manticore`
  - reduced product focused on assets + workflows

Rules:
- distributions compose modules
- distributions may configure or hide module surfaces
- distributions must not become the home of shared domain logic

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

Current distribution selection:

- frontend:
  - `VITE_KNOTWORK_DISTRIBUTION`
- backend:
  - `KNOTWORK_DISTRIBUTION`

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

## UI Semantics

- When adding or editing frontend UI, add stable semantic hooks so future UI change requests can refer to intent instead of CSS class strings.
- Prefer `data-ui` attributes for shell/page structure, headers, tabs, drawers, dialogs, and primary controls.
- Name hooks by role, not styling.
  - good: `shell.nav`, `shell.chat.header`, `shell.nav.collapse`, `shell.asset.search`, `shell.asset.breadcrumb`
  - bad: `left-panel`, `blue-button`, `px-4-header`
- Use a predictable dotted hierarchy when possible:
  - `surface.region`
  - `surface.region.slot`
  - `surface.region.control`
- Preserve existing `data-ui` names when refactoring unless the semantic meaning actually changes.
- For shared layout chrome, expose semantics for:
  - the container
  - the header
  - the title
  - the actions area
  - the primary toggles/buttons a human is likely to reference in feedback

Minimum expected verification:

- frontend: `npx tsc --noEmit` from `core/app-shell`
- backend: focused `pytest` or targeted smoke checks
- Docker changes: `docker compose config`

## Useful Commands

### Frontend

```bash
cd core/app-shell
npm install
npm run dev:chimera
npm run dev:manticore
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
curl http://127.0.0.1:3001/
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
