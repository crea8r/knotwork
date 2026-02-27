# MCP Specification

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

---

## MCP Resources

Resources expose readable context that agents can inspect without calling a tool:

```
knotwork://workspaces/{workspace_id}/graphs
  -- Graph list for the workspace

knotwork://workspaces/{workspace_id}/escalations/open
  -- All open escalations

knotwork://workspaces/{workspace_id}/runs/active
  -- All currently running or paused runs

knotwork://knowledge/{path}
  -- Content of a knowledge fragment

knotwork://runs/{run_id}/summary
  -- Run summary with node statuses
```

---

## Telegram & WhatsApp Integration

Phase 1 uses a webhook-based bot. When an escalation is created:

1. Knotwork sends a formatted notification to the operator's linked Telegram/WhatsApp
2. The message includes a **deep link** back to the in-app escalation screen
3. The operator taps the link, opens the app, and responds

This is the simplest path and works on day 1 without building a full conversational bot.

### Phase 2: Respond from Telegram

The Telegram bot becomes a full MCP client. The operator can respond to escalations directly:

```
Bot: ⚠️ Escalation — Financial Analysis
     Contract Review Run · 14:03
     Confidence: 42%

     Output: "The contract value is VND 45B. IRR appears
     low but I could not verify the depreciation schedule"

     [Approve] [Provide guidance] [View in app]

User: provide guidance

Bot: What guidance would you like to give the agent?

User: Check the depreciation schedule in Appendix B.
      IRR must include it.

Bot: ✅ Guidance sent. Run resumed.
     The agent will retry with your instructions.
```

The bot uses `knotwork_resolve_escalation` behind the scenes.

---

## Claude Desktop / Cursor Integration

Add to Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "knotwork": {
      "command": "npx",
      "args": ["-y", "@knotwork/mcp-client"],
      "env": {
        "KNOTWORK_API_KEY": "your-api-key",
        "KNOTWORK_WORKSPACE_ID": "your-workspace-id"
      }
    }
  }
}
```

Once connected, users can interact with the full Knotwork platform from Claude:

```
User: Show me any open escalations

Claude: You have 1 open escalation:
        - Financial Analysis (Contract Review) — 42% confidence
          Waiting 23 minutes

        Would you like to review and resolve it?

User: Yes, approve it

Claude: [calls knotwork_get_escalation, shows context]
        The agent output was: ...

        Are you sure you want to approve?

User: Yes

Claude: [calls knotwork_resolve_escalation]
        Done. The run has resumed.
```

---

## Full App Operation via Chat

The MCP surface is designed so that every significant operation in Knotwork can be done through a chat interface. This is not a power-user feature — it is an expected use pattern for business operators who prefer a chat-first workflow on mobile.

Supported fully through MCP:
- Design and edit graphs (via chat designer)
- Trigger and monitor runs
- Handle all escalations
- Read and update knowledge
- Rate outputs
- Test tools
- View audit log summaries

Not in MCP (UI only):
- Drag-and-drop canvas editing (inherently visual)
- Markdown editor for knowledge (text editing is better in app)
- Member management (sensitive, better with confirmation UI)
