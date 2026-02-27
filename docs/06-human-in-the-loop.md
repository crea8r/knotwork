# Human-in-the-Loop

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

---

## Notification Channels

When an escalation is created, notifications are sent through configured channels. Each workspace and each operator can configure their preferred channels.

### In-app (always on)

Every escalation appears in the operator's **Escalation Inbox** in the web app. This is the primary surface for reviewing details and responding.

The in-app notification includes:
- Which graph and run triggered the escalation
- Which node and why (low confidence, checkpoint name, human checkpoint)
- A summary of the node's output
- The confidence score (if applicable)
- The relevant run state context

### Email

A notification email with:
- Subject: `[Knotwork] Action required — {graph name} / {node name}`
- Summary of the escalation
- Direct link to the in-app escalation screen

Email is not designed for responding — it links back to the app. This is intentional: editing outputs and providing guidance requires a proper UI.

### Telegram

A Telegram bot sends a message to the operator's linked Telegram account or a configured group. The message includes the escalation summary and a deep link to the in-app screen.

Phase 1: notification only (link back to app to respond).
Phase 2: respond directly from Telegram via bot commands.

### WhatsApp

Same as Telegram — notification with a deep link. Direct response from WhatsApp in Phase 2.

### Configuration

Per operator, per workspace:

```yaml
notifications:
  escalation:
    channels: [in_app, telegram, whatsapp]
    telegram_chat_id: "123456789"
    whatsapp_number: "+84901234567"
  digest:
    channels: [email]
    frequency: daily
    time: "08:00"
    timezone: "Asia/Ho_Chi_Minh"
```

---

## In-App Escalation Screen

The escalation screen is designed to work on a phone or tablet. Operators do not need to be at a computer.

### Layout

```
┌─────────────────────────────────────┐
│  ← Back          Escalation         │
│                                     │
│  Contract Review Run                │
│  Node: Financial Analysis           │
│  Reason: Confidence 0.42 < 0.70     │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ Agent Output                │    │
│  │                             │    │
│  │ "The contract value is      │    │
│  │ VND 45B. IRR appears low    │    │
│  │ but I could not verify the  │    │
│  │ depreciation schedule..."   │    │
│  │                             │    │
│  │ Confidence: 42%  ⚠️          │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ Context                     │    │
│  │ contract_type: purchase     │    │
│  │ contract_value: 45,000,000  │    │
│  │ counterparty: Acme Corp     │    │
│  └─────────────────────────────┘    │
│                                     │
│  [ Approve ]  [ Edit ]  [ Guide ]  │
│              [ Abort  ]             │
└─────────────────────────────────────┘
```

### Response options

**Approve**
Accept the agent's output as-is. The run continues to the next node.

**Edit**
Open the output in an editable view. The operator modifies it directly. On save, the run continues with the edited output. The edit is logged in the audit trail.

**Guide**
A text field appears. The operator writes instructions (e.g. "Check the depreciation schedule in Appendix B — the IRR calculation must include it"). The current node retries with the guidance appended to its prompt. Retry count is reset.

**Abort**
The run is stopped. The operator can add a reason. The graph owner is notified.

---

## Timeout

Every escalation has a timeout. Configured per node (Human Checkpoint and LLM Agent nodes separately).

If the operator does not respond within the timeout:
- Run status → `stopped`
- A notification is sent to the graph owner
- The escalation remains open and visible in the inbox

A stopped run can be **manually resumed** by an owner. When resumed, the operator is prompted to respond to the pending escalation before the run continues.

Default timeouts:
- Human Checkpoint node: 48 hours
- Confidence escalation: 24 hours
- Checkpoint failure escalation: 24 hours

These are configurable per node and per workspace.

---

## Rating

After a node completes (whether or not there was an escalation), operators and owners can rate the output.

### Rating interface

A 1–5 star rating with an optional text comment. Available:
- On the node in the run inspection view
- In the escalation screen after responding
- In the operator dashboard's recent runs list

### What ratings do

Ratings are attached to the `RunNodeState` record and linked to the knowledge snapshot used in that run.

Low-rated nodes appear in a **Needs Attention** list in the knowledge editor, grouped by fragment. This is the entry point for the knowledge improvement loop (see [Knowledge System](./04-knowledge-system.md)).

---

## Designing for Human Oversight

Best practices for graph designers:

1. **Place Human Checkpoint nodes at natural approval boundaries.** In a contract review: after initial analysis, before any recommendation is sent externally.

2. **Set confidence thresholds that reflect domain risk.** High-value decisions (asset purchases) warrant higher thresholds (0.85+). Routine summaries can be lower (0.60).

3. **Write clear Human Checkpoint prompts.** The operator should understand exactly what they are approving and what criteria to apply. This text is part of the workflow's knowledge — put it in a knowledge fragment and link it.

4. **Configure meaningful fail-safes.** For most nodes: `retry: 2, then escalate`. For low-risk nodes: `skip` may be acceptable.

5. **Use the escalation inbox as a signal.** A node that escalates frequently is telling you the knowledge is insufficient or the confidence threshold is miscalibrated. Both are fixable.
