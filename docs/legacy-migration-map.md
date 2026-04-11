# Legacy Migration Map

This file tracks where legacy `docs/implementation/` content should move in the new architecture.

## Principles

- Move active tests before archival docs.
- Move by ownership area, not by milestone number.
- Delete or archive legacy content only after its active replacement exists.

## Target Areas

- `modules/admin`
  - auth
  - workspaces
  - invitations
  - onboarding and guide flows
- `modules/communication`
  - channels
  - notifications
  - escalations
  - inbox and participation flows
- `modules/assets`
  - knowledge
  - storage adapters
  - file health
  - suggestions
  - conversions
- `modules/projects`
  - projects
  - objectives
  - project-scoped orchestration
- `modules/workflows`
  - graphs
  - runs
  - runtime
  - designer
  - tools
  - ratings
  - public workflows
  - agent API
- `core`
  - API assembly
  - app shell
  - runtime assembly
  - MCP
- `libs`
  - auth primitives
  - data models
  - SDK/client substrate
  - UI primitives
  - shared backend primitives

## Legacy Grouping Guidance

- Historical S12.3 backward implementation docs/tests are legacy and should not be expanded.
- Communication-related legacy material should move into `modules/communication`.
- Workflow, run, runtime, designer, tool, and public workflow material should move into `modules/workflows`.
- Knowledge and storage material should move into `modules/assets`.
- Workspace, auth, and invite material should move into `modules/admin`.
- Shared primitive tests should move into `libs` only if they are genuinely reusable and not module-owned.
