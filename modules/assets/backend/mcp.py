from __future__ import annotations

from typing import Any
from urllib.parse import unquote

from mcp.server.fastmcp import Context, FastMCP

from core.mcp.runtime import KnotworkMCPRuntime


def register_mcp_tools(mcp: FastMCP, runtime: KnotworkMCPRuntime) -> None:
    def _decode_path(path: str | None) -> str:
        return unquote(str(path or "")).strip("/")

    def _normalize_scope(scope: str | None) -> str:
        value = str(scope or "workspace").strip().lower()
        if value not in {"workspace", "project"}:
            raise RuntimeError(f"Unsupported asset scope: {scope}")
        return value

    def _asset_files_path(api, project_ref: str | None = None) -> str:
        if project_ref:
            return api.workspace_path(f"/assets/project/{project_ref}/files")
        return api.workspace_path("/assets/workspace/files")

    def _asset_folders_path(api, project_ref: str | None = None) -> str:
        if project_ref:
            return api.workspace_path(f"/assets/project/{project_ref}/folders")
        return api.workspace_path("/assets/workspace/folders")

    async def _list_files(ctx: Context | None, *, scope: str, project_ref: str | None = None) -> list[dict[str, Any]]:
        api = runtime.client_from_context(ctx)
        payload = await runtime.request(ctx, "GET", _asset_files_path(api, project_ref if scope == "project" else None))
        return payload if isinstance(payload, list) else []

    async def _list_folders(ctx: Context | None, *, scope: str, project_ref: str | None = None) -> list[dict[str, Any]]:
        api = runtime.client_from_context(ctx)
        payload = await runtime.request(ctx, "GET", _asset_folders_path(api, project_ref if scope == "project" else None))
        return payload if isinstance(payload, list) else []

    async def _read_file(
        ctx: Context | None,
        *,
        path: str,
        scope: str,
        project_ref: str | None = None,
    ) -> dict[str, Any]:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "GET",
            f"{_asset_files_path(api, project_ref if scope == 'project' else None)}/by-path",
            params={"path": path},
        )

    async def _search_files(
        ctx: Context | None,
        *,
        query_text: str,
        scope: str,
        project_ref: str | None = None,
    ) -> list[dict[str, Any]]:
        api = runtime.client_from_context(ctx)
        suffix = "/search"
        payload = await runtime.request(
            ctx,
            "GET",
            f"{_asset_files_path(api, project_ref if scope == 'project' else None)}{suffix}",
            params={"q": query_text},
        )
        return payload if isinstance(payload, list) else []

    def _immediate_children(path: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        prefix = f"{path}/" if path else ""
        out: list[dict[str, Any]] = []
        for item in items:
            item_path = _decode_path(item.get("path"))
            if path and not item_path.startswith(prefix):
                continue
            if path and item_path == path:
                continue
            if not path and "/" in item_path:
                continue
            remainder = item_path[len(prefix):] if prefix else item_path
            if not remainder or "/" in remainder:
                continue
            out.append(item)
        return out

    def _folder_snapshot(path: str, folders: list[dict[str, Any]], files: list[dict[str, Any]], *, scope: str) -> dict[str, Any]:
        folder = next((item for item in folders if _decode_path(item.get("path")) == path), None)
        if folder is None:
            raise RuntimeError(f"Folder not found: {path}")
        return {
            "scope": scope,
            "folder": folder,
            "folders": _immediate_children(path, folders),
            "files": _immediate_children(path, files),
        }

    async def _resolve_asset(
        ctx: Context | None,
        *,
        path: str | None,
        asset_id: str | None,
        scope: str,
        project_ref: str | None = None,
    ) -> dict[str, Any]:
        files = await _list_files(ctx, scope=scope, project_ref=project_ref)
        folders = await _list_folders(ctx, scope=scope, project_ref=project_ref)
        normalized_path = _decode_path(path)

        if asset_id:
            for item in files:
                if str(item.get("id")) == asset_id:
                    return {"asset_type": "file", "path": _decode_path(item.get("path")), "metadata": item}
            for item in folders:
                if str(item.get("id")) == asset_id:
                    return {"asset_type": "folder", "path": _decode_path(item.get("path")), "metadata": item}
            raise RuntimeError(f"Asset not found: {asset_id}")

        if normalized_path:
            for item in files:
                if _decode_path(item.get("path")) == normalized_path:
                    return {"asset_type": "file", "path": normalized_path, "metadata": item}
            for item in folders:
                if _decode_path(item.get("path")) == normalized_path:
                    return {"asset_type": "folder", "path": normalized_path, "metadata": item}
            raise RuntimeError(f"Asset not found: {normalized_path}")

        raise RuntimeError("Either path or asset_id is required")

    async def _resolve_channel_id(ctx: Context | None, channel_ref: str | None) -> str | None:
        if not channel_ref:
            return None
        api = runtime.client_from_context(ctx)
        payload = await runtime.request(ctx, "GET", api.workspace_path(f"/channels/{channel_ref}"))
        return str(payload.get("id")) if isinstance(payload, dict) and payload.get("id") else None

    @mcp.resource(
        "knotwork://assets/workspace/catalog",
        name="assets_workspace_catalog",
        title="Workspace Asset Catalog",
        description="Top-level workspace asset folders and files with lightweight metadata.",
        mime_type="application/json",
    )
    async def workspace_catalog_resource() -> str:
        ctx = mcp.get_context()
        folders = await _list_folders(ctx, scope="workspace")
        files = await _list_files(ctx, scope="workspace")
        payload = {
            "scope": "workspace",
            "path": "",
            "folders": _immediate_children("", folders),
            "files": _immediate_children("", files),
        }
        return runtime.json_text(payload)

    @mcp.resource(
        "knotwork://assets/workspace/file/{path}",
        name="assets_workspace_file",
        title="Workspace Asset File",
        description="Canonical workspace asset file with content and metadata.",
        mime_type="application/json",
    )
    async def workspace_file_resource(path: str, ctx: Context = None) -> str:
        return runtime.json_text(await _read_file(ctx, path=_decode_path(path), scope="workspace"))

    @mcp.resource(
        "knotwork://assets/workspace/folder/{path}",
        name="assets_workspace_folder",
        title="Workspace Asset Folder",
        description="Canonical workspace asset folder plus immediate child folders and files.",
        mime_type="application/json",
    )
    async def workspace_folder_resource(path: str, ctx: Context = None) -> str:
        folders = await _list_folders(ctx, scope="workspace")
        files = await _list_files(ctx, scope="workspace")
        return runtime.json_text(_folder_snapshot(_decode_path(path), folders, files, scope="workspace"))

    @mcp.resource(
        "knotwork://assets/project/{project_id}/catalog",
        name="assets_project_catalog",
        title="Project Asset Catalog",
        description="Top-level project asset folders and files with lightweight metadata.",
        mime_type="application/json",
    )
    async def project_catalog_resource(project_id: str, ctx: Context = None) -> str:
        folders = await _list_folders(ctx, scope="project", project_ref=project_id)
        files = await _list_files(ctx, scope="project", project_ref=project_id)
        payload = {
            "scope": "project",
            "project_ref": project_id,
            "path": "",
            "folders": _immediate_children("", folders),
            "files": _immediate_children("", files),
        }
        return runtime.json_text(payload)

    @mcp.resource(
        "knotwork://assets/project/{project_id}/file/{path}",
        name="assets_project_file",
        title="Project Asset File",
        description="Canonical project-scoped asset file with content and metadata.",
        mime_type="application/json",
    )
    async def project_file_resource(project_id: str, path: str, ctx: Context = None) -> str:
        return runtime.json_text(
            await _read_file(ctx, path=_decode_path(path), scope="project", project_ref=project_id)
        )

    @mcp.resource(
        "knotwork://assets/project/{project_id}/folder/{path}",
        name="assets_project_folder",
        title="Project Asset Folder",
        description="Canonical project-scoped asset folder plus immediate child folders and files.",
        mime_type="application/json",
    )
    async def project_folder_resource(project_id: str, path: str, ctx: Context = None) -> str:
        folders = await _list_folders(ctx, scope="project", project_ref=project_id)
        files = await _list_files(ctx, scope="project", project_ref=project_id)
        return runtime.json_text(_folder_snapshot(_decode_path(path), folders, files, scope="project"))

    @mcp.resource(
        "knotwork://assets/changes/open",
        name="assets_open_changes",
        title="Open Asset Changes",
        description="Open or pending asset change proposals visible in the workspace.",
        mime_type="application/json",
    )
    async def open_changes_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        payload = await runtime.request(mcp.get_context(), "GET", api.workspace_path("/assets/changes"))
        rows = payload if isinstance(payload, list) else []
        filtered = [row for row in rows if str(row.get("status") or "").lower() in {"open", "pending"}]
        return runtime.json_text(filtered)

    @mcp.resource(
        "knotwork://assets/change/{proposal_id}",
        name="assets_change_detail",
        title="Asset Change Detail",
        description="Full detail for one asset change proposal.",
        mime_type="application/json",
    )
    async def change_resource(proposal_id: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(await runtime.request(ctx, "GET", api.workspace_path(f"/assets/changes/{proposal_id}")))

    @mcp.prompt(
        name="assets.propose_asset_change",
        title="Propose Asset Change",
        description="Guidance for proposing a reviewed asset change.",
    )
    def propose_asset_change_prompt() -> str:
        return (
            "Propose the smallest reviewed asset change that solves the request.\n"
            "Prefer precise file or folder targets.\n"
            "Use `knotwork_asset_change` for the proposal and keep the reason concrete."
        )

    @mcp.prompt(
        name="assets.review_asset_change",
        title="Review Asset Change",
        description="Guidance for reviewing a proposed asset change.",
    )
    def review_asset_change_prompt() -> str:
        return (
            "Review the proposed asset change against the target path, scope, and stated reason.\n"
            "Check for scope mistakes, stale assumptions, and unnecessary file churn."
        )

    @mcp.prompt(
        name="assets.create_file",
        title="Create Asset File",
        description="Guidance for creating a new asset file in the right scope.",
    )
    def create_file_prompt(path: str) -> str:
        return (
            f"Create a new asset file at `{path}`.\n"
            "Choose the narrowest correct scope, write only the needed content, and avoid creating sibling churn."
        )

    @mcp.prompt(
        name="assets.create_folder",
        title="Create Asset Folder",
        description="Guidance for creating a new asset folder in the right scope.",
    )
    def create_folder_prompt(path: str) -> str:
        return (
            f"Create a new asset folder at `{path}`.\n"
            "Use a durable information architecture and avoid placeholder folders with no clear role."
        )

    @mcp.prompt(
        name="assets.extract_handbook_update_from_channel",
        title="Extract Asset Update From Channel",
        description="Guidance for extracting an asset update request from channel discussion.",
    )
    def extract_handbook_update_prompt() -> str:
        return (
            "Extract only the asset update implied by the channel discussion.\n"
            "Turn diffuse discussion into a concrete change proposal with a clear target path and reason."
        )

    @mcp.prompt(
        name="assets.summarize_relevant_knowledge_for_task",
        title="Summarize Relevant Assets",
        description="Guidance for summarizing the most relevant assets for a task.",
    )
    def summarize_relevant_knowledge_prompt(task_summary: str) -> str:
        return (
            f"Summarize the most relevant assets for this task: {task_summary}\n"
            "Prefer high-signal files and explain why each one matters."
        )

    @mcp.tool(name="knotwork_asset_search")
    async def knotwork_asset_search(
        query_text: str,
        project_path_prefix: str | None = None,
        workspace_path_prefix: str | None = None,
        related_workflow_ref: str | None = None,
        ctx: Context = None,
    ) -> Any:
        warnings: list[str] = []
        workspace_results = await _search_files(ctx, query_text=query_text, scope="workspace")
        if workspace_path_prefix:
            prefix = _decode_path(workspace_path_prefix)
            workspace_results = [
                item for item in workspace_results if _decode_path(item.get("path")).startswith(prefix)
            ]

        project_results: list[dict[str, Any]] = []
        if project_path_prefix:
            warnings.append(
                "project_path_prefix requires project-scoped session context; standalone asset search cannot infer the current project."
            )

        return {
            "query_text": query_text,
            "related_workflow_ref": related_workflow_ref,
            "workspace_results": workspace_results,
            "project_results": project_results,
            "warnings": warnings,
        }

    @mcp.tool(name="knotwork_asset_read")
    async def knotwork_asset_read(
        path: str | None = None,
        asset_id: str | None = None,
        scope: str | None = None,
        project_ref: str | None = None,
        revision: str | None = None,
        ctx: Context = None,
    ) -> Any:
        resolved_scope = _normalize_scope(scope)
        if resolved_scope == "project" and not project_ref:
            raise RuntimeError("project_ref is required for project-scoped asset reads")
        asset = await _resolve_asset(
            ctx,
            path=path,
            asset_id=asset_id,
            scope=resolved_scope,
            project_ref=project_ref,
        )
        if asset["asset_type"] == "folder":
            folders = await _list_folders(ctx, scope=resolved_scope, project_ref=project_ref)
            files = await _list_files(ctx, scope=resolved_scope, project_ref=project_ref)
            return _folder_snapshot(asset["path"], folders, files, scope=resolved_scope)

        file_payload = await _read_file(
            ctx,
            path=asset["path"],
            scope=resolved_scope,
            project_ref=project_ref,
        )
        if revision and str(file_payload.get("current_version_id") or "") != revision:
            raise RuntimeError("Historical asset revision reads are not supported by the current asset API")
        return {
            "scope": resolved_scope,
            "asset_type": "file",
            "project_ref": project_ref,
            **file_payload,
        }

    @mcp.tool(name="knotwork_asset_change")
    async def knotwork_asset_change(
        change_type: str,
        reason: str,
        path: str | None = None,
        asset_id: str | None = None,
        scope: str | None = None,
        project_ref: str | None = None,
        new_path: str | None = None,
        proposed_diff: str | None = None,
        proposed_content: str | None = None,
        base_revision: str | None = None,
        source_channel_ref: str | None = None,
        ctx: Context = None,
    ) -> Any:
        resolved_scope = _normalize_scope(scope)
        if resolved_scope == "project" and not project_ref:
            raise RuntimeError("project_ref is required for project-scoped asset changes")

        resolved_change_type = change_type.strip().lower()
        if resolved_change_type not in {"create", "edit", "delete"}:
            raise RuntimeError(f"Unsupported change_type: {change_type}")

        existing_asset: dict[str, Any] | None = None
        if path or asset_id:
            try:
                existing_asset = await _resolve_asset(
                    ctx,
                    path=path,
                    asset_id=asset_id,
                    scope=resolved_scope,
                    project_ref=project_ref,
                )
            except RuntimeError:
                if asset_id or resolved_change_type != "create":
                    raise

        target_path = (
            existing_asset["path"]
            if existing_asset is not None
            else _decode_path(new_path or path)
        )
        if not target_path:
            raise RuntimeError("A target asset path is required")

        target_type = existing_asset["asset_type"] if existing_asset is not None else (
            "file" if proposed_content is not None or "." in target_path.split("/")[-1] else "folder"
        )
        if resolved_change_type == "edit" and not proposed_diff:
            raise RuntimeError("proposed_diff is required for asset edits")
        if resolved_change_type == "edit" and target_type != "file" and not new_path:
            raise RuntimeError("Folder edits are only supported as moves with new_path")

        if base_revision and existing_asset is not None and existing_asset["asset_type"] == "file":
            file_payload = await _read_file(
                ctx,
                path=existing_asset["path"],
                scope=resolved_scope,
                project_ref=project_ref,
            )
            if str(file_payload.get("current_version_id") or "") != base_revision:
                raise RuntimeError("Asset base_revision does not match the current file version")

        action_type = "update_content"
        if resolved_change_type == "create" and target_type == "folder":
            action_type = "create"
        elif resolved_change_type == "delete":
            action_type = "delete"
        elif new_path and existing_asset is not None and _decode_path(new_path) != existing_asset["path"]:
            action_type = "move"

        api = runtime.client_from_context(ctx)
        source_channel_id = await _resolve_channel_id(ctx, source_channel_ref)
        payload = {
            "project_ref": project_ref,
            "new_path": _decode_path(new_path),
            "proposed_diff": proposed_diff,
            "base_revision": base_revision,
            "scope": resolved_scope,
        }
        body = {
            "path": target_path,
            "proposed_content": proposed_content or "",
            "reason": reason,
            "project_ref": project_ref,
            "source_channel_id": source_channel_id,
            "action_type": action_type,
            "target_type": target_type,
            "payload": {key: value for key, value in payload.items() if value},
        }
        return await runtime.request(ctx, "POST", api.workspace_path("/assets/changes"), body=body)
