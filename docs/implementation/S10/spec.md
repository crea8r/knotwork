# Session 10 — Projects, Tasks, and Project Documents

## Goal

Add the missing work-management layer above Graphs and Runs so Knotwork can track objectives, organize work into tasks, and carry project-scoped context across executions.

## Context

Before S10, Knotwork's main hierarchy is:

```text
Workspace -> Graphs -> Runs
```

That is an execution model, not a work model. Graphs are reusable process templates, and Runs are single executions, but neither is the thing a human operator is actually trying to advance.

S10 introduces:

- **Project** — the objective-scoped work container
- **Task** — the user-facing unit of work inside a Project
- **ProjectDocument** — the project-scoped knowledge layer shared across tasks and runs

These concepts shift Knotwork from "workflow runner" toward "operating system for work" while preserving the existing Graph/Run execution model underneath.

## In Scope

1. Project model and CRUD.
   - `Project` has objective, optional deadline, status, and workspace ownership
   - project list and project detail views exist in the UI
   - project dashboard surfaces task progress, run outcomes, and visible roadblocks
2. Task model and CRUD.
   - `Task` belongs to a project
   - task has name, description, status, and optional linkage to runs
   - tasks are the primary work items humans track day to day
3. Project chat.
   - every project has one shared project-scoped channel
   - all workspace members can read/post in Phase 1
   - project-level discussion is distinct from task/run execution detail
4. Task-linked channel.
   - every task has a channel for work discussion and execution history
   - runs triggered from a task appear in the task channel
   - escalations, outputs, and decisions remain visible in the task context
5. Project Documents as the third knowledge layer.
   - project-scoped documents persist across all tasks/runs in the project
   - intended for brief, decisions, stakeholder notes, and project-specific research
   - not a replacement for Handbook or run-scoped input
6. Three-layer runtime knowledge loading.
   - agent runs load `Handbook + Project Documents + Run Context`
   - prompt structure keeps "how to work", "what this project is about", and "what this run is about" separate
7. Human-only validity.
   - the product remains fully useful without AI
   - tasks can be managed manually without triggering a run
   - agent-less execution paths continue routing to humans rather than failing

## Out of Scope

- S11 qualitative project intelligence and synthesized progress assessment.
- Phase 2 permission scoping for channels.
- Advanced roles beyond current Phase 1 model.
- Scheduled/cron task execution.
- Sub-graphs, auto-improvement loops, and other roadmap items outside S10.
- Replacing Graphs/Runs as the execution model; S10 adds a work layer above them.

## Core Decisions

1. **Project is the human-facing container; Graph is not.**
   - Graphs stay reusable templates.
   - Projects are the concrete pursuits humans are advancing.
2. **Task is the user-facing work atom; Run is execution detail.**
   - Humans track task status, not raw runs.
   - A task may trigger zero or more runs over time.
3. **Project Documents are their own knowledge layer.**
   - Handbook = reusable guidance
   - Project Documents = project memory/context
   - Run Context = case-specific input for this execution
4. **Project/task chat is first-class.**
   - discussion should not be trapped only inside run detail
   - project and task channels become the collaboration shell around execution
5. **No-AI mode remains first-class.**
   - S10 must improve the product even for teams running human-only work

## Acceptance Criteria

1. A workspace can create, list, view, update, and archive or otherwise close Projects.
2. A project stores at least objective, deadline, and status, and appears in a project list UI.
3. A project detail page shows its tasks, key run outcomes, and visible blocked/failed work.
4. A workspace can create, list, view, update, and complete Tasks within a Project.
5. A task stores at least name, description, and status, and is clearly represented as the primary work item in the UI.
6. Every project has a shared project channel visible to workspace members.
7. Every task has a task-linked channel where task discussion and execution history are visible together.
8. A run can be triggered from a task and remains linked back to that task.
9. A task can exist without any run and still be fully usable as a human-managed work item.
10. Project Documents can be created, edited, listed, and read at project scope.
11. Project Documents are clearly separated from Handbook files and from run-scoped context.
12. Agent execution triggered from a task loads all three knowledge layers: Handbook, Project Documents, and Run Context.
13. Prompt structure preserves the distinction between reusable guidance, project context, and case-specific input.
14. Tasks without AI support remain operable through human workflow rather than producing configuration failure.
15. S10 makes progress toward product usefulness as a work-management system, not only as a workflow executor.
