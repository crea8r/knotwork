# Session 11 — Concrete Scope

This document narrows S10 into the smallest coherent product slice that makes work visible in the same interface as workflows and the Handbook without bloating the session into planning software, analytics, or S11 intelligence.

Read with:

- `docs/implementation/S10/spec.md`
- `docs/implementation/roadmap.md`
- `docs/sysdesign/concepts/project.md`
- `docs/sysdesign/concepts/workflow.md`

---

## North Star

By the end of S11:

- work is visible as **Projects** and **Tasks** in the product, not only as workflows and runs
- project context is durable and easy to update through **Project Documents**
- task work happens in a **task channel** that can be free chat or include linked runs
- every project has a concise **dashboard/status surface**
- S11 reuses existing Knotwork concepts wherever possible instead of inventing new subsystems

---

## Product Shape

### Project

The project is the human-facing work container.

Required fields:

- `title`
- `objective`
- `status` (`open`, `in_progress`, `blocked`, `done`)
- optional `deadline`
- timestamps

Required relationships:

- `documents[]`
- `tasks[]`
- one `project_channel`
- one current dashboard/status summary

### Project Document

A Project Document is project-scoped durable context.

It should reuse the Handbook model wherever possible:

- markdown file
- folder/tree organization
- version history
- same editor shell
- same storage adapter pattern

Only the scope changes:

- Handbook = workspace-scoped reusable guidance
- Project Documents = project-scoped context for this pursuit

### Task

A task is the work atom.

Required fields:

- `title`
- optional `description`
- `status` (`open`, `in_progress`, `blocked`, `done`)
- `project_id`
- timestamps

Required relationships:

- one `task_channel`
- zero or more linked `runs`

Task modes are intentionally minimal:

- **manual/free-chat task** — task channel exists without any run
- **run-backed task** — task channel exists and one or more runs are linked into it

Do not create separate task types beyond this in S10.

### Project Dashboard

The dashboard is a fixed opinionated summary, not a reporting framework.

It must show:

- project objective and status
- latest dashboard/status update
- task counts by status
- recent runs linked to tasks
- blocked tasks and failed runs surfaced clearly

It may also show:

- deadline proximity
- last activity time

It must not become a configurable widget system in S10.

### Dashboard Update

S10 should support a lightweight project update mechanism.

Required:

- a human can post/update a structured project status update
- the latest update is visible on the project dashboard

Allowed if cheap:

- an agent can draft or post an ad hoc project update using existing agent patterns

Deferred:

- periodic autonomous project assessment
- predictive progress scoring
- project meta-agent intelligence

Those belong to S11, not S10.

---

## Reuse Rules

S10 should be built as a composition layer over existing concepts.

### Reuse directly

- **StorageAdapter and versioning** for Project Documents
- **markdown editor and file-tree UI** from Handbook
- **channel model** for project chat and task chat
- **run model** for any execution linked to a task
- **existing agent/escalation patterns** for optional dashboard update drafting

### Reuse conceptually

- project dashboard should feel like an opinionated summary page, not a new tool category
- task channel should use the same chat/event primitives already used elsewhere
- linked runs should appear as task events rather than creating a new run presentation model

### Do not duplicate

- do not build a second document system beside Handbook
- do not build a second chat stack for tasks
- do not build a second execution abstraction beside Run

---

## Must Build

These are the smallest required deliverables for S10 to satisfy the intended product shift.

1. Project CRUD and navigation.
2. Project detail page with:
   - dashboard/status summary
   - documents entry point
   - tasks list
   - project channel
3. Project Documents CRUD using Handbook-like mechanics.
4. Task CRUD inside a project.
5. Task detail/channel view.
6. Ability for a task to exist without any run.
7. Ability to trigger or link a run from a task.
8. Run visibility from the task channel.
9. Human-authored project status update visible on dashboard.
10. Runtime prompt extension to load `Handbook + Project Documents + Run Context` for task-linked runs.

---

## Explicit Anti-Scope

These are tempting, but they should be cut from S10.

### Do not build a planning suite

- no dependencies
- no milestones/epics hierarchy
- no sprint planner
- no Gantt/timeline planning
- no recurrence engine

### Do not build a new permissions system

- no per-project ACL
- no per-task visibility rules
- no channel-scoped permission matrix

Phase 1 remains workspace-visible.

### Do not build a dashboard platform

- no configurable widgets
- no custom metrics builder
- no scorecard designer
- no analytics schema beyond what the page needs

### Do not build S11 early

- no autonomous periodic project intelligence engine
- no synthesized project health scoring as a core dependency
- no forward-looking project assessment model
- no objective refinement workflow

### Do not explode the task model

- no bug/task/request/note subtypes
- no multi-assignee system unless already trivial in current model
- no separate "AI task" vs "manual task" entities

### Do not replace Graph/Run

- project is the work container
- task is the work atom
- run remains execution detail

S11 adds a top layer; it does not rewrite the lower layer.

---

## UX Boundary

The user should be able to understand S10 with one mental model:

```text
Project
  -> Documents (what this project is about)
  -> Tasks (what work exists)
  -> Channel (project discussion)
  -> Dashboard (where things stand)

Task
  -> Channel (discussion + execution history)
  -> Optional Runs (structured execution when needed)
```

If a proposed feature cannot be explained inside that model, it probably does not belong in S10.

---

## Release Test

S10 is correctly scoped if all of the following are true:

- a human can manage meaningful work in Knotwork without leaving the app
- project context is durable without abusing the Handbook for project-specific notes
- a task can be purely human/manual or can invoke workflow execution
- the project dashboard answers "where does this project stand?" in under a minute
- no new subsystem was introduced where an existing Knotwork concept would have worked

If S10 requires new planning abstractions, a new analytics framework, or a new intelligence engine to feel complete, the scope is too large.
