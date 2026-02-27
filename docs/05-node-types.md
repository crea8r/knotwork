# Node Types

Every node in a graph has a type. The type determines how the node executes, what configuration it accepts, and how it interacts with the run state.

---

## LLM Agent Node

The core node type. Calls an LLM with knowledge, run state, and tools to produce a structured output.

### Configuration

| Field | Description |
|-------|-------------|
| `name` | Display name on the canvas |
| `knowledge` | One or more knowledge fragment paths to load |
| `model` | LLM provider and model (overrides graph default) |
| `tools` | List of tools from the tool registry |
| `output_schema` | JSON schema defining the expected output structure |
| `confidence_field` | Field in the output the LLM uses to report confidence (0–1) |
| `confidence_threshold` | Minimum confidence to proceed without escalation |
| `confidence_rules` | Rule-based signals that override or adjust the confidence score |
| `checkpoints` | List of validation rules applied to the output |
| `fail_safe` | Action on checkpoint failure: `retry`, `escalate`, `skip`, or a specific node ID to route to |
| `retry_limit` | Number of retries before escalating (default: 2) |
| `input_mapping` | Which state fields this node receives |
| `output_mapping` | Which state fields this node writes |

### Execution flow

```
1. Load knowledge tree (fetch all linked .md files)
2. Check token count → flag if outside range
3. Build prompt: system (knowledge) + user (state + task)
4. Call LLM with tools available
5. Parse structured output
6. Evaluate confidence_rules → compute final confidence score
7. Run checkpoints against output
8. If checkpoint fails → apply fail_safe
9. If confidence < threshold → escalate
10. Write output to run state
11. Persist RunNodeState
```

### Confidence signals

The LLM is instructed to include a confidence field in its structured output. Additionally, configurable rules can override this:

```yaml
confidence_rules:
  - if: "output.contains('I am not sure')"
    set: 0.2
  - if: "output.contract_value > 1000000 and output.legal_review == null"
    set: 0.3
```

The final confidence score is `min(structured_confidence, all matching rule values)`.

---

## Human Checkpoint Node

A node that always pauses the run and requires a human to act. There is no LLM involved. This is a **designed** step in the workflow, not a fallback.

Use for: required approvals, sign-offs, quality gates that must always have human eyes.

### Configuration

| Field | Description |
|-------|-------------|
| `name` | Display name |
| `prompt` | Instructions shown to the human (what to review, what to decide) |
| `context_fields` | Which state fields to display to the human |
| `response_type` | `approve_reject`, `choice`, or `freetext` |
| `choices` | If response_type is `choice`: list of options (each maps to a different next node) |
| `timeout` | Duration to wait for response. If exceeded, run status → `stopped`. |
| `notify` | Notification channels: `in_app`, `email`, `telegram`, `whatsapp` |

### Execution flow

```
1. Pause run (status → paused)
2. Send notification to assigned operator(s) with context
3. Operator opens escalation in-app, reviews context fields
4. Operator responds: approve / reject / edit / provide guidance
5. Run resumes from this node with the human's response in state
6. If timeout exceeded → run status → stopped
```

### Human response options

- **Approve** — output is accepted as-is, run continues
- **Reject** — run stops or routes to a configured fallback node
- **Edit** — human modifies the current output, run continues with edited version
- **Provide guidance** — human writes instructions; the previous LLM Agent node retries with the guidance added to its prompt

---

## Conditional Router Node

Evaluates conditions against the run state and routes to the appropriate next node. No LLM, no tools — pure logic.

Use for: branching on contract type, routing by value or category, selecting paths based on previous node output.

### Configuration

| Field | Description |
|-------|-------------|
| `name` | Display name |
| `conditions` | Ordered list of condition → target node mappings |
| `default` | Target node if no condition matches |

### Condition format

```yaml
conditions:
  - if: "state.contract_type == 'purchase'"
    goto: purchase-review-node
  - if: "state.contract_type == 'construction'"
    goto: construction-review-node
  - if: "state.contract_value > 5000000"
    goto: high-value-escalation-node
default: standard-review-node
```

Conditions are evaluated in order. The first match wins.

### Supported condition expressions

- Equality: `==`, `!=`
- Comparison: `>`, `<`, `>=`, `<=`
- Containment: `in`, `not in`
- Boolean: `and`, `or`, `not`
- String: `.contains()`, `.startsWith()`, `.endsWith()`
- Null checks: `is null`, `is not null`

---

## Tool Executor Node

Runs a tool directly without LLM reasoning. Used for deterministic operations where the logic is fully known.

Use for: fetching external data, transforming a document, calling an API, computing a value, looking up a record.

### Configuration

| Field | Description |
|-------|-------------|
| `name` | Display name |
| `tool` | Tool ID from the tool registry |
| `input_mapping` | Map state fields to tool input parameters |
| `output_mapping` | Map tool output to state fields |
| `error_handling` | What to do on tool failure: `retry`, `escalate`, `skip` |

### Execution flow

```
1. Map state fields to tool inputs
2. Invoke tool
3. Map tool output to state fields
4. On error: apply error_handling
```

Tool Executor nodes are fast and cheap — no LLM call. Use them generously to offload known logic from LLM Agent nodes.

---

## Sub-graph Node *(Phase 2)*

Invokes another Knotwork graph as a nested workflow and waits for its result.

### Configuration

| Field | Description |
|-------|-------------|
| `name` | Display name |
| `graph_id` | The graph to invoke |
| `input_mapping` | State fields to pass as the sub-graph's input |
| `output_mapping` | Sub-graph output fields to write to parent state |
| `timeout` | Max time to wait for sub-graph completion |

The sub-graph runs as a full, independent run. Its state, logs, and knowledge snapshots are all recorded separately and linked to the parent run.

---

## Common Node Properties

All node types share these properties:

| Property | Description |
|----------|-------------|
| `id` | Unique identifier within the graph |
| `type` | Node type |
| `position` | Canvas position `{x, y}` |
| `note` | Optional designer note (visible on canvas, not used in execution) |
| `tags` | Optional labels for filtering and organisation |

---

## Node Status in a Run

During a run, every node has a status:

| Status | Meaning |
|--------|---------|
| `pending` | Not yet reached |
| `running` | Currently executing |
| `paused` | Waiting for human (checkpoint or escalation) |
| `completed` | Successfully finished |
| `failed` | Errored or exhausted retries |
| `skipped` | Bypassed by a conditional route |

The canvas in the operator view displays these statuses live during a run.
