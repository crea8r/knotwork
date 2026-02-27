# Node Types — Router, Executor & Common Properties

## Conditional Router Node

Evaluates conditions against the run state and routes to the appropriate next node. No LLM, no tools — pure logic.

Use for: branching on contract type, routing by value or category, selecting paths based on previous node output.

### Configuration

| Field | Description |
|-------|-------------|
| `name` | Display name |
| `conditions` | Ordered list of condition → target node mappings |
| `default` | Target node if no condition matches |

### Condition Format

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

### Supported Condition Expressions

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

### Execution Flow

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
