# Session 11 — Implementation Playbook

This document turns the S11 scope into a practical build sequence for an objective-centered project dashboard.

Read with:

- `docs/implementation/S11/spec.md`
- `docs/implementation/S11/scope.md`

---

## Delivery Principle

Build S11 by reusing existing Knotwork primitives and changing the project surface before changing deeper runtime behavior:

1. lock the objective-centered model
2. add only the minimum objective metadata needed in storage
3. reuse the graph canvas for objective navigation
4. reuse Handbook mechanics for project knowledge
5. reuse channel mechanics for project and objective conversation
6. keep workflow scoping minimal through nullable `project_id`

Do not begin with intelligence features, broad planning features, or a new permissions model.

---

## Milestone 1 — Lock Domain Model

Outcome:

- the product speaks consistently about `Project`, `Objective`, `Project Knowledge`, and `Project Channel`

Deliverables:

- stable `Project` model
- objective model and tree relationship
- project status summary representation
- project-scoped file namespace
- project-scoped workflow rule via `workflow.project_id`
- objective-attached channel rule

Decisions to lock:

- whether objective storage reuses the current task table/model underneath
- whether objective key results are stored as structured text or a small JSON list
- whether objective channel is implemented as the existing task channel
- whether project status remains a structured update record

Rule:

Prefer reuse of the current task and channel substrate if it keeps the product model clean.

---

## Milestone 2 — Minimal Schema Extension

Outcome:

- current storage can represent objective hierarchy and summary data without a parallel model

Deliverables:

- parent linkage for objectives
- short code field
- progress value
- short status summary
- key results payload
- optional in-charge fields

Rules:

- store only what the objective dashboard requires
- avoid schema for advanced planning, staffing, or analytics
- keep workflow scoping as nullable `project_id`, not a separate scope enum

Failure modes to avoid:

- inventing a second objective table when the current task substrate can be extended cleanly
- creating both `scope` and `project_id` for workflows
- storing objective data in ad hoc channel metadata instead of a stable model

---

## Milestone 3 — Project Shell

Outcome:

- users land on a stable three-view project dashboard

Deliverables:

- project header
- three-tab project shell:
  - `Objectives`
  - `Handbook`
  - `Channel`
- default route or state opens `Objectives`

UI rule:

The project page should feel like a hub of focused surfaces, not one long mixed dashboard.

---

## Milestone 4 — Objective Canvas

Outcome:

- project progress is visible as a navigable objective tree

Deliverables:

- canvas adapter from objective data to graph-style nodes and edges
- node rendering for code, title, progress, and short status summary
- select-to-center interaction
- objective detail panel over the canvas

Implementation guidance:

- reuse the existing canvas engine and navigation mechanics
- objective tree is not a workflow graph; only the interaction model should be shared
- keep node content compact and scannable

Failure mode to avoid:

Turning the objective canvas into a second workflow editor.

---

## Milestone 5 — Project Knowledge via Handbook Reuse

Outcome:

- project-scoped files and workflows live in a familiar surface

Deliverables:

- project file tree and markdown editing
- project workflow list and create flow
- clear distinction from the global Handbook

Rules:

- global workflow = `project_id IS NULL`
- project workflow = `project_id IS NOT NULL`
- project workflow may only spawn work into its own project

Failure modes to avoid:

- building a second editor experience
- letting project workflows feel reusable outside their project by accident

---

## Milestone 6 — Channel View

Outcome:

- the project has one communication surface with focused objective chat inside it

Deliverables:

- project channel main panel
- collapsible objective tree sidebar
- objective chat switching
- objective detail entry point to open its chat

Rules:

- objective chat should reuse existing channels
- avoid creating a separate threads implementation
- keep the distinction between project-wide chat and objective-specific chat visible in the UI

Failure mode to avoid:

Collapsing project chat and objective chat into one undifferentiated stream.

---

## Milestone 7 — Project Status

Outcome:

- the project header and dashboard answer "where are we now?"

Deliverables:

- latest project status summary in header
- human-authored update flow
- optional AI-authored or AI-drafted update flow if cheap

Rules:

- status summaries should be concise
- AI may assist, but project truth should not depend on autonomous intelligence in S11

Failure mode to avoid:

Building a standing project intelligence subsystem.

---

## Suggested Build Order By Component

### Backend

Build first:

- objective schema extensions on the current project/task substrate
- objective tree and query support
- project dashboard payload aligned to objective view
- workflow `project_id` invariants

Then:

- project knowledge endpoint refinements
- objective-focused channel helpers
- optional AI status helper hooks

### Frontend

Build first:

- project shell
- objective canvas and detail panel
- project header

Then:

- handbook view reuse
- channel view with objective tree sidebar
- objective create and edit flows

### Runtime

Keep unchanged unless needed for existing project document loading or run linkage.

Reason:

S11 is mainly a product-surface and data-model session, not a runtime redesign.

---

## Testing Priorities

### Must test

- project loads into the `Objectives` view by default
- objective tree renders and selection recenters correctly
- objective detail panel reflects the selected node
- project handbook view shows only project-scoped files and workflows
- channel view switches cleanly between project chat and objective chat
- project workflow with `project_id` set cannot spawn work into another project

### Nice to test

- AI-authored status summary flow
- canvas behavior with larger objective trees
- moving between objective panel and objective chat smoothly

---

## Cut Rule

When deciding whether to include a feature, ask:

"Does this make the objective-centered project surface clearer by reusing what Knotwork already has?"

If not, cut it from S11.
