# Core Concepts — Projects, Tasks, and Project Documents

Added in S10. These concepts sit above the Graph/Run layer and give Knotwork its work management surface.

---

## Why Projects Exist

Before S10, the Knotwork hierarchy was:

```
Workspace → Graphs (reusable templates) → Runs (executions)
```

This is an execution model, not a work model. Graphs are templates; Runs are instances. But neither answers the question users actually care about: *"How close are we to our objective?"*

The Project layer closes this gap.

---

## Project

A **Project** is an objective-scoped work container. It is the thing humans track and manage — not the workflow template, but the specific pursuit.

```
Workspace
  └─ Project
       ├─ objective (text)        -- "Onboard 5 enterprise clients before June 30"
       ├─ deadline (date)
       ├─ status                  -- open | in_progress | blocked | done
       ├─ Tasks
       └─ Project Documents
```

A Project is not a Graph. Graphs are reusable; Projects are specific. A single Graph (e.g., "Contract Review") can be run across many Tasks in many Projects.

### Project Dashboard

The project dashboard shows:
- **Quantitative**: task completion %, run success rate, days to deadline
- **Roadblock surface**: failed runs and stalled tasks shown prominently — not buried in a list
- **Qualitative** (S11+): agent-synthesized progress assessment ("~60% toward objective...")

---

## Task

A **Task** is the user-facing work atom. Tasks are what operators assign, track, and discuss.

```
Project
  └─ Task
       ├─ name, description
       ├─ status               -- open | in_progress | blocked | done
       ├─ channel_id           -- task chat (Channel scoped to this task)
       └─ runs[]               -- zero or more Runs triggered from this task
```

Tasks without AI: assigned to a human, executed manually, status updated by hand. Fully valid.

Tasks with AI: trigger a Run against a Graph. The agent handles the workflow steps; the output appears in the task channel.

**The task is the user-facing atom. The Run is the execution detail.**

### Task Channel

Every task has a Channel (task chat). Runs triggered from the task appear as thread events here. Escalations, agent outputs, and human decisions are all visible in the same thread.

---

## ProjectDocument

A **ProjectDocument** is the third knowledge layer — scoped to a Project, persisting across all tasks and runs within it.

### The Three Knowledge Layers

Every agent run in a task loads context from three layers:

| Layer | Scope | What it contains |
|---|---|---|
| **Handbook** | Workspace | How to work — SOPs, reusable guidelines, domain rules |
| **Project Documents** | Project | What this project is about — brief, decisions, research, stakeholder notes |
| **Run Context** | Run | What you're working on right now — this specific task's input |

### Agent prompt structure (extended from S6.5)

```
=== GUIDELINES (how to work) ===
[Handbook fragments — resolved knowledge tree]

=== PROJECT CONTEXT (what this project is about) ===
[Project Documents]

=== THIS CASE (what you are working on) ===
[Run input + Run Context files]
```

### What goes in Project Documents

- Project brief ("what we're trying to achieve and why")
- Competitive analysis or research relevant to this project
- Key decisions made during the project and their rationale
- Stakeholder notes ("client prefers X, avoid Y")
- Accumulated learnings from completed tasks

Project Documents are NOT reusable guidelines (that's the Handbook) and NOT ephemeral task input (that's Run Context). They're the project room — everything an agent needs to understand this specific pursuit without re-uploading per task.

---

## Relationship to Graph and Run

```
Graph   = reusable process template (designed once, run many times)
Project = specific pursuit with an objective
Task    = unit of work within a project
Run     = single execution of a Graph, triggered by a Task
```

A Task may trigger multiple Runs (e.g., retry after failure, run a follow-up step). A Graph may be used across many Tasks in many Projects. Project Documents are loaded automatically into every Run triggered from a Task in that Project.
