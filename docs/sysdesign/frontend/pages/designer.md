# Frontend Specification — Workflow Authoring (S7.2)

S7.2 moves from strict "Designer mode" screens to a **workflow authoring surface embedded in channels**.

Workflow creation and management remain first-class capabilities. The conversational shell does not replace workflow assets; it broadens daily collaboration around them.

## Workflow Authoring Spaces

Workflows are still first-class assets, but authoring can start from two entry points:

1. **Workflow library** (`/workflows`) for deliberate process design.
2. **Workflow-backed channel** (`/channels/:id`) for ongoing refinement while operating.

Both entry points use the same building blocks: chat-based design, live canvas, node configuration panel.

---

## Design Thread (Primary Surface)

The design thread remains the primary authoring interface.

- Human messages describe process changes.
- System designer agent proposes deltas.
- Proposed graph changes are surfaced as **decision cards** (`Apply delta`, `Reject delta`, `Request revision`).
- Applied changes update the canvas and graph version.

Messages are immutable. Revisions are new messages and new decisions, never edits.

---

## Canvas and Node Configuration

Canvas remains read-only for layout with tap-to-select interaction.

- Desktop/tablet: split view (`thread` + `canvas/config`).
- Mobile: thread-first with toggle into canvas and bottom-sheet config.

Node config tabs remain:
- General
- Knowledge
- Confidence
- Checkpoints

Agent selection uses registered agents by display name and stores both `agent_ref` and `registered_agent_id`.

---

## Distillation Workflow (Ad-hoc to Structured)

S7.2 does **not** require direct "convert this conversation" automation.

Instead, workflow creation supports a practical distillation flow:

1. User opens Workflow library.
2. User selects relevant past runs/channels as references.
3. Designer agent drafts a structured workflow from repeated patterns.
4. User reviews and finalizes in the workflow editor.

This keeps workflow design a separate intentional activity while preserving evidence from real work.
