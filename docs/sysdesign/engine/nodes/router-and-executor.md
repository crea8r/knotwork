# Node Types — Routing and <span style="color:#c1121f;font-weight:700">LEGACY</span> Executor Migration

> **S7 update:** <span style="color:#c1121f;font-weight:700">LEGACY</span> `tool_executor` is removed. Execution and tool-calling now happen inside `agent`
> nodes through adapter loops. Existing `tool_executor` nodes fail at compile time with `RuntimeError`.

---

## Routing in Current Runtime

Routing is topology-driven in `runtime/engine.py`:

- If a node has one outgoing edge -> direct transition
- If a node has more than one outgoing edge -> engine installs conditional routing using
  `_make_branch_router(targets)`

`_make_branch_router` reads `state["next_branch"]` and:

- routes to that node when it matches a valid outgoing target
- otherwise falls back to the first outgoing target

So branch selection is not tied to a special runtime node implementation; it is a generic behavior
for any node with multiple outgoing edges.

---

## How Nodes Choose a Branch

Adapters can emit `completed` with `next_branch`.

The typical path is the built-in `complete_node` tool call:

- `complete_node(output="...", next_branch="target-node-id")`

Runtime writes this value to both:

- `RunNodeState.next_branch`
- shared run state `next_branch`

The engine then uses it for the next transition.

---

## Conditional Router Node Status

`conditional_router` currently exists as a <span style="color:#c1121f;font-weight:700">LEGACY</span>/editor-facing node type, but runtime does not use a
special conditional evaluator for it.

Current behavior:

- it executes via the same `make_agent_node()` pipeline as other agent nodes
- branch choice still comes from `next_branch`
- any rule config (for example `routing_rules/default_target` in UI or <span style="color:#c1121f;font-weight:700">LEGACY</span> `conditions/default`)
  is advisory context for the agent prompt, not an enforced deterministic interpreter

There is a stub file `runtime/nodes/conditional_router.py`, but it is not wired into
`compile_graph()`.

---

## Tool Executor Migration

Graphs with <span style="color:#c1121f;font-weight:700">LEGACY</span> `tool_executor` must be migrated:

1. Remove the <span style="color:#c1121f;font-weight:700">LEGACY</span> `tool_executor` node.
2. Replace it with an `agent` node.
3. Set `agent_ref` or `registered_agent_id` to the intended agent.
4. Move tool-use instructions into node `config.system_prompt` (or agent profile), and let the
   adapter/tool loop drive execution.

This keeps runtime architecture consistent: one execution node model, one event contract, one routing model.

---

## Common Node Fields (Current)

All node objects in graph definition share:

- `id`
- `type`
- `name`
- `config`
- `note` (optional)

Current active runtime types:

- `start`
- `end`
- `agent`

Accepted for backward compatibility (<span style="color:#c1121f;font-weight:700">LEGACY</span>):

- <span style="color:#c1121f;font-weight:700">LEGACY</span> `llm_agent`
- <span style="color:#c1121f;font-weight:700">LEGACY</span> `human_checkpoint`
- <span style="color:#c1121f;font-weight:700">LEGACY</span> `conditional_router`

Rejected at compile time:

- <span style="color:#c1121f;font-weight:700">LEGACY</span> `tool_executor`
