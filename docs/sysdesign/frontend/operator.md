# Frontend Specification — Operations UX (S7.2)

S7.2 unifies operations into a thread-first model: **runs and escalations are conversation artifacts with explicit decisions**.

## Inbox (Needs Action)

Inbox is the default operations surface.

Shows items requiring action across channels/runs:
- escalations
- pending handbook proposal approvals
- explicit mentions requiring response

Each row shows:
- source channel / workflow
- run + node context
- reason and urgency
- SLA/timeout badge

Tap opens the exact thread location.

---

## Run Thread

Each run is rendered as a timeline mixing:
- agent messages
- human messages
- system events (`node started`, `node completed`, `checkpoint failed`, `confidence low`)
- decision cards

Sticky run header:
- status
- current node
- ETA
- `Graph view` toggle

Graph view remains available for structural debugging; thread view remains primary for collaboration.

---

## Escalation Decisions (No Message Editing)

Escalation handling uses decision actions attached to the escalation event:

- **Accept output**: continue using agent output.
- **Override with human output**: human posts a new authoritative output message; prior agent message remains unchanged.
- **Request revision**: human posts guidance; same node retries and produces a new agent message.
- **Abort run**: stop run with reason.

Design rule: escalation resolution never mutates historical messages.

---

## Post-Run Knowledge Feedback

Knowledge nudges remain in-flow but are phrased as follow-up actions in the same thread:
- review fragment used in low-confidence decision
- approve/reject handbook suggestion
- acknowledge high-performing handbook fragments

This keeps improvement loops close to operational work.
