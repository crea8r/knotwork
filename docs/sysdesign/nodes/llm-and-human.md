# Node Types — LLM Agent & Human Checkpoint

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

### Execution Flow

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

### Confidence Signals

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

### Execution Flow

```
1. Pause run (status → paused)
2. Send notification to assigned operator(s) with context
3. Operator opens escalation in-app, reviews context fields
4. Operator responds: approve / reject / edit / provide guidance
5. Run resumes from this node with the human's response in state
6. If timeout exceeded → run status → stopped
```

### Human Response Options

- **Approve** — output is accepted as-is, run continues
- **Reject** — run stops or routes to a configured fallback node
- **Edit** — human modifies the current output, run continues with edited version
- **Provide guidance** — human writes instructions; the previous LLM Agent node retries with the guidance added to its prompt
