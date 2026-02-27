# Runtime Specification

## Overview

The Knotwork runtime converts a graph definition into a LangGraph execution graph and runs it. LangGraph provides the execution backbone: conditional edges, parallel node execution, state management, and human interrupts.

---

## LangGraph Mapping

| Knotwork concept | LangGraph concept |
|-----------------|-------------------|
| Graph | `StateGraph` |
| Node | Node function added via `graph.add_node()` |
| Direct edge | `graph.add_edge()` |
| Conditional edge | `graph.add_conditional_edges()` |
| Run state | `TypedDict` state schema |
| Human escalation | `interrupt()` |
| Checkpointing | `MemorySaver` / `PostgresSaver` |
| Parallel nodes | Fan-out edges to multiple nodes |

---

## Run State Schema

The run state is a typed dictionary that flows through all nodes. Its structure is defined by the graph's input/output mappings across all nodes.

```python
class RunState(TypedDict):
    # System fields (always present)
    run_id: str
    graph_id: str
    current_node_id: str
    escalation_pending: bool
    error: Optional[str]

    # User-defined fields (from graph input/output mappings)
    # e.g.:
    contract_type: Optional[str]
    contract_file_url: Optional[str]
    asset_valuation: Optional[dict]
    financial_analysis: Optional[dict]
    legal_review: Optional[dict]
    final_recommendation: Optional[str]
```

The state schema is inferred from all node input/output mappings when the graph is compiled. Any field referenced in any mapping is added to the schema.

---

## Graph Compilation

Before a graph can run, it is compiled from the stored definition.

```python
def compile_graph(graph_def: GraphDefinition) -> CompiledGraph:
    builder = StateGraph(RunState)

    for node in graph_def.nodes:
        fn = build_node_function(node)
        builder.add_node(node.id, fn)

    for edge in graph_def.edges:
        if edge.type == "direct":
            builder.add_edge(edge.source, edge.target)
        elif edge.type == "conditional":
            builder.add_conditional_edges(
                edge.source,
                build_router_function(edge.source_node),
            )

    builder.set_entry_point(graph_def.entry_node_id)
    builder.set_finish_point(graph_def.exit_node_id)

    checkpointer = PostgresSaver(db_pool)
    return builder.compile(checkpointer=checkpointer)
```

Compiled graphs are cached in memory. The cache is invalidated when a graph definition changes.

---

## Node Execution Functions

### LLM Agent Node

```python
async def llm_agent_node(state: RunState, config: NodeConfig) -> RunState:
    # 1. Load and snapshot knowledge
    knowledge_tree = await load_knowledge_tree(config.knowledge)
    snapshot = {path: version_id for path, version_id in knowledge_tree.items()}

    # 2. Flag token count
    token_count = count_tokens(knowledge_tree)
    if token_count < config.token_min or token_count > config.token_max:
        await flag_knowledge_size(config.node_id, token_count)

    # 3. Build messages
    system_prompt = render_knowledge(knowledge_tree)
    user_message = render_input(state, config.input_mapping)

    # 4. Call LLM with tools
    model = get_model(config.model)
    tools = load_tools(config.tools)
    response = await model.with_structured_output(config.output_schema).bind_tools(tools).ainvoke(
        [SystemMessage(system_prompt), HumanMessage(user_message)]
    )

    # 5. Compute confidence
    confidence = response.get(config.confidence_field, 1.0)
    for rule in config.confidence_rules:
        if evaluate(rule.condition, response):
            confidence = min(confidence, rule.set)

    # 6. Run checkpoints
    for checkpoint in config.checkpoints:
        if not evaluate(checkpoint.expression, response):
            return await handle_checkpoint_failure(state, config, checkpoint, response)

    # 7. Escalate if low confidence
    if confidence < config.confidence_threshold:
        return await escalate(state, config, response, confidence, "low_confidence")

    # 8. Persist node state
    await save_node_state(RunNodeState(
        run_id=state["run_id"],
        node_id=config.node_id,
        input=extract_input(state, config.input_mapping),
        output=response,
        knowledge_snapshot=snapshot,
        resolved_token_count=token_count,
        confidence_score=confidence,
        status="completed",
    ))

    # 9. Update run state
    return apply_output_mapping(state, response, config.output_mapping)
```

