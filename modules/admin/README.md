# Admin Module

Scope:
- auth-facing screens and routes
- workspaces
- invitations
- workspace guide and system/member administration

Ownership rules:
- product behavior for administration and workspace setup belongs here
- shared auth primitives belong in `libs/auth`
- agent-provider onboarding and registered-agent flows belong in `modules/agents`
- cross-module composition belongs in `core`

Docs and tests:
- docs should go in `modules/admin/docs/`
- tests should go in `modules/admin/tests/`
