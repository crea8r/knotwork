# Assets MCP Plan

## Role

`assets` should own asset search, asset read, and reviewed asset change guidance.

It should not leave asset-change session policy in the plugin.

## Resources

- `knotwork://assets/workspace/catalog`
  Returns the top-level asset catalog for workspace-scoped knowledge: root folders, top-level files, lightweight metadata, and current paths.
- `knotwork://assets/workspace/file/{path}`
  Returns the canonical workspace-scoped file at the current URI-escaped relative path: file metadata, current content, file type, editability, and current version info.
- `knotwork://assets/workspace/folder/{path}`
  Returns the canonical workspace-scoped folder at the current URI-escaped relative path: folder metadata plus immediate child folders/files with lightweight metadata.
- `knotwork://assets/project/{project_id}/catalog`
  Returns the top-level asset catalog for one project scope: folders, files, lightweight metadata, and current paths under that project.
- `knotwork://assets/project/{project_id}/file/{path}`
  Returns the canonical project-scoped file at the current URI-escaped relative path within that project.
- `knotwork://assets/project/{project_id}/folder/{path}`
  Returns the canonical project-scoped folder at the current URI-escaped relative path within that project.
- `knotwork://assets/changes/open`
  Returns open or pending asset change proposals visible in the workspace, including target path, scope, action type, reason, and status.
- `knotwork://assets/change/{proposal_id}`
  Returns one knowledge change proposal in full detail: target path, action type, proposed content or payload, reason, and review state.

## Tools

- `knotwork_asset_search(query_text, project_path_prefix?, workspace_path_prefix?, related_workflow_ref?)`
  Search for relevant non-workflow assets from text found in the current asset chat. `project_path_prefix` narrows the search inside the current project asset space; `workspace_path_prefix` narrows the search inside the workspace knowledge base; `related_workflow_ref` links the search to a known workflow when that relationship matters.
- `knotwork_asset_read(path?, asset_id?, scope?, project_ref?, revision?)`
  Read one asset when the agent already knows the canonical path or stable asset id. `path` is the primary lookup key; `asset_id` is an optional alternative when the agent already has the durable asset identifier.
- `knotwork_asset_change(change_type, reason, path?, asset_id?, scope?, project_ref?, new_path?, proposed_diff?, proposed_content?, base_revision?, source_channel_ref?)`
  Propose a reviewed non-workflow asset change in comment-and-accept format. `change_type` is `create`, `edit`, or `delete`. `proposed_diff` is required for edits; `proposed_content` is used when the change needs full replacement content; `new_path` is used for creates when the asset does not yet exist; `base_revision` guards against stale edits. The change request is posted into the current chat channel for convenience, and the resulting accepted diff is posted to the asset channel when the change takes effect.

## Prompts

- `assets.propose_asset_change`
- `assets.review_asset_change`
- `assets.create_file`
- `assets.create_folder`
- `assets.extract_handbook_update_from_channel`
- `assets.summarize_relevant_knowledge_for_task`

## Notes

- A workflow file still lives in the asset system, but public workflow mutation should go through `knotwork_workflow_edit`, not `knotwork_asset_change`.
