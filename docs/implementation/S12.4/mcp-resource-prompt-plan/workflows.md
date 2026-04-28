# Workflows MCP Plan

## Role

`workflows` should own run execution decisions, run escalation handling, and workflow editing.

It already contains most of the needed session and contract logic; the goal is to expose that logic more directly through MCP prompts, richer workflow resources, and a smaller intent-led tool surface.

## Resources

- `knotwork://workflows/catalog`
- `knotwork://workflows/workflow/{workflow_id}`
- `knotwork://workflows/workflow/{workflow_id}/draft`
- `knotwork://workflows/runs/active`
- `knotwork://workflows/run/{run_id}`
- `knotwork://workflows/run/{run_id}/nodes`
- `knotwork://workflows/run/{run_id}/summary`
- `knotwork://workflows/request/{message_id}`
  Structured request summary plus request context markdown.
- `knotwork://workflows/escalations/open`
- `knotwork://workflows/escalation/{escalation_id}/context`
- `knotwork://workflows/run/{run_id}/telemetry`

## Tools

- `knotwork_run_operator_escalate(run_id, question, operator_analysis, suggested_options?, confidence?, guidance?)`
  Pause the active run and escalate operator work upward. `question` captures what the supervisor needs to answer; `operator_analysis` carries the operator's reasoning; optional `suggested_options`, `confidence`, and `guidance` help the supervisor respond quickly.
- `knotwork_run_operator_complete(run_id, output, summary?, next_branch?, channel_message?)`
  Complete the active operator-handled run request with final output. `summary` is the concise operator takeaway; `next_branch` is optional for branching workflows; `channel_message` is optional user-facing wording derived from that result.
- `knotwork_run_supervisor_resolve_escalation(escalation_id, decision, supervisor_response?, operator_guidance?, override_output?, next_branch?, answers?, channel_id?)`
  Resolve an escalation and unblock the run. `decision` must use the same public enum already used by the UI: `accept_output`, `override_output`, `request_revision`, or `abort_run`. `supervisor_response` is the direct supervisor answer; `operator_guidance` tells the operator what to do next when the decision is `request_revision`; optional `override_output`, `next_branch`, and `answers` carry the resolved payload back into the run.
- `knotwork_workflow_edit(edit_type, diffs, workflow_path?, workflow_id?, project_ref?, target_node_ids?)`
  Create or edit a workflow draft by applying git-like diffs to workflow nodes. `edit_type` distinguishes node-structure edits from node-content edits. `workflow_path` or `workflow_id` identifies the workflow; `target_node_ids` scopes the edit to specific nodes when needed; `diffs` is a list of node changes rather than a monolithic workflow blob. Existing workflows are editable only while they remain in draft.

## Prompts

- `run.operator.respond_to_request`
- `run.supervisor.respond_to_request`
- `run.supervisor.review_escalation`
- `run.follow_up`
- `workflow.edit`
- `run.explain_state`
- `run.prepare_input`

## Notes

- These prompts already exist implicitly in workflow session specs and contract metadata.
- `workflows` should own the instructions, examples, and action strategy for workflow sessions.
- Public MCP naming should use `workflow` and `workflow draft`; internal `graph` and `graph root draft` terms can remain inside code and compatibility layers.
- The plugin should not be the place where workflow session policy is first assembled into a real prompt.