### Human Checkpoint Node

```python
async def human_checkpoint_node(state: RunState, config: NodeConfig) -> RunState:
    context = extract_fields(state, config.context_fields)

    # Create escalation and pause
    escalation = await create_escalation(
        run_id=state["run_id"],
        node_id=config.node_id,
        type="human_checkpoint",
        context=context,
        timeout_at=now() + config.timeout_hours * 3600,
    )

    await notify_operators(escalation, config.notify)

    # LangGraph interrupt — suspends execution here
    human_response = interrupt({"escalation_id": escalation.id})

    # Resume after human responds
    await resolve_escalation(escalation.id, human_response)

    if human_response["resolution"] == "aborted":
        raise RunAbortedError(human_response.get("reason"))

    return apply_human_response(state, human_response, config.output_mapping)
```

### Conditional Router Node

```python
def conditional_router_node(state: RunState, config: NodeConfig) -> str:
    """Returns the target node ID. Used with add_conditional_edges."""
    for condition in config.conditions:
        if evaluate(condition.expression, state):
            return condition.goto
    return config.default
```

### Tool Executor Node

```python
async def tool_executor_node(state: RunState, config: NodeConfig) -> RunState:
    tool = load_tool(config.tool)
    tool_input = map_fields(state, config.input_mapping)

    try:
        result = await tool.invoke(tool_input)
    except ToolError as e:
        return await handle_tool_error(state, config, e)

    await save_node_state(RunNodeState(
        run_id=state["run_id"],
        node_id=config.node_id,
        input=tool_input,
        output=result,
        status="completed",
    ))

    return apply_output_mapping(state, result, config.output_mapping)
```

---

## Parallel Execution

LangGraph executes nodes in parallel when multiple nodes share a common predecessor with direct edges. No special configuration is needed — the graph structure determines parallelism.

```
┌─────────────────┐
│  Contract Intake │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐ ┌───────────┐
│ Legal │ │ Financial  │   ← these run in parallel
└───────┘ └───────────┘
    │         │
    └────┬────┘
         │
    ┌────▼────┐
    │ Approval │
    └──────────┘
```

State merging: when parallel branches converge, their outputs are merged into the shared state. If both branches write to the same field, the last-writer-wins (deterministic by execution order within LangGraph).

---

## Checkpointing and Resume

Every node execution is persisted to the PostgreSQL checkpointer after completion. This enables:

**Resume after escalation**: When a human responds to an escalation, the run resumes from the interrupted node with the human's response injected via `Command(resume=human_response)`.

**Replay**: A run can be replayed from any checkpoint by restoring the state at that point and re-executing from that node forward.

**Fault recovery**: If the runtime process crashes mid-run, the run can be resumed from the last completed node on restart.

---

## Error Handling

### Node error (unexpected exception)

```
1. Catch exception
2. Log to RunNodeState (status: failed, error: message)
3. Apply node fail_safe:
   - retry: retry up to retry_limit, then escalate
   - escalate: create escalation immediately
   - skip: mark node skipped, continue to next
   - route: route to the configured fallback node
4. If escalated and timed out: run status → stopped
```

### Distinction: error vs low confidence

| Situation | Cause | Recovery |
|-----------|-------|----------|
| Node error | Exception (API failure, parse error, tool crash) | Retry → escalate |
| Low confidence | LLM completed but is uncertain | Escalate for human review |
| Checkpoint failure | Output does not meet validation rules | Retry with context → escalate |

These are treated differently in the escalation UI: the operator sees a different reason string and different context for each.

---

## Run Lifecycle Management

```python
async def trigger_run(graph_id: str, input: dict, triggered_by: str) -> Run:
    graph = await load_graph(graph_id)
    compiled = get_compiled_graph(graph)

    # Estimate run time from historical data
    eta = await estimate_run_time(graph_id)

    run = await create_run(
        graph_id=graph_id,
        graph_version_id=graph.current_version_id,
        input=input,
        trigger=triggered_by,
        eta_seconds=eta,
        status="queued",
    )

    await queue.enqueue("execute_run", run_id=run.id)
    return run

async def execute_run(run_id: str):
    run = await load_run(run_id)
    compiled = get_compiled_graph(run.graph_id)

    config = {"configurable": {"thread_id": run.id}}

    await update_run_status(run.id, "running")

    try:
        async for event in compiled.astream(run.input, config):
            await handle_run_event(run.id, event)

        await update_run_status(run.id, "completed")

    except RunAbortedError:
        await update_run_status(run.id, "stopped")
    except Exception as e:
        await update_run_status(run.id, "failed", error=str(e))
```

