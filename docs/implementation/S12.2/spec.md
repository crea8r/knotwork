# Session 12.2 — Post-MCP Interaction Rethink

## Goal

Re-evaluate how agents can be invited or assigned into designer chat and workflow chat, how handbook-file mention syntax should work there, whether workload-honesty / queue semantics should still be modeled around the OpenClaw plugin at all, and how project-level AI interaction should work after the S12 MCP/plugin split has clarified the role of MCP and the reduced role of the OpenClaw plugin.

## Why This Is Deferred From S9

Earlier S9 thinking assumed that designer chat and workflow chat could be extended by reusing the current OpenClaw/runtime model for agent participation. That assumption is no longer stable.

After S12:
- MCP becomes the agent -> Knotwork interaction surface
- the OpenClaw plugin is expected to become an inbound Knotwork communication path only
- the pre-S12 execution/runtime assumptions behind "invite an agent into chat" may no longer hold

Because of that, this feature should not be finalized in S9. It needs a fresh design after the MCP/plugin boundary is settled.

The same applies to the AI-adjacent parts that were briefly implied around S11 project status behavior. S11 stays human-first. Any project-level AI behavior such as drafting status updates, posting project summaries, or acting as a configured project lieutenant needs to be designed here after the MCP/plugin boundary is clear.

The same deferral now also applies to designer-chat Handbook-file mentions like `/filename` and `[[filename]]`, because that behavior depends on the same unresolved questions about how post-MCP designer/workflow chat should bind actions and context into workflow configuration.

It also applies to the old S10 "OpenClaw workload honesty" design. That work assumed the plugin remained responsible for two-way execution/runtime coordination, including queue state, claim behavior, and backpressure heuristics. Since S12 may relocate those responsibilities, S10 needs to be redesigned here instead of implemented as originally written.

The original S10 material is preserved here as design input:

- `docs/implementation/S12.2/workload-honesty-spec.md`
- `docs/implementation/S12.2/workload-honesty-plan.md`

## Required Rethink

S12.2 must answer at least these questions:

1. What does it mean for an agent to "join" a designer chat or workflow chat after MCP exists?
2. Is the participant a registered workspace agent, an MCP-connected representative, an OpenClaw-connected representative, or all of the above?
3. Is chat participation synchronous, async, or invitation-based with explicit claim/accept semantics?
4. What identity and permission model applies when an agent is added to a chat?
5. Which transport carries chat delivery and replies after the OpenClaw/MCP split?
6. How should transcript ownership, visibility, and decision/audit records work when multiple agents participate?
7. If designer/workflow chat can act on handbook context, should `/filename` and `[[filename]]` mentions resolve directly to handbook paths, and how should those mentions safely mutate node or workflow configuration?
8. After the MCP/plugin split, where should queue semantics, concurrency/backpressure policy, and workload visibility live?
9. Is there still a plugin-owned claim loop, or does honest workload state need to be expressed elsewhere in the architecture?
10. If project-level AI can draft or post status updates, what identity, permission, and review rules apply?
11. Should project progress summaries be product features, workflow patterns, or both?

## Out of Scope

- Implementing agent invitation into designer chat in S9
- Implementing agent invitation into workflow chat in S9
- Implementing designer-chat Handbook-file mentions in S9
- Implementing the old S10 plugin-centric workload-honesty design before the post-MCP rethink is complete
- Assuming the current OpenClaw execution flow can be reused unchanged for chat participation
- Implementing project-level AI status writing inside S11

## Acceptance Criteria

1. The post-S12 architecture clearly defines how an agent is represented inside designer/workflow chat.
2. The design explicitly states the role of MCP vs OpenClaw plugin in chat participation.
3. The design covers participant identity, permissions, transcript visibility, and audit semantics.
4. The design explicitly defines whether handbook-file mentions like `/filename` and `[[filename]]` are supported, how they resolve, and how they mutate workflow configuration safely if supported.
5. The design explicitly states where workload-honesty semantics belong after the MCP/plugin split, including whether any part still belongs to the plugin.
6. The design explicitly states how project-level AI status behavior works, including authorship, review, and product boundary.
7. The feature set is implementable without relying on pre-S12 OpenClaw runtime assumptions.
