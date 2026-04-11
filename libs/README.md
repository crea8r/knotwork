# Libs

Scope:
- reusable primitives shared across modules
- auth primitives
- data models
- SDK/client substrate
- UI primitives
- shared backend helpers that are not product-owned

Rules:
- keep libs generic
- do not place module-specific behavior here
- if code names a specific product area, it probably belongs in a module

Docs and tests:
- docs should go in the relevant `libs/<area>/docs/` folder
- tests should go in the relevant `libs/<area>/tests/` folder
