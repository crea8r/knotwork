# S4 Spec — Chat Designer Agent · Node Config Panels · MD Parser

## What Was Built

### 1. `designer/session.py` — In-memory Session Store
- `get_history(session_id)`, `add_message(session_id, role, content)`, `clear_session(session_id)`
- Process-local dict; no persistence needed for S4

### 2. `designer/parser.py` — Markdown-to-Graph Parser
`parse_md_to_graph(content, name) -> dict`:
- `## Node Name` headings → nodes with kebab-case ids
- `**Type:** <type>` → node type (llm_agent default)
- `-> Target Node` lines → directed edges
- First heading → entry_point
- Invalid types silently fall back to `llm_agent`

### 3. `designer/agent.py` — Designer Chat Agent
`design_graph(session_id, message, workspace_id, existing_graph, db) -> dict`:
- System prompt describes all 4 node types and graph_delta schema
- Includes full conversation history per session_id
- Injects current graph JSON into system message
- Expects JSON output: `{reply, graph_delta, questions}`
- Strips markdown code fences from LLM response
- Falls back to `{reply: fallback, graph_delta: {}, questions: []}` on any error
- Saves turn to session history

### 4. `graphs/schemas.py` — New Schemas
- `GraphUpdate`: name, description, status, default_model (all optional)
- `DesignChatRequest`: session_id, message, graph_id
- `DesignChatResponse`: reply, graph_delta, questions
- `ImportMdRequest`: content, name

### 5. `graphs/service.py` — New Operations
- `update_graph(db, graph_id, data: GraphUpdate)` — partial update
- `delete_graph(db, graph_id)` — deletes GraphVersions then Graph

### 6. `graphs/router.py` — Implemented Stubs
| Method | Path | Description |
|---|---|---|
| PATCH | `/{ws}/graphs/{id}` | Partial update (name / description / status / model) |
| DELETE | `/{ws}/graphs/{id}` | Delete graph + all versions |
| POST | `/{ws}/graphs/import-md` | Parse MD → create Graph + GraphVersion |
| POST | `/{ws}/graphs/design/chat` | Chat with designer agent |

### 7. Frontend
- `api/designer.ts` — `useDesignChat`, `useImportMd` hooks
- `store/canvas.ts` — `applyDelta()` implemented; `GraphDelta` type exported; `entry_point` added to `GraphDefinition`
- `types/index.ts` — `entry_point` added to `GraphDefinition`
- `components/designer/config/LlmAgentConfig.tsx` — model, system_prompt, knowledge picker (multi-select from Handbook), confidence_threshold, fail_safe, confidence_rules, checkpoints
- `components/designer/config/HumanCheckpointConfig.tsx` — prompt, timeout_hours
- `components/designer/config/ConditionalRouterConfig.tsx` — routing_rules [{condition, target}], default_target
- `components/designer/config/ToolExecutorConfig.tsx` — tool_id, tool_config (JSON editor)
- `components/designer/NodeConfigPanel.tsx` — dispatches to correct config form, shows node id + remove button
- `components/designer/DesignerChat.tsx` — chat UI, calls design/chat, calls `applyDelta` on delta
- `pages/GraphDetailPage.tsx` — added Designer toggle (left panel), replaced raw JSON inspector with `NodeConfigPanel` (right panel)

## Key Decisions

1. **In-memory session store**: no DB table needed for S4. Multi-turn context works within a process. In production, back with Redis.
2. **graph_delta is free-form dict**: allows forward compatibility without schema changes. Frontend validates structure via TypeScript interface.
3. **`import-md` creates a full Graph + GraphVersion**: no separate "draft" state — imported graphs appear in the graph list immediately.
4. **`delete_graph` deletes versions first**: avoids FK constraint violation on SQLite and Postgres.
5. **`applyDelta` merges update_nodes config**: existing config keys not mentioned in the delta are preserved (non-destructive update).
6. **Knowledge picker uses `useKnowledgeFiles()`**: live list from the Handbook, no extra state.

## Test Results

- S1: 29 passed, 3 xfailed
- S2: 55 passed
- S3: 31 passed
- S4: 26 passed
- Total: 141 passed, 3 xfailed
