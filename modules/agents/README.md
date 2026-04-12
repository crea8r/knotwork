# Agents Module

`modules/agents/` is reserved for agent-provider and harness-facing product
capabilities that should not be trapped inside a distribution shell.

Intended scope:

- provider account linking and identity surfaces for agent runtimes
- managed agent provisioning flows
- harness integration such as OpenClaw and future open-source harnesses like
  Hermes
- distribution-agnostic agent capability setup that can be composed differently
  by `chimera`, `manticore`, or future distributions
- registered-agent registry, capability sync, and provider-facing onboarding
- agent setup UX that may be surfaced from admin/settings but should not be
  owned by `modules/admin`

Non-goals:

- low-level auth/session primitives
  - those stay in `libs/auth`
- backend/bootstrap assembly
  - that stays in `core`
- workflow runtime behavior
  - that stays in `modules/workflows`

Design rule:

- distributions may expose or configure agent flows
- agent-provider logic should live here when it becomes product behavior

For now this is a placeholder ownership boundary so future work lands in the
right place.
