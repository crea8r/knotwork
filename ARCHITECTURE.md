# Architecture Contract

This repo is organized around three top-level ownership buckets:

- `core/`
  - Owns application assembly.
  - Cross-module composition, bootstrap, runtime wiring, entrypoints.
- `libs/`
  - Owns reusable primitives.
  - Shared auth, data models, SDK/client substrate, UI primitives, and similar building blocks.
- `modules/`
  - Owns product behavior.
  - Each module should own its frontend, backend, tests, and docs for one product area.

## Dependency Rules

- Modules may depend on `libs` and `core`.
- Modules must not depend directly on other modules' internals.
- Cross-module coordination should go through `core`.
- `libs` must stay generic and reusable.
- `core` must stay thin and focused on assembly.

## Docs And Tests

- New docs should live next to the code they describe:
  - `modules/<name>/docs/`
  - `core/<area>/docs/` when applicable
  - `libs/<area>/docs/` when applicable
- New tests should live next to the code they validate:
  - `modules/<name>/tests/`
  - `core/<area>/tests/` when applicable
  - `libs/<area>/tests/` when applicable
- `docs/implementation/` is legacy archival material.
- Do not add new implementation docs or active tests under `docs/implementation/`.

## Migration Policy

- Do not move all legacy docs/tests at once.
- Move content module by module, prioritizing active tests over archival docs.
- When moving a legacy document or test, update the migration map in `docs/legacy-migration-map.md`.
