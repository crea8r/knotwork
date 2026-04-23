# Projects MCP Plan

## Role

`projects` should own project/objective reasoning and status planning.

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
