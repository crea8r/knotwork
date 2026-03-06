# Tools in Knotwork

> <span style="color:#c1121f;font-weight:700">LEGACY DESIGN REMOVED (S7)</span>: The tool registry has been removed. Agents bring their own tools.
> Knotwork provides four built-in **Knotwork-native tools** injected into every adapter.
> The tool registry UI and `tool_executor` node type no longer exist.

---

## Knotwork-Native Tools

Every agent node — whether Claude, OpenAI, or a custom adapter — always has access to four
**Knotwork-native tools**. These are defined in `runtime/adapters/tools.py` and injected by
every adapter implementation. Agents decide when to call them.

| Tool | Purpose |
|------|---------|
| `write_worklog` | Record observations, findings, or intermediate reasoning to the run worklog. Persisted to `run_worklog_entries`. Visible in the operator run view. |
| `propose_handbook_update` | Propose an improvement to a knowledge fragment. Saved as a `RunHandbookProposal` (status: pending). Requires human approval before any change is written. |
| `escalate` | Request human intervention with a specific question. Creates an Escalation record and pauses the run. The operator resolves it in the escalation inbox. |
| `complete_node` | Signal that the node has finished. Carries the output text and an optional `next_branch` value for conditional routing. Calling this exits the tool loop. |

These tools are always present — they cannot be removed or disabled per node.

---

## Agent-Managed Tools

Agents bring their own tools. Knotwork does not manage a tool registry.

When configuring an agent node, the agent's tool capabilities come from:
1. Its own registered toolset (defined in the agent system, not in Knotwork)
2. The `system_prompt` field in the node config, which can instruct the agent which capabilities to use
3. MCP tool servers the agent is connected to

This is an intentional architectural boundary: Knotwork provides structure, knowledge, and
oversight — it does not own or manage tools.

---

## Handbook Proposals

When an agent calls `propose_handbook_update`, the proposal is stored in `run_handbook_proposals`
and surfaced in the **Handbook → Proposals** tab. The owner reviews and approves or rejects each
proposal. Approval writes the proposed content to the knowledge file and creates a new version.

The knowledge improvement loop:
1. Agent identifies a gap while working on a real case
2. Agent calls `propose_handbook_update` with path + proposed content + reason
3. Owner reviews in the Proposals panel
4. On approval → knowledge file is updated, new version created

---

## Worklog

Every `write_worklog` call is persisted to `run_worklog_entries` and visible in the run detail
view. The worklog gives operators visibility into what the agent was observing and reasoning
about — not just the final output.

Use cases:
- Intermediate reasoning steps
- Data fetched from external sources
- Flags or warnings the agent wants to surface
- Rationale for decisions made

---

## <span style="color:#c1121f;font-weight:700">LEGACY</span>: Tool Registry (removed in S7)

Prior to S7, Knotwork maintained a tool registry with built-in tools (`web.search`, `web.fetch`,
`http.request`, `calc`). These were attached to `tool_executor` nodes.

As of S7:
- The tool registry is removed
- The Tools navigation link is removed
- `tool_executor` nodes raise a `RuntimeError` and must be migrated to `agent` nodes
- Built-in tools (`web.search`, `web.fetch`, etc.) are no longer provided by Knotwork — agents
  call external APIs directly via their own tool systems