---

## ETA Estimation

Run time is estimated from the median duration of the last 20 completed runs of the same graph. If fewer than 3 runs exist, a default estimate based on node count is used (30 seconds per LLM Agent node, 5 seconds per other node type).

The ETA is returned at trigger time and is not updated during the run. It is advisory only.

---

## Knowledge Loading

### Folder-as-domain rule

The folder a file lives in defines its **domain**. When traversing transitive links, only links into active domains are followed.

- `shared/` and root-level files are **universal** — their links are always followed
- Domain-folder files (`legal/`, `finance/`, etc.) are **domain-scoped** — their links are only followed if that domain is active

**Active domains** = the set of folder names of all files the node directly references, plus `shared`.

```python
def get_domain(path: str) -> str:
    """Returns the top-level folder name, or 'shared' for root-level files."""
    parts = path.split("/")
    return parts[0] if len(parts) > 1 else "shared"

def is_universal(path: str) -> bool:
    domain = get_domain(path)
    return domain in ("shared", "templates") or "/" not in path

async def load_knowledge_tree(
    fragment_paths: list[str],
    workspace_id: str,
) -> dict[str, dict]:
    """
    Returns {path: {content, version_id}} for the root fragments
    and all transitively linked fragments, filtered by domain.

    Rules:
    - Each file is loaded at most once (visited set prevents loops/duplication)
    - Active domains = domains of directly referenced root files + shared
    - Universal files (shared/, root-level): follow all their links
    - Domain files: only follow links into active domains
    """
    active_domains = {get_domain(p) for p in fragment_paths} | {"shared"}
    visited = set()
    result = {}

    async def load(path: str, from_universal: bool = False):
        if path in visited:
            return
        visited.add(path)

        try:
            content, version_id = await storage_adapter.read(workspace_id, path)
        except FileNotFoundError:
            log_warning(f"Knowledge link not found: {path}")
            return

        result[path] = {
            "content": content,
            "version_id": version_id,
            "domain": get_domain(path),
        }

        links = extract_wiki_links(content)
        for link in links:
            resolved = resolve_link(path, link)
            target_domain = get_domain(resolved)

            # Follow the link if:
            # - this file is universal (shared/root), OR
            # - the target is universal, OR
            # - the target domain is active
            if (
                is_universal(path)
                or is_universal(resolved)
                or target_domain in active_domains
            ):
                await load(resolved)

    for path in fragment_paths:
        await load(path)

    return result
```

### Prompt construction: GUIDELINES vs CASE

The resolved knowledge tree is always presented to the LLM in a structured prompt that separates guidelines from the specific case being worked on:

```python
def build_agent_prompt(
    knowledge_tree: dict[str, dict],
    run_state: dict,
    run_context_files: list[dict],
    input_mapping: dict,
) -> tuple[str, str]:
    """Returns (system_prompt, user_prompt)."""

    # Build guidelines section — ordered: root/shared first, then domain files
    universal = [v for k, v in knowledge_tree.items() if is_universal(k)]
    domain    = [v for k, v in knowledge_tree.items() if not is_universal(k)]
    ordered   = universal + domain

    guidelines = "\n\n---\n\n".join(
        f"## {item['domain'].upper()} — {item['path']}\n\n{item['content']}"
        for item in ordered
    )

    system_prompt = f"=== GUIDELINES (how to work) ===\n\n{guidelines}"

    # Build case section — run state fields + attached files
    case_data = extract_input(run_state, input_mapping)
    case_files = "\n\n".join(
        f"[File: {f['name']}]\n{f['content']}" for f in run_context_files
    )

    user_prompt = (
        f"=== THIS CASE (what you are working on) ===\n\n"
        f"{json.dumps(case_data, indent=2)}\n\n"
        f"{case_files}"
    ).strip()

    return system_prompt, user_prompt
```

The LLM always knows: guidelines describe how to work; the case is what it is working on. This distinction prevents the agent from confusing a specific client's contract with a general procedure.
