# Session 10 — Implementation Playbook

This document turns the S10 scope into a practical build sequence with hard boundaries so implementation stays small, coherent, and compatible with the rest of Knotwork.

Read with:

- `docs/implementation/S10/spec.md`
- `docs/implementation/S10/scope.md`

---

## Delivery Principle

Build S10 from reused primitives outward:

1. model the work container
2. reuse document and channel primitives
3. link runs into tasks
4. add the smallest useful project dashboard
5. only then extend runtime prompt loading

Do not begin with dashboard intelligence, automation, or planning features.

---

## Milestone 1 — Lock Domain Model

Outcome:

- schema and terminology are stable before UI sprawl starts

Deliverables:

- `Project` model
- `Task` model
- project-scoped document namespace
- linkage from `Task` to `Channel`
- linkage from `Task` to `Run`
- project-level status update representation

Decisions to lock:

- whether project status updates are stored as structured records or typed channel events
- whether project documents share the exact storage backend/pathing pattern used by Handbook
- whether task creation always auto-creates its channel
- whether project creation always auto-creates its project channel

Rule:

Prefer the simplest shape that reuses existing primitives, even if it is slightly less flexible.

---

## Milestone 2 — Project Shell

Outcome:

- users can see projects as first-class objects in navigation and detail views

Deliverables:

- project list page
- project create/edit flow
- project detail page shell with sections for:
  - dashboard
  - tasks
  - documents
  - project channel

UI rule:

Do not create a bespoke navigation system for projects. Fit them into the current app structure cleanly.

---

## Milestone 3 — Project Documents via Handbook Reuse

Outcome:

- project-scoped context is durable without inventing a new document system

Deliverables:

- project document CRUD
- markdown editing
- version history
- file tree/folder browsing

Implementation guidance:

- copy mechanics from Handbook only when necessary
- prefer shared abstractions/components over parallel implementations
- keep scope-based differences explicit in service/API layer rather than forking the editor experience

Failure mode to avoid:

Building "Handbook 2" with separate rules, separate editor behavior, or separate versioning semantics.

---

## Milestone 4 — Tasks as Channel-First Work Items

Outcome:

- tasks become the user-facing work atom

Deliverables:

- task CRUD inside project
- task list in project detail
- task detail view
- auto-created task channel

Behavior rules:

- every task has a channel
- a task may remain purely manual
- task detail should privilege conversation and work state, not execution internals

Failure mode to avoid:

Turning tasks into mini-projects with their own complex metadata and planning structure.

---

## Milestone 5 — Link Runs to Tasks

Outcome:

- workflow execution is visible inside task context instead of floating separately

Deliverables:

- trigger run from task
- link existing run records to task
- surface run events/output/history in task channel or task detail
- task page shows linked runs clearly

Rules:

- `Run` remains the execution object
- `Task` remains the human-facing work object
- do not invent a new "task execution" entity

Failure mode to avoid:

Duplicating run state into task-specific execution tables or bespoke execution UI.

---

## Milestone 6 — Project Dashboard

Outcome:

- the project answers "where do things stand?" without opening many pages

Deliverables:

- objective/status summary
- latest project status update
- task counts by status
- blocked tasks
- recent failed/successful runs

Implementation guidance:

- keep dashboard fixed and opinionated
- derive most data from existing models
- prefer a concise summary over completeness

Failure mode to avoid:

Building analytics infrastructure or configurable dashboard widgets.

---

## Milestone 7 — Dashboard Update Flow

Outcome:

- project state can be refreshed intentionally without building S11 early

Required deliverables:

- human can create/update a project status summary
- project dashboard shows latest update timestamp and author

Optional deliverable if cheap:

- agent can draft or post an ad hoc project summary using current agent patterns

Deferred explicitly:

- periodic autonomous updates
- persistent project intelligence agent
- objective refinement proposals
- project health scoring

Use this rule:

If the feature sounds like "the system understands how the project is going," it is probably S11.
If the feature sounds like "the system records or summarizes recent visible state," it can fit S10.

---

## Milestone 8 — Runtime Knowledge Extension

Outcome:

- task-linked runs can consume project-scoped context naturally

Deliverables:

- runtime prompt loading for:
  - Handbook
  - Project Documents
  - Run Context
- explicit prompt structure preserving separation of layers
- regression coverage ensuring project documents do not leak into workspace-wide guidance semantics

Failure mode to avoid:

Treating Project Documents as just more Handbook files and losing the semantic distinction.

---

## Suggested Build Order By Component

### Backend

Build first:

- project/task schema
- task/run linkage
- project document scope plumbing
- project status update persistence

Then:

- project/task API
- dashboard summary endpoints
- runtime knowledge loading changes

### Frontend

Build first:

- project list/detail shells
- task list/detail views
- project document views reusing Handbook UI

Then:

- dashboard summary presentation
- run linkage in task context
- status update UI

### Runtime

Build last:

- prompt extension for project documents

Reason:

The runtime change is important but should not block the work-management shell from landing first.

---

## Testing Priorities

### Must test

- project CRUD
- task CRUD
- task channel creation
- project document CRUD/history
- task without run
- task with linked run
- dashboard summary correctness for basic counts/states
- latest status update display
- runtime prompt includes all three knowledge layers for task-linked runs

### Nice to have

- ad hoc agent-authored dashboard update if implemented

### Do not let tests drag scope outward

If a test requires:

- scheduling
- planning dependencies
- complex permissions
- predictive dashboard logic

that is a signal the feature likely does not belong in S10.

---

## Cut List If S10 Starts To Bloat

If the session grows too large, cut in this order:

1. agent-authored dashboard updates
2. rich dashboard visualizations
3. document tree polish beyond reused Handbook behavior
4. run-linking conveniences beyond the core link/trigger path

Do not cut:

1. Project
2. Task
3. Project Documents
4. task channel
5. project dashboard/status surface

Those are the session.

---

## Ready-for-Review Checklist

S10 is review-ready when:

- a project can be created and used as a real work container
- project documents hold project-specific context without abusing the Handbook
- a task can be manual or run-backed without changing mental model
- the task channel is the place where work happens
- the dashboard shows current state without becoming a reporting product
- runtime can load project documents for task-linked execution
- no feature in the session requires S11 intelligence to justify its existence
