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

-- resolution values: "approved" | "edited" | "guided" | "aborted"
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

### Tool Registry

```
knotwork_list_tools
  Input: { workspace_id?, category? }
  Returns: tool list

knotwork_get_tool
  Input: { tool_id }
  Returns: tool definition and usage stats

knotwork_test_tool
  Input: { tool_id, input }
  Returns: tool output
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
