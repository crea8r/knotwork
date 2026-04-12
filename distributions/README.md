# Distributions

`distributions/` contains concrete packaged products built from the shared
platform.

Rules:

- distributions compose `core`, `libs`, and `modules`
- distributions may enable, disable, or configure modules
- distributions must not reimplement module business logic
- if behavior diverges enough to require custom domain logic, that logic should
  move into a module or a new shared capability, not stay trapped in a
  distribution shell

Current distributions:

- `chimera`
  - full Knotwork product surface
  - admin + communication + assets + projects + workflows

Planned distributions:

- `manticore`
  - narrower product surface focused on assets and workflows
  - admin + assets + workflows
  - later may use a different onboarding and identity model

Development notes:

- it is valid to run multiple distributions against the same local installation
  in development
- the current intended dev setup is:
  - Chimera frontend on `:3000`
  - Manticore frontend on `:3001`
  - shared backend, database, worker, and MCP server
- distribution-specific backend behavior can still be tested by setting
  `KNOTWORK_DISTRIBUTION`, but the default local compare loop should avoid
  duplicating the whole stack unless the backend contract itself is under test
