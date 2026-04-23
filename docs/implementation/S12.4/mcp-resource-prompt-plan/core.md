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

- `build_session_packet(task_id, trigger, session_name?, legacy_user_prompt?)`
  Build one normalized session packet from a task trigger so a client can start from a single canonical entrypoint instead of re-resolving module ownership and cross-module context itself.

## Prompts

- Prefer no core prompts with domain logic.
- If a core prompt exists at all, it should stay purely compositional and defer actual task guidance to module-owned prompts.

## Notes

- `core` may compose cross-module context when a session spans multiple modules.
- The actual instructions, examples, and domain-specific action strategy should stay in the owning module.
- Core should not expose semantic-contract compatibility tools such as contract listing, contract fetch, or generic contract execution.
- The current workflow-session composition living in `core` is heavier than ideal and should trend back toward module ownership over time.
