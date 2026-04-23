# Workflows MCP Plan

## Role

`workflows` should be the richest prompt-owning module.

It already contains most of the needed session logic; the goal is to expose that logic more directly through MCP prompts and richer workflow resources.

## Resources

- `knotwork://workflows/graphs`
- `knotwork://workflows/graph/{graph_id}`
- `knotwork://workflows/graph/{graph_id}/root-draft`
- `knotwork://workflows/runs/active`
- `knotwork://workflows/run/{run_id}`
- `knotwork://workflows/run/{run_id}/nodes`
- `knotwork://workflows/run/{run_id}/summary`
- `knotwork://workflows/request/{message_id}`
  Structured request summary plus request context markdown.
- `knotwork://workflows/escalation/{escalation_id}/context`
- `knotwork://workflows/telemetry/{run_id}`

## Prompts

- `workflows.respond_to_request.operator`
- `workflows.respond_to_request.supervisor`
- `workflows.review_escalation`
- `workflows.follow_up_run`
- `workflows.edit_graph`
- `workflows.explain_run_state`
- `workflows.prepare_run_input`

## Notes

- These prompts already exist implicitly in workflow session specs and contract metadata.
- `workflows` should own the instructions, examples, and action strategy for workflow sessions.
- The plugin should not be the place where workflow session policy is first assembled into a real prompt.
