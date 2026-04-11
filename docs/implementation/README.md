# Legacy Implementation Archive

`docs/implementation/` is legacy.

It contains historical implementation notes, specs, and tests from an older repo layout. Those files are no longer the source of truth for the active architecture.

Rules going forward:

- Do not add new implementation docs here.
- Do not add new active tests here.
- Treat the tests under this tree as archival, not supported.
- Treat this directory as archival reference only.

Active material should move over time into:

- `modules/<name>/docs/`
- `modules/<name>/tests/`
- `core/.../docs/`
- `core/.../tests/`
- `libs/.../docs/`
- `libs/.../tests/`

Migration should happen incrementally by ownership area, not as a single repo-wide move.
