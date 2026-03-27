# Session 11 — Projects, Objectives, and Project Knowledge

## Goal

Make Knotwork useful as a project operating surface by putting work visibility on the same level as workflows and Handbook.

S11 makes the **Objective** the center of project experience:

- a **Project** is the container
- **Objectives** are the visible map of what the project is trying to achieve
- **Project Knowledge** keeps project-scoped files and workflows together
- **Project Channel** holds project discussion, with objective-attached channels inside it

The existing Graph/Run system remains the execution substrate underneath.

## Context

Before S11, Knotwork is strongest at:

```text
Workspace -> Handbook + Graphs -> Runs
```

That is useful for execution, but it does not yet give a human operator a strong project surface.

S11 adds:

- **Project** — the top-level work container
- **Objective** — the primary visible unit of progress inside a project
- **Project Knowledge** — project-scoped files and workflows
- **Project Channel** — project conversation with objective-attached chat

This keeps execution power intact while making work itself visible and understandable.

## In Scope

1. Project dashboard shell with three first-class views.
   - `Objectives` is the default view
   - `Handbook` shows project files and workflows
   - `Channel` shows project chat and objective-attached chat
2. Project header summary.
   - project name
   - short description
   - optional deadline
   - short current status summary authored by human or AI
3. Objective model and CRUD.
   - objective belongs to a project
   - objective supports parent/child hierarchy
   - objective supports short code, title, progress indicator, status summary, optional description, optional deadline, and optional in-charge
4. Objective tree canvas.
   - reuse the graph-style canvas interaction model
   - each node shows short code, short title, progress indicator, and short status summary
   - selecting a node recenters it and opens a large detail panel
5. Objective detail panel.
   - code
   - title
   - optional description
   - optional deadline
   - optional in-charge
   - key results
   - current status summary
   - button to open the objective channel
6. Project Knowledge view.
   - reuse the global Handbook mechanics as much as possible
   - include project-scoped files
   - include project-scoped workflows
7. Channel view.
   - one project-level chat channel
   - collapsible left-side objective tree
   - clicking an objective opens the chat attached to that objective
8. Minimal workflow scoping by `project_id`.
   - `workflow.project_id IS NULL` means reusable/global
   - `workflow.project_id IS NOT NULL` means project-scoped
   - project workflows can only spawn work into their own project
9. Human and AI status updates.
   - project-level current status may be written by a human
   - AI may draft or post ad hoc updates if cheap

## Out of Scope

- autonomous project intelligence agent
- predictive project health scoring
- schedule/check-in systems
- advanced permissions redesign
- full planning suite features such as dependencies, timelines, or sprint boards
- replacing Graphs or Runs as the execution layer
- broad workflow sharing/inheritance systems

## Core Decisions

1. **Objective is the center of the project UI.**
   - users should orient around objectives, not raw tasks or runs
   - project progress is understood through the objective map
2. **Project remains the top-level container.**
   - project header, knowledge, and channel frame the work
   - the objective map is the default lens into the project
3. **Graph/Run stays underneath.**
   - workflows remain executable graphs
   - runs remain execution records
   - objective surfaces should reuse, not replace, this layer
4. **Project Knowledge reuses Handbook patterns.**
   - same file/editor/versioning style where possible
   - different scope: project-specific rather than reusable-global
5. **Objective chat reuses channel primitives.**
   - do not build a separate thread system
   - objective-attached discussion should be implemented with existing channel mechanics
6. **Workflow scoping stays minimal.**
   - `project_id` alone determines whether a workflow is global or project-scoped
   - no separate scope enum is needed in S11

## Acceptance Criteria

1. A workspace can create, list, view, and update projects.
2. A project page has exactly three primary views: `Objectives`, `Handbook`, and `Channel`.
3. The default project view is an objective tree canvas.
4. Objectives can be created, updated, organized into a parent/child tree, and viewed on the canvas.
5. Each objective node displays a short code, short title, progress indicator, and short status summary.
6. Selecting an objective recenters the canvas and opens an objective detail panel.
7. The detail panel shows objective metadata, key results, current status summary, and a path to objective chat.
8. The project knowledge view supports project-scoped files and project-scoped workflows.
9. The project channel view supports one project chat plus objective-attached chats via the left-side objective tree.
10. Project workflows remain project-scoped via `workflow.project_id`.
11. Project workflows can only spawn work into their own project.
12. The project header always shows name, description, deadline if present, and latest project status summary.
13. The implementation reuses existing document, channel, and run primitives instead of introducing parallel systems.
