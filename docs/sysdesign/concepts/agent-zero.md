# Core Concepts — Agent Zero

Added in S12. Agent Zero is the optional but recommended first step in workspace setup — the orchestrator, advisor, and primary representative for the workspace.

---

## What Agent Zero Is

**Agent Zero** is a RegisteredAgent with a special role: `orchestrator`. It is not a specialist agent for a specific workflow — it is the generalist intelligence that knows the workspace as a whole.

Agent Zero is:
- The **primary representative** (first `is_primary` entry in `WorkspaceRepresentative`)
- The **onboarding guide** — helps a new workspace get started
- The **orchestra helper** — keeps the human-in-charge aware of what's happening across projects and agents
- The **recruitment advisor** — suggests when a new specialized agent should be created and helps design it

Agent Zero connects via OpenClaw. This means the user's own AI (Claude Desktop, etc.) becomes the workspace's orchestrator — no separate API key or model subscription needed.

---

## Creating Agent Zero (Onboarding)

Onboarding runs **after installation** — it is not part of the install flow. Once the workspace is up and running, the user can launch the onboarding at any time from workspace settings.

The user is offered:

> "Would you like to create a workspace assistant? This agent will help you set up your workspace and stay on top of what's happening."

If accepted, Agent Zero is registered as:
- `role: "orchestrator"`
- `is_primary: true` in `WorkspaceRepresentative`
- Connected via the workspace's OpenClaw connection

**Onboarding is re-runnable.** If the user wants to revisit their workspace structure — add new workflows, onboard new team members, recruit new agents — they can run the onboarding again. Agent Zero picks up where the workspace is and helps evolve it. Steps already done are skippable; nothing is overwritten without confirmation.

### What Agent Zero does during onboarding

Agent Zero runs a guided conversation (via its main session chat) to help the human-in-charge initialize the workspace:

1. **Understand the work** — "What kind of work does your team do? What's the most common thing you handle?"
2. **Create starter workflows** — drafts one or two simple Graph templates based on the answer; human reviews and saves
3. **Create starter Handbook content** — creates simple guideline files for the most common workflows
4. **Create first project** — if the user mentions current work in progress, creates a Project with basic tasks
5. **Invite team** — "Do you have team members who should have access?" — helps with the invitation flow
6. **Recruit agents** — "Some of this work could be handled by a dedicated agent. Want me to suggest one?"

This is all conversational and optional. The user can skip any step.

---

## Agent Zero's Ongoing Role

### Orchestra helper

Agent Zero has workspace-wide read access across all projects, tasks, runs, and escalations. It monitors:

- **Stalled tasks** — tasks blocked for more than a configured threshold
- **Project health** — projects approaching deadline with incomplete tasks
- **Escalation backlog** — unresolved escalations piling up
- **Agent utilization** — workflows running well vs. frequently failing or escalating

It surfaces these proactively to the human-in-charge via its main session chat:

> "Project X is at risk — Task Z is blocked and the deadline is in 5 days. Two escalations are waiting for your review."

> "The contract review workflow has been triggered 12 times this month. You might want to create a dedicated agent for it — I can help set that up."

### Advisor

Agent Zero advises on workspace strategy:

- **Handbook quality** — "Your contract review guidelines haven't been updated in 6 weeks but the escalation rate is rising. Worth reviewing?"
- **Objective drift** — synthesizes project progress and flags when objectives may need updating (feeds into S11.1 meta-agent)
- **Team composition** — identifies gaps where a specialized agent would reduce human load

### Agent recruiter

When Agent Zero identifies a need for a new specialized agent, it proposes one:

1. Describes what the agent would do and which workflows it would handle
2. Drafts the `RegisteredAgent` config (display name, provider recommendation, agent_ref)
3. Drafts starter Handbook entries for the new agent's domain
4. Proposes: human reviews and approves; the new agent is registered

Agent Zero never creates agents autonomously. All proposals require human approval — same pattern as Handbook proposals.

---

## Data Model

```
RegisteredAgent
  ...existing fields...
  role    enum  [specialist, orchestrator]  -- default: specialist
                                            -- orchestrator = Agent Zero semantics
```

Only one agent per workspace should have `role: "orchestrator"`. The UI enforces this during setup and prevents accidental duplication.

---

## Agent Zero vs. Regular Agents

| | Agent Zero | Specialist Agent |
|---|---|---|
| **Scope** | Workspace-wide | Specific workflow/domain |
| **Role** | Orchestrator, advisor, recruiter | Execute specific node types |
| **Access** | Read across all projects/tasks | Scoped to run context |
| **Session** | Persistent main session (always available) | Run-scoped session |
| **Connected via** | OpenClaw (user's own AI) | OpenClaw or direct provider key |
| **Created** | Onboarding (optional) | As-needed (manual registration) |
| **Representative** | Always primary | Can be designated representative |

---

## The COO Analogy

Agent Zero is the workspace COO — the Chief Orchestration Officer. The human-in-charge sets objectives and makes strategic decisions. Agent Zero keeps the operation running: tracking what's in flight, flagging what's at risk, and proposing what to do next.

The human doesn't need to monitor every task, every run, every escalation. Agent Zero surfaces what matters, when it matters. The human's job is to make decisions, not to watch dashboards.

As the workspace grows (more projects, more agents, more workflows), Agent Zero's value increases — it's the one identity that has the full picture.

---

## Main Session Chat

Agent Zero's main session (established in S8) becomes the primary command interface for the workspace. The human can:

- Ask for workspace status ("What's in flight? What's blocked?")
- Delegate work ("Create a task in Project X for the Acme contract review")
- Get recommendations ("Should we update the onboarding handbook?")
- Review Agent Zero's proposals (new agents, objective updates, handbook changes)

This is not a separate UI surface — it is Agent Zero's existing main session chat, elevated to workspace command center.
