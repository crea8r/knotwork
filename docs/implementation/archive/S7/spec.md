# Session 7: Agent Architecture Pivot

## What was built

S7 replaces the monolithic `llm_agent` / `human_checkpoint` / `conditional_router` / `tool_executor`
node model with a single pluggable **`agent`** node backed by an `AgentAdapter` interface.
The runtime no longer owns LLM calls — it delegates entirely to adapters.

## Key decisions

### 1. Single `agent` node type
All four legacy types collapse into `agent`.
- `agent_ref: str` — e.g. `"anthropic:claude-sonnet-4-6"`, `"openai:gpt-4o"`, `"human"`.
- `trust_level: str` — `"user_controlled"` | `"supervised"` | `"autonomous"`.
- Legacy types still execute (backward compat via `_resolve_agent_ref()` in `nodes/agent.py`).

### 2. AgentAdapter ABC
`runtime/adapters/base.py` defines:
- `NodeEvent` dataclass with `type` + `payload`.
- `AgentAdapter.run_node()` returning `AsyncGenerator[NodeEvent, None]`.

Event types: `started`, `log_entry`, `proposal`, `escalation`, `completed`, `failed`.

### 3. Four Knotwork-native tools
Every adapter exposes the same 4 tools (defined once in `adapters/tools.py`):
`write_worklog`, `propose_handbook_update`, `escalate`, `complete_node`.

Agents call these instead of accessing the DB directly. The engine node function
(`nodes/agent.py`) interprets the events and writes to DB.

### 4. ClaudeAdapter
Uses `anthropic.AsyncAnthropic` SDK directly (not LangChain).
Tool-calling loop (max 20 turns). Model ID comes from `agent_ref` (after `anthropic:`).

### 5. OpenAIAdapter
Uses OpenAI Assistants API (`openai.AsyncOpenAI`).
Creates an assistant + thread per execution, polls for completion.
Model ID comes from `agent_ref` (after `openai:`).

### 6. HumanAdapter
Yields a single `escalation` event → engine interrupts via LangGraph.

### 7. Engine refactor
`engine.py` now compiles all non-start/end nodes via `make_agent_node()`.
`next_branch` added to `RunState` for dynamic routing.
Extracted `execute_run` / `resume_run` to `runtime/runner.py` (engine re-exports them).

### 8. Built-in tool registry removed
`tools/builtins/` directory deleted.
`runtime/nodes/tool_executor.py` deleted.
Builtin endpoints removed from `tools/router.py`.
`BuiltinToolInfo` removed from `tools/schemas.py`.

### 9. Handbook proposal review
New `knowledge/proposals_router.py`:
- `GET /workspaces/{id}/handbook/proposals?status=pending`
- `POST /workspaces/{id}/handbook/proposals/{id}/approve`
- `POST /workspaces/{id}/handbook/proposals/{id}/reject`

Approving writes via `StorageAdapter` (uses the existing knowledge service).

### 10. Frontend changes
- `types/index.ts` — added `agent` NodeType, `TrustLevel`, `agent_ref`, `trust_level` on `NodeDef`.
- `store/canvas.ts` — `updateNodeConfig` now splits `_config` (→ node.config) from top-level fields.
- `utils/models.ts` — `AGENT_REF_OPTIONS` list.
- `components/designer/config/AgentNodeConfig.tsx` — unified agent config panel.
- `components/designer/config/RulesEditor.tsx` — extracted Rules + Checkpoints editors.
- `components/designer/NodeConfigPanel.tsx` — type-dispatch replaced with `AgentNodeConfig`.
- `pages/HandbookPage.tsx` — added "Proposals" tab (files | proposals).
- `components/handbook/ProposalsPanel.tsx` — proposals list + approve/reject detail view.
- `pages/GraphDetailPage.tsx` — "Add node" only shows `agent` type; defaults set.
- `pages/App.tsx` — `/tools` route removed.

## Breaking Changes

- Built-in tool endpoints removed: `GET /builtins`, `POST /builtins/{slug}/test`.
  Prior tests marked `xfail` in S6/test_builtins.py, S6/test_tools.py, S6.4/test_s6_4.py.

- `tool_executor` node type raises `RuntimeError` in `compile_graph()`.
  Graphs using `tool_executor` must migrate to `agent` type.

## Files created / modified

```
backend/knotwork/runtime/adapters/
  base.py         AgentAdapter ABC + NodeEvent
  __init__.py     get_adapter() registry
  tools.py        KNOTWORK_TOOLS (4 shared tools)
  human.py        HumanAdapter
  claude.py       ClaudeAdapter (Anthropic SDK)
  openai_adapter.py  OpenAIAdapter (Assistants API)
backend/knotwork/runtime/nodes/agent.py    Generic make_agent_node()
backend/knotwork/runtime/engine.py         Refactored (142 lines)
backend/knotwork/runtime/runner.py         execute_run / resume_run
backend/knotwork/knowledge/proposals_router.py
frontend/src/components/handbook/ProposalsPanel.tsx
frontend/src/components/designer/config/AgentNodeConfig.tsx
frontend/src/components/designer/config/RulesEditor.tsx
```
