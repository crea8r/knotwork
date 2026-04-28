from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import Context, FastMCP

from core.mcp.runtime import KnotworkMCPRuntime
from modules.workflows.backend.graphs.draft_mutation import apply_graph_delta


def _request_summary(message: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(message, dict):
        return None
    metadata = message.get("metadata_") if isinstance(message.get("metadata_"), dict) else {}
    request = metadata.get("request") if isinstance(metadata.get("request"), dict) else None
    if request is None or str(metadata.get("kind") or "") != "request":
        return None
    questions = request.get("questions") if isinstance(request.get("questions"), list) else []
    assigned_to = request.get("assigned_to") if isinstance(request.get("assigned_to"), list) else []
    flow = metadata.get("flow") if isinstance(metadata.get("flow"), dict) else None
    return {
        "message_id": str(message.get("id")),
        "type": str(request.get("type") or "request"),
        "status": str(request.get("status") or "open"),
        "questions": [str(item).strip() for item in questions if str(item).strip()],
        "assigned_to": [str(item).strip() for item in assigned_to if str(item).strip()],
        "response_schema": request.get("response_schema"),
        "flow": flow,
        "context_markdown": str(request.get("context_markdown") or ""),
    }


def _find_open_request(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    for message in reversed(messages):
        summary = _request_summary(message)
        if summary is None:
            continue
        if summary["status"] == "open":
            return message
    return None

def _delta_from_diffs(diffs: list[dict[str, Any]] | dict[str, Any], edit_type: str, target_node_ids: list[str] | None) -> dict[str, Any]:
    if isinstance(diffs, dict):
        return diffs

    delta: dict[str, Any] = {}
    for raw in diffs:
        if not isinstance(raw, dict):
            continue
        action = str(raw.get("action") or raw.get("type") or "").strip().lower()
        if action == "add_node" and isinstance(raw.get("node"), dict):
            delta.setdefault("add_nodes", []).append(raw["node"])
        elif action == "update_node":
            node_id = raw.get("node_id")
            changes = raw.get("changes") if isinstance(raw.get("changes"), dict) else {}
            if node_id:
                delta.setdefault("update_nodes", []).append({"id": str(node_id), **changes})
        elif action == "remove_node":
            node_id = raw.get("node_id")
            if node_id:
                delta.setdefault("remove_nodes", []).append(str(node_id))
        elif action == "add_edge" and isinstance(raw.get("edge"), dict):
            delta.setdefault("add_edges", []).append(raw["edge"])
        elif action == "remove_edge":
            edge_id = raw.get("edge_id")
            if edge_id:
                delta.setdefault("remove_edges", []).append(str(edge_id))
        elif action == "set_entry_point":
            node_id = raw.get("node_id")
            if node_id:
                delta["set_entry_point"] = str(node_id)
        elif action == "set_input_schema" and isinstance(raw.get("fields"), list):
            delta["set_input_schema"] = raw["fields"]

    if target_node_ids and edit_type.strip().lower() == "node_content":
        update_nodes = delta.get("update_nodes")
        if isinstance(update_nodes, list):
            allowed = set(target_node_ids)
            delta["update_nodes"] = [
                item for item in update_nodes
                if isinstance(item, dict) and str(item.get("id") or "") in allowed
            ]
    return delta


def register_mcp_tools(mcp: FastMCP, runtime: KnotworkMCPRuntime) -> None:
    async def _list_run_chat_messages(ctx: Context | None, run_id: str) -> list[dict[str, Any]]:
        api = runtime.client_from_context(ctx)
        payload = await runtime.request(ctx, "GET", api.workspace_path(f"/runs/{run_id}/chat-messages"))
        return payload if isinstance(payload, list) else []

    async def _find_request_by_message_id(ctx: Context | None, message_id: str) -> dict[str, Any]:
        api = runtime.client_from_context(ctx)
        channels = await runtime.request(ctx, "GET", api.workspace_path("/channels"))
        rows = channels if isinstance(channels, list) else []
        for channel in rows:
            channel_id = channel.get("id") if isinstance(channel, dict) else None
            if not channel_id:
                continue
            messages = await runtime.request(ctx, "GET", api.workspace_path(f"/channels/{channel_id}/messages"))
            for message in messages if isinstance(messages, list) else []:
                if str(message.get("id")) == message_id:
                    return {
                        "channel": channel,
                        "message": message,
                        "summary": _request_summary(message),
                    }
        raise RuntimeError(f"Request message not found: {message_id}")

    async def _find_escalation(ctx: Context | None, escalation_id: str) -> dict[str, Any]:
        api = runtime.client_from_context(ctx)
        escalations = await runtime.request(ctx, "GET", api.workspace_path("/runs/escalations"))
        rows = escalations if isinstance(escalations, list) else []
        for escalation in rows:
            if str(escalation.get("id")) == escalation_id:
                return escalation
        raise RuntimeError(f"Escalation not found: {escalation_id}")

    async def _respond_to_request(
        ctx: Context | None,
        *,
        request_message: dict[str, Any],
        resolution: str,
        guidance: str | None = None,
        override_output: dict[str, Any] | None = None,
        next_branch: str | None = None,
        answers: list[str] | None = None,
    ) -> dict[str, Any]:
        api = runtime.client_from_context(ctx)
        channel_id = request_message.get("channel_id")
        message_id = request_message.get("id")
        if not channel_id or not message_id:
            raise RuntimeError("Request message is missing channel context")
        body = {
            "resolution": resolution,
            "guidance": guidance,
            "override_output": override_output,
            "next_branch": next_branch,
            "answers": answers,
            "actor_type": "agent",
        }
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path(f"/channels/{channel_id}/messages/{message_id}/respond"),
            body=body,
        )

    async def _resolve_workflow_id(
        ctx: Context | None,
        *,
        workflow_id: str | None,
        workflow_path: str | None,
        project_ref: str | None,
    ) -> str:
        if workflow_id:
            return workflow_id
        if not workflow_path:
            raise RuntimeError("workflow_id or workflow_path is required")
        api = runtime.client_from_context(ctx)
        params: dict[str, Any] = {"path": workflow_path}
        if project_ref:
            project = await runtime.request(ctx, "GET", api.workspace_path(f"/projects/{project_ref}"))
            project_id = project.get("id") if isinstance(project, dict) else None
            if project_id:
                params["project_id"] = project_id
        workflow = await runtime.request(ctx, "GET", api.workspace_path("/workflows/by-path"), params=params)
        if not isinstance(workflow, dict) or not workflow.get("id"):
            raise RuntimeError("Workflow not found for the requested path")
        return str(workflow["id"])

    async def _resolve_channel_id(ctx: Context | None, channel_ref: str | None) -> str | None:
        if not channel_ref:
            return None
        api = runtime.client_from_context(ctx)
        channel = await runtime.request(ctx, "GET", api.workspace_path(f"/channels/{channel_ref}"))
        return str(channel.get("id")) if isinstance(channel, dict) and channel.get("id") else None

    @mcp.resource(
        "knotwork://runs/active",
        name="active_runs",
        title="Active Runs",
        description="All non-terminal runs for the configured workspace.",
        mime_type="application/json",
    )
    async def active_runs_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        runs = await runtime.request(mcp.get_context(), "GET", api.workspace_path("/runs"))
        terminal = {"completed", "failed", "stopped"}
        active_runs = [run for run in runs if run.get("status") not in terminal]
        return runtime.json_text(active_runs)

    @mcp.resource(
        "knotwork://runs/escalations/open",
        name="open_run_escalations",
        title="Open Run Escalations",
        description="All open escalations for the configured workspace, grouped under runs.",
        mime_type="application/json",
    )
    async def open_run_escalations_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        escalations = await runtime.request(
            mcp.get_context(),
            "GET",
            api.workspace_path("/runs/escalations"),
            params={"status": "open"},
        )
        return runtime.json_text(escalations)

    @mcp.resource(
        "knotwork://workflows/catalog",
        name="workflow_catalog",
        title="Workflow Catalog",
        description="Workflows visible in the current workspace.",
        mime_type="application/json",
    )
    async def workflow_catalog_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        return runtime.json_text(await runtime.request(mcp.get_context(), "GET", api.workspace_path("/workflows")))

    @mcp.resource(
        "knotwork://workflows/workflow/{workflow_id}",
        name="workflow_detail",
        title="Workflow Detail",
        description="Workflow detail for one workflow id.",
        mime_type="application/json",
    )
    async def workflow_resource(workflow_id: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(await runtime.request(ctx, "GET", api.workspace_path(f"/workflows/{workflow_id}")))

    @mcp.resource(
        "knotwork://workflows/workflow/{workflow_id}/draft",
        name="workflow_draft",
        title="Workflow Draft",
        description="Root workflow draft for one workflow id.",
        mime_type="application/json",
    )
    async def workflow_draft_resource(workflow_id: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(await runtime.request(ctx, "GET", api.workspace_path(f"/workflows/{workflow_id}/draft")))

    @mcp.resource(
        "knotwork://workflows/runs/active",
        name="workflow_active_runs",
        title="Workflow Active Runs",
        description="All non-terminal workflow runs for the workspace.",
        mime_type="application/json",
    )
    async def workflow_active_runs_resource() -> str:
        return await active_runs_resource()

    @mcp.resource(
        "knotwork://workflows/run/{run_id}",
        name="workflow_run_detail",
        title="Run Detail",
        description="Workflow run detail for one run id.",
        mime_type="application/json",
    )
    async def run_resource(run_id: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(await runtime.request(ctx, "GET", api.workspace_path(f"/runs/{run_id}")))

    @mcp.resource(
        "knotwork://workflows/run/{run_id}/nodes",
        name="workflow_run_nodes",
        title="Run Nodes",
        description="Run node states for one run id.",
        mime_type="application/json",
    )
    async def run_nodes_resource(run_id: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(await runtime.request(ctx, "GET", api.workspace_path(f"/runs/{run_id}/nodes")))

    @mcp.resource(
        "knotwork://workflows/run/{run_id}/summary",
        name="workflow_run_summary",
        title="Run Summary",
        description="Concise run summary for one run id.",
        mime_type="application/json",
    )
    async def run_summary_resource(run_id: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        run = await runtime.request(ctx, "GET", api.workspace_path(f"/runs/{run_id}"))
        payload = {
            "id": run.get("id") if isinstance(run, dict) else run_id,
            "status": run.get("status") if isinstance(run, dict) else None,
            "trigger": run.get("trigger") if isinstance(run, dict) else None,
            "name": run.get("name") if isinstance(run, dict) else None,
            "created_at": run.get("created_at") if isinstance(run, dict) else None,
            "output_summary": run.get("output_summary") if isinstance(run, dict) else None,
            "needs_attention": run.get("needs_attention") if isinstance(run, dict) else None,
        }
        return runtime.json_text(payload)

    @mcp.resource(
        "knotwork://workflows/request/{message_id}",
        name="workflow_request_detail",
        title="Workflow Request",
        description="Structured request summary plus request context markdown for one message id.",
        mime_type="application/json",
    )
    async def request_resource(message_id: str, ctx: Context = None) -> str:
        request_payload = await _find_request_by_message_id(ctx, message_id)
        summary = request_payload["summary"]
        if summary is None:
            raise RuntimeError("Requested message is not a structured workflow request")
        return runtime.json_text(
            {
                "channel": request_payload["channel"],
                "message": request_payload["message"],
                "request_summary": {key: value for key, value in summary.items() if key != "context_markdown"},
                "request_context_markdown": summary.get("context_markdown") or "",
            }
        )

    @mcp.resource(
        "knotwork://workflows/escalations/open",
        name="workflow_open_escalations",
        title="Open Workflow Escalations",
        description="Open workflow escalations for the workspace.",
        mime_type="application/json",
    )
    async def workflow_open_escalations_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        payload = await runtime.request(
            mcp.get_context(),
            "GET",
            api.workspace_path("/runs/escalations"),
            params={"status": "open"},
        )
        return runtime.json_text(payload)

    @mcp.resource(
        "knotwork://workflows/escalation/{escalation_id}/context",
        name="workflow_escalation_context",
        title="Escalation Context",
        description="Escalation detail, linked run, and recent run chat context.",
        mime_type="application/json",
    )
    async def escalation_context_resource(escalation_id: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        escalation = await _find_escalation(ctx, escalation_id)
        run_id = str(escalation.get("run_id") or "")
        detail = await runtime.request(ctx, "GET", api.workspace_path(f"/runs/{run_id}/escalations/{escalation_id}"))
        run = await runtime.request(ctx, "GET", api.workspace_path(f"/runs/{run_id}"))
        messages = await _list_run_chat_messages(ctx, run_id)
        payload = {
            "escalation": detail,
            "run_summary": {
                "id": run.get("id") if isinstance(run, dict) else run_id,
                "status": run.get("status") if isinstance(run, dict) else None,
                "trigger": run.get("trigger") if isinstance(run, dict) else None,
                "name": run.get("name") if isinstance(run, dict) else None,
                "created_at": run.get("created_at") if isinstance(run, dict) else None,
            },
            "recent_messages": messages[-6:],
        }
        return runtime.json_text(payload)

    @mcp.resource(
        "knotwork://workflows/run/{run_id}/telemetry",
        name="workflow_run_telemetry",
        title="Run Telemetry",
        description="Worklog, provider logs, and recent chat messages for one run.",
        mime_type="application/json",
    )
    async def run_telemetry_resource(run_id: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        payload = {
            "worklog": await runtime.request(ctx, "GET", api.workspace_path(f"/runs/{run_id}/worklog")),
            "provider_logs": await runtime.request(ctx, "GET", api.workspace_path(f"/runs/{run_id}/provider-logs")),
            "chat_messages": await runtime.request(ctx, "GET", api.workspace_path(f"/runs/{run_id}/chat-messages")),
            "knowledge_changes": await runtime.request(ctx, "GET", api.workspace_path(f"/runs/{run_id}/knowledge-changes")),
        }
        return runtime.json_text(payload)

    @mcp.prompt(
        name="run.operator.respond_to_request",
        title="Run Operator Response",
        description="Guidance for operators responding to active workflow requests.",
    )
    def run_operator_respond_prompt() -> str:
        return "\n".join(
            [
                "Respond to the active structured request only.",
                "Use the run-completion path for the final workflow decision.",
                "Escalate only when supervisor review is actually needed.",
                "Do not substitute a normal channel reply for the workflow decision.",
                "Start with the loaded context only and read more context before writing when needed.",
            ]
        )

    @mcp.prompt(
        name="run.supervisor.respond_to_request",
        title="Run Supervisor Response",
        description="Guidance for supervisors responding to active workflow requests.",
    )
    def run_supervisor_respond_prompt() -> str:
        return "\n".join(
            [
                "Respond to the active structured request only.",
                "As supervisor, decide rework, finalize output, or stop the run.",
                "Use the smallest concrete decision that unblocks the workflow safely.",
                "Do not substitute a normal channel reply for the workflow decision.",
                "Start with the loaded context only and read more context before writing when needed.",
            ]
        )

    @mcp.prompt(
        name="run.supervisor.review_escalation",
        title="Review Escalation",
        description="Guidance for resolving workflow escalations.",
    )
    def review_escalation_prompt() -> str:
        return "\n".join(
            [
                "Resolve the escalation with the smallest concrete decision that unblocks the run.",
                "Use side commentary only as support, not as the resolution itself.",
                "Read more context before writing when needed.",
            ]
        )

    @mcp.prompt(
        name="run.follow_up",
        title="Run Follow-up",
        description="Guidance for responding to run follow-up interactions.",
    )
    def run_follow_up_prompt() -> str:
        return "\n".join(
            [
                "Stay on the active run outcome, blocker, or next instruction.",
                "Do not redesign the workflow in a run follow-up.",
                "Read more context before writing when needed.",
            ]
        )

    @mcp.prompt(
        name="workflow.edit",
        title="Workflow Edit",
        description="Guidance for editing workflow drafts.",
    )
    def workflow_edit_prompt() -> str:
        return "\n".join(
            [
                "Modify only the workflow surface tied to this session.",
                "Prefer incremental workflow deltas over replacing the whole draft.",
                "Read more context before writing when needed.",
            ]
        )

    @mcp.prompt(
        name="run.explain_state",
        title="Explain Run State",
        description="Guidance for explaining current run state.",
    )
    def explain_run_state_prompt() -> str:
        return (
            "Explain the current run state in operational terms: what happened, what is blocked, and what decision or input is missing."
        )

    @mcp.prompt(
        name="run.prepare_input",
        title="Prepare Run Input",
        description="Guidance for preparing run input payloads.",
    )
    def prepare_run_input_prompt() -> str:
        return (
            "Prepare the smallest structured input payload that lets the workflow continue.\n"
            "Prefer explicit fields over narrative blobs."
        )

    @mcp.tool(name="knotwork_run_operator_escalate")
    async def knotwork_run_operator_escalate(
        run_id: str,
        question: str,
        operator_analysis: str,
        suggested_options: list[str] | None = None,
        confidence: float | None = None,
        guidance: str | None = None,
        ctx: Context = None,
    ) -> Any:
        messages = await _list_run_chat_messages(ctx, run_id)
        request_message = _find_open_request(messages)
        if request_message is None:
            raise RuntimeError(f"No active structured request found for run {run_id}")
        guidance_lines = [guidance or "", f"Question: {question}", f"Operator analysis: {operator_analysis}"]
        if suggested_options:
            guidance_lines.append("Suggested options: " + "; ".join(item.strip() for item in suggested_options if item.strip()))
        if confidence is not None:
            guidance_lines.append(f"Operator confidence: {confidence}")
        return await _respond_to_request(
            ctx,
            request_message=request_message,
            resolution="request_revision",
            guidance="\n".join(line for line in guidance_lines if line),
        )

    @mcp.tool(name="knotwork_run_operator_complete")
    async def knotwork_run_operator_complete(
        run_id: str,
        output: Any,
        summary: str | None = None,
        next_branch: str | None = None,
        channel_message: str | None = None,
        ctx: Context = None,
    ) -> Any:
        messages = await _list_run_chat_messages(ctx, run_id)
        request_message = _find_open_request(messages)
        if request_message is None:
            raise RuntimeError(f"No active structured request found for run {run_id}")
        answers = None
        override_output = None
        if isinstance(output, dict):
            override_output = output
        elif isinstance(output, list):
            answers = [str(item).strip() for item in output if str(item).strip()]
        else:
            answers = [str(output).strip()] if str(output).strip() else None
        response = await _respond_to_request(
            ctx,
            request_message=request_message,
            resolution="accept_output",
            guidance=summary,
            override_output=override_output,
            next_branch=next_branch,
            answers=answers,
        )
        if channel_message:
            api = runtime.client_from_context(ctx)
            await runtime.request(
                ctx,
                "POST",
                api.workspace_path(f"/channels/{request_message['channel_id']}/messages"),
                body={
                    "role": "assistant",
                    "author_type": "agent",
                    "content": channel_message,
                    "run_id": run_id,
                },
            )
        return response

    @mcp.tool(name="knotwork_run_supervisor_resolve_escalation")
    async def knotwork_run_supervisor_resolve_escalation(
        escalation_id: str,
        decision: str,
        supervisor_response: str | None = None,
        operator_guidance: str | None = None,
        override_output: dict[str, Any] | None = None,
        next_branch: str | None = None,
        answers: list[str] | None = None,
        channel_id: str | None = None,
        ctx: Context = None,
    ) -> Any:
        escalation = await _find_escalation(ctx, escalation_id)
        run_id = str(escalation.get("run_id") or "")
        if not run_id:
            raise RuntimeError(f"Escalation {escalation_id} is missing run context")
        api = runtime.client_from_context(ctx)
        resolved_channel_id = await _resolve_channel_id(ctx, channel_id)
        guidance = operator_guidance or supervisor_response
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path(f"/runs/{run_id}/escalations/{escalation_id}/resolve"),
            body={
                "resolution": decision,
                "guidance": guidance,
                "override_output": override_output,
                "next_branch": next_branch,
                "answers": answers,
                "channel_id": resolved_channel_id,
                "actor_type": "agent",
            },
        )

    @mcp.tool(name="knotwork_workflow_edit")
    async def knotwork_workflow_edit(
        edit_type: str,
        diffs: list[dict[str, Any]] | dict[str, Any],
        workflow_path: str | None = None,
        workflow_id: str | None = None,
        project_ref: str | None = None,
        target_node_ids: list[str] | None = None,
        ctx: Context = None,
    ) -> Any:
        resolved_workflow_id = await _resolve_workflow_id(
            ctx,
            workflow_id=workflow_id,
            workflow_path=workflow_path,
            project_ref=project_ref,
        )
        api = runtime.client_from_context(ctx)
        try:
            draft = await runtime.request(ctx, "GET", api.workspace_path(f"/workflows/{resolved_workflow_id}/draft"))
            current_definition = draft.get("definition") if isinstance(draft, dict) else {}
        except Exception:
            workflow = await runtime.request(ctx, "GET", api.workspace_path(f"/workflows/{resolved_workflow_id}"))
            latest_version = workflow.get("latest_version") if isinstance(workflow, dict) else None
            current_definition = latest_version.get("definition") if isinstance(latest_version, dict) else {}

        delta = _delta_from_diffs(diffs, edit_type, target_node_ids)
        next_definition = apply_graph_delta(current_definition, delta)
        return await runtime.request(
            ctx,
            "PUT",
            api.workspace_path(f"/workflows/{resolved_workflow_id}/draft"),
            body={"definition": next_definition, "note": f"MCP workflow edit: {edit_type}"},
        )
