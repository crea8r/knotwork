# Node Types — Agent and Human Escalation

> **S7/S7.1 update:** Execution is unified under a single runtime node factory:
> `runtime/nodes/agent.py::make_agent_node()`.
> <span style="color:#c1121f;font-weight:700">LEGACY</span> node types (`llm_agent`, `human_checkpoint`, `conditional_router`) are still accepted
> for backward compatibility, but they run through the same agent pipeline.

---

## Unified Agent Node

The `agent` node is the only first-class execution node type in current runtime design.
Each node run is delegated to an adapter resolved from `agent_ref`:

- `anthropic:<model>` -> `ClaudeAdapter`
- `openai:<model>` -> `OpenAIAdapter`
- `human` -> `HumanAdapter`

All adapters expose the same event contract:

- `log_entry`
- `proposal`
- `escalation`
- `completed`
- `failed`

The engine persists a `RunNodeState` attempt row for each execution attempt and updates status
based on emitted events.

---

## Agent Resolution and Credentials

Runtime resolution order:

1. If node has `registered_agent_id`, load `RegisteredAgent` for the workspace.
2. If found and active, use:
   - `registered_agent.agent_ref` as effective model/provider
   - `registered_agent.api_key` as per-workspace credential
3. Otherwise, use node `agent_ref` (or <span style="color:#c1121f;font-weight:700">LEGACY</span> fallback from node type/model).

This is why API keys are now workspace data (S7.1), not only env vars.

---

## Prompt and Input Assembly

For each attempt, runtime builds prompt context from:

- Handbook files: `config.knowledge_paths` (or <span style="color:#c1121f;font-weight:700">LEGACY</span> `knowledge_files`)
- Run input: `state.input`
- Optional context files: `state.context_files`
- Prior node outputs: filtered by `config.input_sources` when set

Prompt structure is produced by `runtime/prompt_builder.py` and then extended by
`config.system_prompt` (or <span style="color:#c1121f;font-weight:700">LEGACY</span> `instructions`).

---

## Human-in-the-Loop Flow

### Escalation from Any Agent

If adapter emits `escalation`:

1. Current `RunNodeState` attempt is marked `paused`
2. Escalation record is created (`agent_question` for normal agents, `human_checkpoint` for `human` agent)
3. Runtime interrupts execution
4. Run status becomes `paused`

When operator resolves escalation, supported resolutions are:

- `accept_output`
- `request_revision`
- `override_output`
- `abort_run`

Backward-compatible aliases are accepted (`approved`, `guided`, `edited`, `aborted`) but should
not be used in new clients.

### Resume Behavior

- `accept_output` or `request_revision`: runtime re-runs the same node attempt loop, appending human guidance
  to system instructions as continuation context.
- `override_output`: human-provided output is accepted as final node output (confidence forced to 1.0).
- `abort_run`: run is stopped by escalation flow (no node resume).

This is the current "chat-like" continuation behavior for agent-human handoff.

---

## Confidence and Checkpoints

After node output is finalized (agent output or human override output), runtime applies:

- `confidence_rules`
- `checkpoints`
- `confidence_threshold` (default `0.70`)

If confidence/checkpoint rules fail:

- node status is set to `escalated`
- escalation record of type `confidence` is created
- runtime interrupts again for human review

---

## <span style="color:#c1121f;font-weight:700">LEGACY</span> Node Compatibility

<span style="color:#c1121f;font-weight:700">LEGACY</span> node types still compile through `make_agent_node()`:

- <span style="color:#c1121f;font-weight:700">LEGACY</span> `llm_agent` -> provider inferred from <span style="color:#c1121f;font-weight:700">LEGACY</span> `config.model` or workspace default model
- <span style="color:#c1121f;font-weight:700">LEGACY</span> `human_checkpoint` -> forced `agent_ref = "human"`
- <span style="color:#c1121f;font-weight:700">LEGACY</span> `conditional_router` -> treated as a normal agent node

<span style="color:#c1121f;font-weight:700">LEGACY</span> `tool_executor` is removed. Any graph containing it raises `RuntimeError` at compile time.

---

## Runtime Output Contract

A successful node execution returns state updates:

- `current_output`: final text for this step
- `node_outputs[node_id]`: persisted node text output
- `next_branch`: optional routing hint for multi-edge transitions
- `messages`: assistant message entries for run timeline/chat UI

`next_branch` is consumed by engine conditional edge routing when a node has multiple outgoing edges.
