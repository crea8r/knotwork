# Human-in-the-Loop — Escalation

## Overview

Human involvement in Knotwork is not an exception — it is a designed part of every workflow. There are two distinct mechanisms:

| Mechanism | When | Who decides |
|-----------|------|-------------|
| **Human Checkpoint** | Always — it is a node in the graph | The graph designer |
| **Confidence Escalation** | When the agent is not sure enough | The agent, based on configured thresholds |

Both result in the same experience for the operator: a notification, an in-app review screen, and a set of response options. The difference is in intent — one is a planned gate, the other is a safety net.

---

## Escalation Triggers

### 1. Low confidence

An LLM Agent node computes a confidence score from two sources:
- Structured output field (the LLM self-reports)
- Rule-based signals (configured per node)

If the final score is below the node's `confidence_threshold`, the run pauses and an escalation is created.

### 2. Checkpoint failure

After a node produces output, its checkpoints are evaluated in order. If a checkpoint fails:
1. Apply the node's `fail_safe` action if configured
2. Otherwise retry (up to `retry_limit`)
3. If retries exhausted → escalate

### 3. Human Checkpoint node

The run reaches a Human Checkpoint node in the graph. The run pauses unconditionally. No confidence or checkpoint evaluation — this step always requires a human.

### 4. Node error

An unexpected error (tool failure, LLM API error, parse error) that cannot be recovered by the retry policy → escalate.

---

## Escalation Lifecycle

```
Trigger event
     │
     ▼
Create Escalation record (status: open)
     │
     ▼
Notify assigned operator(s)
     │
     ▼
Operator opens escalation in-app
     │
     ├── Approve     → resume run with current output
     ├── Edit        → operator modifies output → resume
     ├── Guide       → operator writes instructions → node retries
     └── Abort       → run status → stopped
     │
     ▼
If timeout exceeded with no response → run status → stopped
```
