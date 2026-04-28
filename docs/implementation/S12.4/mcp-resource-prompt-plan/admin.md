# Admin MCP Plan

## Role

`admin` is mainly a context module.

It should expose member/workspace status surfaces that other modules can use for routing and coordination, but it should not own business-task prompts from other product areas.

## Resources

- `knotwork://admin/members`
- `knotwork://admin/members/agents`
- `knotwork://admin/members/{member_id}`
- `knotwork://admin/members/current`
  Self-profile bootstrap for the current actor in this workspace. Used for "who am I here?" context before routing work or updating status.
- `knotwork://admin/capacity-board`
  Contribution briefs, availability, capacity, commitments, recent work.
- `knotwork://admin/workspace/policies`
  Workspace-level operating guidance when that content exists in-module.

## Tools

- No public `knotwork_*` tool calls are planned in `admin`.
- `admin` stays as a context and resource module for routing, identity, and workspace policy.

## Prompts

- `admin.update_my_status`
- `admin.choose_member_for_task`
- `admin.summarize_team_capacity`

## Notes

- `search_members(...)` should search only active members.
