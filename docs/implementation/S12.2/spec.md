# Session 12.2 — Agent Invitation and Handbook Mentions in Designer / Workflow Chat

## Goal

Re-evaluate how agents can be invited or assigned into designer chat and workflow chat, and how handbook-file mention syntax should work there, after the S12 MCP/plugin split has clarified the role of MCP and the reduced role of the OpenClaw plugin.

## Why This Is Deferred From S9

Earlier S9 thinking assumed that designer chat and workflow chat could be extended by reusing the current OpenClaw/runtime model for agent participation. That assumption is no longer stable.

After S12:
- MCP becomes the agent -> Knotwork interaction surface
- the OpenClaw plugin is expected to become an inbound Knotwork communication path only
- the pre-S12 execution/runtime assumptions behind "invite an agent into chat" may no longer hold

Because of that, this feature should not be finalized in S9. It needs a fresh design after the MCP/plugin boundary is settled.

The same deferral now also applies to designer-chat Handbook-file mentions like `/filename` and `[[filename]]`, because that behavior depends on the same unresolved questions about how post-MCP designer/workflow chat should bind actions and context into workflow configuration.

## Required Rethink

S12.2 must answer at least these questions:

1. What does it mean for an agent to "join" a designer chat or workflow chat after MCP exists?
2. Is the participant a registered workspace agent, an MCP-connected representative, an OpenClaw-connected representative, or all of the above?
3. Is chat participation synchronous, async, or invitation-based with explicit claim/accept semantics?
4. What identity and permission model applies when an agent is added to a chat?
5. Which transport carries chat delivery and replies after the OpenClaw/MCP split?
6. How should transcript ownership, visibility, and decision/audit records work when multiple agents participate?
7. If designer/workflow chat can act on handbook context, should `/filename` and `[[filename]]` mentions resolve directly to handbook paths, and how should those mentions safely mutate node or workflow configuration?

## Out of Scope

- Implementing agent invitation into designer chat in S9
- Implementing agent invitation into workflow chat in S9
- Implementing designer-chat Handbook-file mentions in S9
- Assuming the current OpenClaw execution flow can be reused unchanged for chat participation

## Acceptance Criteria

1. The post-S12 architecture clearly defines how an agent is represented inside designer/workflow chat.
2. The design explicitly states the role of MCP vs OpenClaw plugin in chat participation.
3. The design covers participant identity, permissions, transcript visibility, and audit semantics.
4. The design explicitly defines whether handbook-file mentions like `/filename` and `[[filename]]` are supported, how they resolve, and how they mutate workflow configuration safely if supported.
5. The feature set is implementable without relying on pre-S12 OpenClaw runtime assumptions.
