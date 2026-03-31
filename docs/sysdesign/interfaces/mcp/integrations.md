# MCP Specification — Resources & Integrations

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
- Operate project/task workflows
- Inspect the operational state of the workspace
- Manage the important agent-facing/runtime-facing parts of the product where chat is an appropriate interface
- Rate outputs
- Test tools
- View audit log summaries

Not in MCP (UI only):
- Drag-and-drop canvas editing (inherently visual)
- Markdown editor for knowledge (text editing is better in app)
- Member management (sensitive, better with confirmation UI)
