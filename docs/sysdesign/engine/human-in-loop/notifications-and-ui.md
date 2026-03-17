# Human-in-the-Loop — Notifications & UI

## Notification Channels

When an escalation is created, notifications are sent through configured channels. Each workspace and each operator can configure their preferred channels.

### In-app (always on)

Every escalation appears in the operator's **Inbox** and links into the exact run thread location. This is the primary surface for reviewing details and responding.

The in-app notification includes:
- Which channel/workflow and run triggered the escalation
- Which node and why (low confidence, checkpoint name, human checkpoint)
- A summary of the node's output
- The confidence score (if applicable)
- The relevant run state context

### Email

A notification email with:
- Subject: `[Knotwork] Action required — {workflow name} / {node name}`
- Summary of the escalation
- Direct link to the in-app thread location

Email is not designed for responding. Complex responses require in-app decision actions.

### Telegram

A Telegram bot sends a message to the operator's linked Telegram account or a configured group. The message includes the escalation summary and a deep link to the in-app thread location.

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

## Escalation in Thread

Escalation is presented as a high-attention event card in the run thread.

### Layout

```
┌─────────────────────────────────────┐
│  Escalation · Financial Analysis    │
│  Reason: Confidence 0.42 < 0.70     │
│  SLA: 23h left                      │
│                                     │
│  Agent output                       │
│  "The contract value is VND 45B..."│
│                                     │
│  Context                            │
│  contract_type: purchase            │
│  counterparty: Acme Corp            │
│                                     │
│  [ Accept output ]                  │
│  [ Override with human output ]     │
│  [ Request revision ]               │
│  [ Abort run ]                      │
└─────────────────────────────────────┘
```

### Decision Actions

**Accept output**
- Keeps the agent output as-is.
- Run continues.

**Override with human output**
- Human posts a new authoritative output message.
- Run continues with this new output.
- Agent message stays unchanged in history.

**Request revision**
- Human provides guidance text.
- Current node retries with guidance appended to node context.
- Retry result appears as a new agent message.

**Abort run**
- Run is stopped with reason.
- Owner is notified.

---

## Immutability Rule

Messages are immutable for both humans and agents.

Knotwork keeps separate logs:
- **Message log**: who said what
- **Decision log**: what action changed run state

This preserves auditability and avoids rewriting historical outputs.

---

## Timeout

Every escalation has a timeout. Configured per node.

If the operator does not respond within the timeout:
- Run status → `stopped`
- A notification is sent to the graph/workflow owner
- The escalation remains open and visible in inbox

A stopped run can be manually resumed by an owner.

Default timeouts:
- Human Checkpoint node: 48 hours
- Confidence escalation: 24 hours
- Checkpoint failure escalation: 24 hours

These are configurable per node and per workspace.

---

## Rating

After a node completes, operators and owners can rate the output.

A 1–5 star rating with optional comment. Ratings are attached to `RunNodeState` and linked to the knowledge snapshot used in that run.

Low-rated nodes appear in a **Needs Attention** list in the Handbook.
