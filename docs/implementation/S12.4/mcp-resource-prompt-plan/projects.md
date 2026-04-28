# Projects MCP Plan

## Role

`projects` should own objective and project state updates, plus related planning context.

It should do more than expose CRUD wrappers.

## Resources

- `knotwork://projects/list`
- `knotwork://projects/{project_ref}`
- `knotwork://projects/{project_ref}/dashboard`
- `knotwork://projects/{project_ref}/channels`
- `knotwork://projects/{project_ref}/status`
- `knotwork://projects/objectives`
- `knotwork://projects/objective/{objective_ref}`
- `knotwork://projects/objective/{objective_ref}/chain`
- `knotwork://projects/objective/{objective_ref}/children`

## Tools

- `knotwork_objective_update(objective_ref, description?, status?, progress_percent?, status_summary?, key_result_changes?, owner_type?, owner_name?)`
  Update tracked objective state. This is the public tool for objective description changes, progress updates, status summary changes, assignment changes, and patch-style key result updates when a key result is reached or revised.
- `knotwork_project_update(project_ref, status?, title?, description?, status_update_summary?, affected_objective_refs?)`
  Update project-level state. Use this for project description and status updates, especially when project state changes because related objectives have changed. If `status_update_summary` is provided, the tool should also create the project status update entry that records the narrative change.

## Prompts

- `projects.break_down_objective`
- `projects.refine_objective_scope`
- `projects.create_status_update`
- `projects.route_project_work`
- `projects.summarize_project_health`

## Notes

- If the question is "what should happen next on this objective?", that belongs here.
- Objective/project planning prompts should be module-owned and reusable across clients.
- `projects` should consume `communication` and `admin` resources as supporting context, not re-own them.
