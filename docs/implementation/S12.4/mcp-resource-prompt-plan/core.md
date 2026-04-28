# Core MCP Plan

## Role

`core` should expose only bootstrap and composition surfaces.

It should not become the home of domain instructions for workflows, assets, projects, or communication tasks.

## Resources

- `knotwork://workspace/overview`
  High-level workspace snapshot.
- `knotwork://workspace/bootstrap`
  Current member, enabled modules, available prompt ids, and bootstrap docs.
- `knotwork://workspace/capabilities`
  Thin registry of module resources, prompts, and tools.

## Tools

- No public `knotwork_*` tool calls are planned in `core`.
- Session bootstrap and composition may remain internal, but public tool calls belong to the owning modules.

## Prompts

- Prefer no core prompts with domain logic.
- If a core prompt exists at all, it should stay purely compositional and defer actual task guidance to module-owned prompts.

## Notes

- `core` may compose cross-module context when a session spans multiple modules.
- The actual instructions, examples, and domain-specific action strategy should stay in the owning module.
- Core should not expose semantic-contract compatibility tools such as contract listing, contract fetch, or generic contract execution.
- The current workflow-session composition living in `core` is heavier than ideal and should trend back toward module ownership over time.
