# MCP Specification — Server & Tools

## Overview

Knotwork exposes a full **Model Context Protocol (MCP)** server so that any MCP-compatible client — Claude Desktop, Cursor, a Telegram bot, a Slack bot, or a custom agent — can operate the entire application through natural language.

The goal: a user should be able to design a graph, run it, handle an escalation, and check results without ever opening the web app — using only a chat interface on their phone.

---

## MCP Server

The MCP server runs alongside the API. It exposes tools and resources.

```
Transport: SSE (Server-Sent Events) for web clients
           stdio for local clients (Claude Desktop, Cursor)
Base URL:  https://app.knotwork.io/mcp
Auth:      API key passed in MCP client configuration
```

---

## MCP Tools

The intent is whole-product coverage for Phase 1 user-facing operations, not a narrow add-on for one subsystem. The API/OpenAPI baseline should be used to review this surface regularly so MCP planning stays aligned with what the backend actually exposes.

### Graph Management

```
knotwork_list_graphs
  Input: { workspace_id?, status? }
  Returns: list of graphs with name, status, last run time

knotwork_get_graph
  Input: { graph_id }
  Returns: graph definition, node list, recent run summary

knotwork_create_graph
  Input: { name, description? }
  Returns: graph_id, chat_session_id to continue designing

knotwork_design_graph
  Input: { session_id, message }
  Returns: assistant reply, graph delta, follow-up questions
  -- Continues the chat designer conversation

knotwork_import_graph_from_md
  Input: { content, name }
  Returns: draft graph_id, node summary

knotwork_update_graph_status
  Input: { graph_id, status }   -- active | archived | draft
  Returns: updated graph
```

### Run Management

```
knotwork_trigger_run
  Input: { graph_id, input }
  Returns: run_id, status, eta_seconds

knotwork_get_run
  Input: { run_id }
  Returns: run status, node statuses, pending escalations

knotwork_list_runs
  Input: { graph_id?, status?, limit? }
  Returns: list of runs

knotwork_abort_run
  Input: { run_id, reason? }
  Returns: updated run status

knotwork_inspect_node
  Input: { run_id, node_id }
  Returns: full RunNodeState (input, output, knowledge snapshot, confidence)
```

### Escalation Handling

```
knotwork_list_escalations
  Input: { workspace_id?, status? }
  Returns: open escalations with summary

knotwork_get_escalation
  Input: { escalation_id }
  Returns: full escalation context (node output, confidence, run state fields)

knotwork_resolve_escalation
  Input: { escalation_id, resolution, output?, guidance?, reason? }
  Returns: updated escalation, resumed run status

-- resolution values: "accept_output" | "override_output" | "request_revision" | "abort_run"
```

### Knowledge Management

```
knotwork_list_knowledge
  Input: { workspace_id?, path? }
  Returns: file tree

knotwork_read_knowledge
  Input: { path }
  Returns: file content, token counts, linked files, current version

knotwork_write_knowledge
  Input: { path, content, change_summary? }
  Returns: new version_id

knotwork_knowledge_history
  Input: { path }
  Returns: version list

knotwork_review_suggestion
  Input: { suggestion_id, action }  -- action: "approve" | "reject" | "edit"
  Input (if edit): { content }
  Returns: updated file or dismissed suggestion
```

### Agent Registry

```
knotwork_list_agents
  Input: { workspace_id }
  Returns: registered agents with display_name, provider, agent_ref, api_key_hint

knotwork_register_agent
  Input: { display_name, provider, agent_ref, api_key? }
  Returns: registered agent record

knotwork_delete_agent
  Input: { agent_id }
  Returns: 204 No Content
```

### Worklog & Proposals

```
knotwork_list_worklog
  Input: { run_id }
  Returns: worklog entries for the run (content, entry_type, node_id, agent_ref)

knotwork_list_proposals
  Input: { workspace_id?, status? }
  Returns: handbook proposals (path, proposed_content, reason, status, run_id)

knotwork_review_proposal
  Input: { proposal_id, action }  -- action: "approve" | "reject"
  Returns: updated proposal; if approved, new knowledge file version created
```

### Ratings

```
knotwork_rate_node
  Input: { run_id, node_id, score, comment? }
  Returns: rating record

knotwork_list_ratings
  Input: { graph_id?, node_id?, score_lte? }
  Returns: ratings list
```
