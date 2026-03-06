# Runtime Specification — Node Execution

> **S7 update:** All execution nodes now use a single `make_agent_node()` factory that dispatches to
> a pluggable `AgentAdapter`. The four separate <span style="color:#c1121f;font-weight:700">LEGACY</span> node functions (`llm_agent_node`,
> `human_checkpoint_node`, `conditional_router_node`, `tool_executor_node`) are replaced.
> See `runtime/nodes/agent.py` and `runtime/adapters/`.

---

## Agent Node Dispatch

`make_agent_node()` (`runtime/nodes/agent.py`) returns an async LangGraph node function:

```python
async def node_fn(state: RunState) -> dict:
    # 1. Resolve agent_ref (LEGACY type fallbacks via _resolve_agent_ref)
    agent_ref = _resolve_agent_ref(node_def, settings.default_model)

    # 2. S7.1: if registered_agent_id is set, fetch per-workspace API key
    if registered_agent_id:
        ra = await db.get(RegisteredAgent, UUID(registered_agent_id))
        if ra and ra.is_active:
            api_key = ra.api_key
            agent_ref = ra.agent_ref  # honour registered model

    # 3. Load knowledge tree (folder-as-domain traversal)
    tree = await load_knowledge_tree(knowledge_paths, workspace_id)

    # 4. Create session token (scoped to run + node + workspace, 2h TTL)
    session_token = create_session_token(run_id, node_id, workspace_id, jwt_secret)

    # 5. Write initial RunNodeState (status: running)

    # 6. Get adapter and stream NodeEvents
    adapter = get_adapter(agent_ref, api_key=api_key)
    async for event in adapter.run_node(node_def, state, tree, session_token):
        "log_entry"   → persist RunWorklogEntry
        "proposal"    → persist RunHandbookProposal (status: pending)
        "escalation"  → create Escalation record, interrupt() LangGraph
        "completed"   → capture output + next_branch, break
        "failed"      → update ns.status = "failed", raise RuntimeError

    # 7. Apply confidence rules + checkpoint rules from node config
    confidence = compute_confidence(confidence_rules, output)
    failed_cps = evaluate_checkpoints(checkpoints, output)

    # 8. Persist final RunNodeState (status, output, confidence, next_branch)

    # 9. If confidence low or checkpoint failed → create escalation, interrupt LangGraph

    # 10. Return state update
    return {"current_output": output, "node_outputs": {node_id: output}, ...}
```

---

## AgentAdapter Interface

```python
class AgentAdapter(ABC):
    @abstractmethod
    async def run_node(
        self,
        node_def: dict,
        run_state: dict,
        knowledge_tree: KnowledgeTree,
        session_token: str,
    ) -> AsyncGenerator[NodeEvent, None]: ...
```

`NodeEvent(type, payload)` types:

| Type | Payload | Meaning |
|------|---------|---------|
| `started` | `{model}` | Adapter initialised |
| `log_entry` | `{content, entry_type, metadata}` | Agent wrote to worklog |
| `proposal` | `{path, proposed_content, reason}` | Agent proposed a handbook edit |
| `escalation` | `{question, options}` | Agent requested human intervention |
| `completed` | `{output, next_branch}` | Node finished successfully |
| `failed` | `{error}` | Adapter error |

---

## Adapter Implementations

### ClaudeAdapter (`adapters/claude.py`)

Uses `anthropic.AsyncAnthropic` directly. Runs a tool-calling loop (max 20 turns).

```
Build prompt (GUIDELINES + THIS CASE)
→ Call Claude with KNOTWORK_TOOLS
→ Tool loop:
    write_worklog           → yield log_entry event
    propose_handbook_update → yield proposal event
    escalate                → yield escalation event, return
    complete_node           → yield completed event, return
```

Effective API key: `self._api_key or settings.anthropic_api_key or None`.

### OpenAIAdapter (`adapters/openai_adapter.py`)

Uses OpenAI Assistants API. Creates a fresh Assistant + Thread per execution (stateless).

```
Build prompt → Create Assistant + Thread → Start Run
→ Poll loop (max 60s, 1s intervals):
    requires_action   → process KNOTWORK_TOOLS tool calls (same 4 tools)
    completed         → extract last assistant message, yield completed event
    failed/cancelled  → yield failed event
```

### HumanAdapter (`adapters/base.py`)

Always yields a single `escalation` event immediately. No LLM call. The run pauses until an operator resolves the escalation in the escalation inbox.

---

## Knotwork-Native Tools

Every adapter injects the same four tools (defined in `adapters/tools.py`). Agents call them autonomously:

| Tool | Purpose |
|------|---------|
| `write_worklog` | Record an observation or reasoning step to the run worklog |
| `propose_handbook_update` | Propose an improvement to a knowledge fragment (requires human approval) |
| `escalate` | Request human intervention — pauses the run |
| `complete_node` | Signal completion with output text and optional `next_branch` |

---

## Multi-Edge Routing

Routing between nodes is handled entirely by the engine — it is not node-type-specific.

When a source node has more than one outgoing edge, the engine compiles conditional edges:

```python
# engine.py compile_graph()
if len(targets) > 1:
    workflow.add_conditional_edges(
        src,
        _make_branch_router(targets),  # reads state["next_branch"]
        {t: t for t in targets},
    )
```

`_make_branch_router` routes to `state["next_branch"]` if it is a valid target, otherwise falls
back to the first declared target. Any agent node can influence routing by calling:

```python
complete_node(output="...", next_branch="target-node-id")
```

A `conditional_router` type node is not special at runtime — it executes via `make_agent_node()`
like any other node. The LLM evaluates the conditions from the node config and calls
`complete_node(next_branch=...)` to select the path. Pure-logic (LLM-free) evaluation is not
yet implemented (`runtime/nodes/conditional_router.py` is a stub that raises `NotImplementedError`).

---

## <span style="color:#c1121f;font-weight:700">LEGACY</span> Type Resolution

`_resolve_agent_ref()` maps <span style="color:#c1121f;font-weight:700">LEGACY</span> node types to the unified agent_ref format:

| <span style="color:#c1121f;font-weight:700">LEGACY</span> type | Resolved to |
|-------------|-------------|
| <span style="color:#c1121f;font-weight:700">LEGACY</span> `llm_agent` | `"anthropic:<model>"` or `"openai:<model>"` from node config |
| <span style="color:#c1121f;font-weight:700">LEGACY</span> `human_checkpoint` | `"human"` |
| <span style="color:#c1121f;font-weight:700">LEGACY</span> `conditional_router` | `"anthropic:<default_model>"` |
| <span style="color:#c1121f;font-weight:700">LEGACY</span> `tool_executor` | **Raises RuntimeError** — migrate to `agent` |
