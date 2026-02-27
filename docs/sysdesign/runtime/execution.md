# Runtime Specification — Node Execution Functions

## LLM Agent Node

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

---

## Human Checkpoint Node

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

---

## Conditional Router Node

```python
def conditional_router_node(state: RunState, config: NodeConfig) -> str:
    """Returns the target node ID. Used with add_conditional_edges."""
    for condition in config.conditions:
        if evaluate(condition.expression, state):
            return condition.goto
    return config.default
```

---

## Tool Executor Node

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
