# Assets MCP Plan

## Role

`assets` should own handbook/knowledge/file-change task guidance.

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

- `get_knowledge_file_by_id(file_id)`
  Returns the file metadata identified by id, including scope, project binding where present, current canonical path, file type, editability, version info, and other asset metadata.
- `get_knowledge_folder_by_id(folder_id)`
  Returns the folder metadata identified by id, including scope, project binding where present, current canonical path, and other folder metadata.
- `search_assets(scope, project_id?, title?, content?, creator?)`
  Searches assets by title, content, and creator metadata. The caller must explicitly choose either workspace knowledge base scope or project scope; if project scope is chosen, `project_id` is required.
- `change_asset_content(scope, path, project_id?, new_content, change_summary?, auto_approve?)`
  Changes the content of a file asset at the canonical path within the chosen scope. When `auto_approve` is false or omitted, this creates a pending asset change for review; when `auto_approve` is true, the change may be applied immediately if policy allows.

## Prompts

- `assets.propose_knowledge_change`
- `assets.review_knowledge_change`
- `assets.create_knowledge_file`
- `assets.extract_handbook_update_from_channel`
- `assets.summarize_relevant_knowledge_for_task`

## Notes

- A workflow is still an asset file. It should be treated like other files at the assets layer and distinguished by workflow file type rather than by a separate asset class.
