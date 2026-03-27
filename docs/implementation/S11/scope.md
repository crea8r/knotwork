# Session 11 — Concrete Scope

This document narrows S11 into the smallest coherent slice of an objective-centered project dashboard.

S11 should make projects feel visible and operable in the same product surface as workflows and Handbook, without turning into a full planning suite or a separate chat product.

Read with:

- `docs/implementation/S11/spec.md`
- `docs/implementation/roadmap.md`

---

## North Star

By the end of S11:

- a project has a clear dashboard shell with three views:
  - `Objectives`
  - `Handbook`
  - `Channel`
- the default view is an objective tree canvas
- objectives are the main visible unit of project progress
- project knowledge reuses Handbook mechanics
- project and objective discussion reuse channel mechanics
- workflow scoping remains minimal through `workflow.project_id`

---

## Product Shape

### Project

The project is the top-level work container and dashboard shell.

Required fields:

- `title`
- short description / project brief
- `status`
- optional `deadline`
- timestamps

Required relationships:

- `objectives[]`
- project-scoped files
- project-scoped workflows
- one `project_channel`
- one current project status summary

### Objective

An objective is the visible center of the project dashboard.

Required fields:

- `code` (max 5 chars in UI)
- `title`
- optional `description`
- `status`
- progress indicator
- short status summary
- optional `deadline`
- optional in-charge
- optional parent objective
- timestamps

Required relationships:

- belongs to one project
- may have child objectives
- one objective-attached channel
- zero or more linked runs beneath it through reused execution plumbing

Key rule:

Do not turn Objective into a second workflow system. It is a progress and coordination object.

### Objective Tree Canvas

The objective canvas is the default project view.

It must:

- reuse the graph-style canvas interaction model
- show objective nodes in a parent/child tree
- allow select-to-center behavior
- open a detail panel on selection

Each objective node must show:

- short code
- title truncated to roughly 30 chars
- progress indicator
- short status summary

### Objective Detail Panel

The detail panel is the main operational surface for one objective.

It must show:

- code and title
- optional description
- optional deadline
- optional in-charge
- key results
- current status summary
- entry point to objective chat

It may also show:

- linked runs
- recent activity

### Project Knowledge

This view should mimic the Handbook mechanics as closely as possible.

It should contain:

- project-scoped files
- project-scoped workflows

It should reuse:

- markdown editor
- file tree
- version history and storage patterns where available

Only the scope changes:

- global Handbook = reusable cross-project guidance and workflows
- project knowledge = project-specific context and workflows

### Channel View

The channel view is the communication surface for the project.

It must contain:

- the project chat as the main panel
- a collapsible left-side objective tree
- click-through from objective tree to objective-attached chat

Implementation rule:

Reuse channel primitives. Do not build a second thread model.

---

## Reuse Rules

### Reuse directly

- existing `Project` container model
- existing task/channel plumbing as the backing store for objective chat if it reduces duplication
- existing graph canvas interaction model
- existing channel message and decision UI primitives
- existing Handbook editor and file-tree patterns
- existing `Graph` and `Run` execution model

### Reuse conceptually

- objective status should feel like project progress reporting, not task ticketing
- objective-attached channel should behave like a focused thread inside project chat
- project knowledge should feel like a project-scoped Handbook, not a new file product

### Do not duplicate

- do not build a separate thread system beside channels
- do not build a separate document or versioning system beside Handbook storage patterns
- do not build a second execution model beside Graph/Run
- do not build a second canvas engine beside the existing graph canvas

---

## Must Build

1. Project shell with exactly three views:
   - `Objectives`
   - `Handbook`
   - `Channel`
2. Project header:
   - title
   - short description
   - deadline if present
   - latest project status summary
3. Objective CRUD inside a project.
4. Objective tree support with parent/child linkage.
5. Objective canvas view using reused graph-style interactions.
6. Objective detail panel with metadata, key results, status summary, and objective-chat entry point.
7. Project knowledge view with:
   - project-scoped files
   - project-scoped workflows
8. Channel view with:
   - project chat
   - collapsible objective tree
   - objective-specific chat switching
9. Minimal workflow scoping:
   - `workflow.project_id IS NULL` => global
   - `workflow.project_id IS NOT NULL` => project-scoped
10. Human-authored project status updates in the project header or dashboard.

---

## Explicit Anti-Scope

### Do not build a planning suite

- no dependency graph management
- no sprint board
- no timeline or Gantt features
- no check-in or recurrence engine

### Do not build broad project intelligence

- no always-on autonomous project agent
- no predictive health scoring
- no objective refinement engine
- no automated project governance layer

### Do not build a new permissions system

- no per-objective ACL
- no per-project sharing matrix
- no workflow scope model beyond nullable `project_id`

### Do not turn objectives into tasks-plus-plus

- no subtype explosion
- no complex assignment system
- no planning metadata that outgrows the dashboard use case

### Do not replace Graph/Run

- objectives are for progress and coordination
- workflows remain executable graphs
- runs remain execution detail

---

## UX Boundary

The user should be able to understand S11 with one mental model:

```text
Project
  -> Objectives (what this project is trying to achieve)
  -> Handbook (files + workflows for this project)
  -> Channel (project chat + objective-attached chat)

Objective
  -> status and key results
  -> attached chat
  -> optional linked execution underneath
```

If a feature cannot be explained inside that model, it probably does not belong in S11.
