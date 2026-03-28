# Knotwork Mental Model

> "What decisions is the user forced to make that they shouldn't have to make?"
> — The design question that drives all UX decisions in Knotwork.

---

## The Core Insight

Bad UX makes you think about the software. Good UX makes you think about your work.

Gmail's breakthrough wasn't better email — it was removing three decisions users shouldn't have had to make: where to file things (search instead), how to track threads (conversations instead of individual messages), and whether to delete (storage as infinite). The software disappeared.

Knotwork's equivalent: users should think about their business, not about configuring the software.

---

## Agent is the Baseline — Human-Only is a Valid Mode

Knotwork is designed to run with agents as the default setup. Agents generate status summaries, surface knowledge proposals, execute workflow nodes, and post to channels. This is the intended experience.

**However, Knotwork works fully without any agent configured.**

Every surface has a human-only mode:

| Surface | With agent | Without agent |
|---|---|---|
| Project dashboard | Agent generates status summary on schedule | Human writes status manually |
| Review queue | Agent surfaces proposals | Queue is empty; human edits assets directly in Assets tab |
| Channel | Agent posts run events, reach-outs | Human messages only |
| Workflow nodes | Agent nodes execute autonomously | Human checkpoint nodes only; human completes every step |
| Now | Agent reach-outs + escalations from agent nodes | Escalations from human checkpoint nodes only |

The UI never assumes an agent is present. Empty states are valid states, not broken states.

The agent configuration (system prompt, schedule, trust level) is how a human customises the agent's behaviour — not a prerequisite for using the app.

This constraint also means: **no surface should be blank or meaningless without an agent.** Every page must have a clear human action available.

---

## Four-Layer Architecture (Mental Model)

The app is built on four logical layers. Understanding these layers is the foundation for all navigation and UX decisions.

```
ASSET     — what you know
            Files + Workflows = domain knowledge = what makes this team distinct from anyone else
            Global asset (workspace-wide) + Project asset (project-scoped)

PROJECT   — what you are doing
            Objectives + Runs + Dashboard + Channels
            The container for active work; each project can draw from its own asset and global asset

CHANNEL   — how you are informed and how you act
            Asset emits events → Channels carry them → Humans and agents subscribe
            Project main channel (the buffer), Objective channels, Custom channels

AGENT     — who executes
            Independent units with their own setup and maintenance
            Out-of-box agents or custom via OpenClaw; not a navigation destination
```

**Asset is the core.** It is what makes a team's work distinct from anyone else in the world.
**Project is how Knotwork becomes useful** to the user day-to-day.

---

## Two Working Modes

Within a single workspace — even with just one person — there are two distinct mental states:

| Mode | Mental focus | Primary concern |
|---|---|---|
| **Strategy** | Setup and maintain workflows, asset management, objective setting | Objectives, process design, knowledge quality |
| **Operation** | Task execution, run monitoring, handling escalations | Tasks, run status, decisions that need me |

The same person switches between these modes. The UI should recognize which mode you are in and not mix them.

**The current app is too strategy-heavy.** It is optimized for setup (configuring nodes, defining workflows, managing files) rather than daily operation (what needs me, what is happening, what do I do next). This is why "Run felt clunky" — there is no interface designed for someone who already knows the system and just wants to work in it.

---

## Three Navigation Surfaces

The app organizes around three surfaces, not five sections. Each surface answers a different question.

### Now
**Question:** What needs me?

The personal attention surface. Shows everything that is yours right now — across whatever projects it belongs to. Each item carries its project as context, not as navigation.

Key properties:
- Personal (mine, not all projects)
- Transient — items clear when handled
- Action-oriented — you act inline, not navigate away
- Cross-project — project shown as a label, not a container

This is the memo on your desk. Short, urgent, references work — not where work lives.

### Work
**Question:** What am I working on?

Where you go to engage, not just respond. The working context: the project channel (the main buffer), objective tree, objective channels, active runs and tasks.

Key properties:
- Continuous — remembers where you were last
- Project-contextual — you are in a project, not picking one
- Deep — the full thread, run detail, objective breakdown is here
- Immersive — you are at your desk, not choosing which desk to sit at

This is your desk or workshop. Active, present, in-use.

### Knowledge
**Question:** How do we do things here?

The strategic layer. Handbook files, workflows, health scores, proposals. Where you go with intention to plan, test, discuss, and maintain what your team knows.

Key properties:
- Timeless — reference material, not time-sensitive
- Deliberate — you go here on purpose, not by default
- Quality-conscious — health scores, improvement suggestions, structure matters

This is your whiteboard, war room wall, or drawer. Where strategy lives.

---

## The "What Is Now" Principle

The most important navigation insight: **the frame should be the person, not the project.**

Every project management tool puts the project at the center — you navigate to a project and work inside it. Knotwork should put the person at the center — your work surfaces to you, with project as a context label.

This distinction:

| Tool-centered (wrong) | Person-centered (right) |
|---|---|
| You pick a project to enter | You open the app and your work is already there |
| Escalations are system objects | Escalations are your decisions, labeled by project |
| Multiple projects = multiple destinations | Multiple projects = multiple context labels on one surface |
| Navigate to find work | Work finds you |

The inbox is not wrong as a concept. It fails because it shows isolated system objects (escalations, proposals) without the work context that gives them meaning.

---

## Channel Architecture

Each project has:
- **One main channel** — the buffer, the legroom for work. Free-form, invoke anything, coordinate, ask, delegate.
- **One channel per objective** — focused, task-scoped. Good for deep work on a specific goal. Can feel too strict.
- **Custom channels** — user-created, for balance between free-form and focused.

The main project channel is not where you land. It is where you go for deep work within a specific context. The personal attention surface (Now) is upstream — the aggregation of what each channel is surfacing to you, filtered to what is yours.

---

## Chat as Parallel Mode

Chat is not a feature of the UI. It is an alternative rendering surface for the same underlying model.

Two surfaces for the same data:

| Surface | When | Mental mode |
|---|---|---|
| Structured UI | You know what you are changing and where it lives | Setup / Maintain |
| Chat | You know what you want but not how to get there | Daily operation |

The structured UI has low tolerance for ambiguity — you need to know the system vocabulary (node, version, knowledge path). Chat absorbs ambiguity — you can speak in your own terms.

Chat provides the "legroom" — when a task is fuzzy or you are not sure which button to press, chat lets you express intent and the system figures out the path. This lowers the activation energy for daily operation.

---

## Naming and Labels

The three surfaces are named **Now / Work / Knowledge** as the canonical reference in all documentation and design discussion.

However, **labels are configurable per workspace**. The mental model is fixed; the label is a skin. Workspace admins can rename to match their team's professional vocabulary:

| Team | Now | Work | Knowledge |
|---|---|---|---|
| Default | Now | Work | Knowledge |
| Law firm | Urgent | Matters | Precedents |
| Consulting | Today | Engagements | Methodology |
| Marketing | Inbox | Campaigns | Playbooks |

Options explored (kept for reference):

| Group | Now | Work | Knowledge |
|---|---|---|---|
| Physical desk | Tray | Desk | Shelf |
| Spatial | Hall | Floor | Library |
| Ops room | Brief | Ops | Intel |
| Craft | Queue | Bench | Vault |

All options are valid and will resonate differently with different professional groups. The default should be the most neutral and universally understood.

---

## Work — Detailed UX Structure

Work is a mini-workspace. Once inside a project, the user navigates channels within it — not tabs of a page. The project has two things: channels and assets.

### Project Layout

```
[App sidebar]     [Project channels]     [Main content]

Now               ★ project-wide    →   [Dashboard — collapsible]
Work ← active        # objective A        Agent summary + objective links
Knowledge            # objective B        [collapse ▲]
Settings          + 14 more              ─────────────────────
                  ──────────────          [Project-wide channel]
                  Assets                  Messages...
                                          [input]
```

### Dashboard + Project-wide Channel (merged)

The project home is one surface: a collapsible dashboard above the project-wide channel.

- **Dashboard**: a status summary — objective progress, what's blocked, what changed. Not tasks completed, not runs executed. Objective movement.
- **Authorship is flexible**: the human can write it directly, or configure a system prompt so an agent generates it on a schedule, or both. The agent augments; it does not own. When no agent is configured, the human writes the status manually.
- **Auto-expands** when new content appears (agent-posted or human-posted). User can collapse it to reclaim screen space for chat.
- **Objective links**: each objective in the summary is clickable → drills into ObjectiveDetailPage.
- **Below the dashboard**: the project-wide chat channel. This is the main buffer — free-form, invoke anything, coordinate, delegate.

These are not two separate tabs. They are one page: the dashboard is a smart collapsible header, the channel is the body.

### Objectives — drill-down, not a tab

Objectives are not a top-level tab. They are reached by clicking through from the dashboard summary.

- Dashboard shows: "Objective A: 60% ●●●○○ — Objective B: blocked ⚠️"
- Clicking an objective → ObjectiveDetailPage
- Each objective has its own channel in the project sidebar
- Working on an objective = working in its channel

The objective list is not a separate navigation destination. The dashboard IS the objectives overview in summary form.

### Channel List — 1 pinned + 2 recent

```
★ project-wide        ← always pinned (the project home)
# objective: hiring   ← recent activity slot
# objective: legal    ← recent activity slot
+ 14 more channels    ← collapsed, searchable, bookmarkable
──────────────────
Assets
```

- **Pinned**: project-wide channel, always visible
- **2 recent slots**: filled by most recently active channels
- **Bookmarks**: user can pin any channel to occupy the recent slots
- **All others**: behind "N more" — searchable, not cluttering daily navigation

### Channel Types (within a project)

A project can have many channel types. Most are passive/archival — accessed when needed, not daily navigation.

| Type | Role | Visibility |
|---|---|---|
| Project-wide | Main buffer, daily work | Always pinned |
| Objective channels | Focused work on specific objective | In recent/bookmark slots |
| Free-chat | Ad hoc | In recent/bookmark slots |
| Run channels | Execution record, surfaces into project-wide | Behind "more" |
| File/workflow/asset channels | Audit trail, change history | Behind "more" |

### Runs — hidden

Runs are not a tab. They surface into channels — a run creates its own channel, significant events bubble up to the project-wide channel. Users think in objective progress, not run execution.

Power users who need execution detail access it from within the channel where the run surfaced.

### Assets — unified file tree

One file tree. Markdown files, PDFs, and workflows all live together. A workflow is a file that happens to be runnable. The user discovers this when they open it — not from the navigation label.

No separate "Workflows" section. No separate "Files" section. Assets.

---

## Runs Always Belong to a Project

This is a structural constraint with significant UX consequences.

**Knowledge has no Runs. Runs belong to Projects.**

- A run without a project has no home — no dashboard to surface its output, no objective to move, no channel context.
- You cannot trigger a run from Knowledge.
- A user must create at least one project before they can run anything.

### Consequences

**Knowledge is execution-free.**
You read, edit, and maintain assets in Knowledge. A workflow file opened in Knowledge has no Run button — or shows "Run in project..." which prompts project selection and navigates to Work with the workflow pre-selected.

**Onboarding is forced.**
A new user cannot do anything meaningful until they create a Project. The first-run experience must guide them there. This enforces the right mental model early: "what are you working on?" before "what do you want to run?"

**Solo users get a default project.**
A solo founder should not think about project management overhead. A default project is created automatically on workspace setup (named after the workspace or "My work"). They can rename or ignore it. This removes the "create a project" barrier for single-focus users.

**The Knowledge → Work bridge.**
When a user wants to run a global workflow found in Knowledge:
```
Knowledge (view workflow) → "Run in project..." → select or create project → Work (run triggered)
```
Knowledge shows the asset. Work executes it. Context carries over.

---

## Knowledge — Detailed UX Structure

Knowledge is a **work queue you process**, not a library you browse. Strategic work is cognitively demanding — humans naturally avoid it. The UX compensates by having the agent do the heavy cognitive work (observation, preparation, diagnosis) and presenting the human with judgment calls on pre-digested items.

### Default View: Review Queue

When you open Knowledge, you see the Review queue first — not the asset tree.

**Empty state:**
```
All caught up.
Nothing needs your strategic attention right now.
```
This is an achievement, not a dead end. Could mean the agent found nothing worth surfacing, or no agent is configured yet — either way, the human can always go to the Assets tab and work directly.

**Items pending:**
```
Agent-prepared review document
─────────────────────────────
• 2 files may be outdated — last used 6 weeks ago, 3 runs since
• 1 gap detected — no file covers client onboarding refunds
• 3 files overlap — consider merging legal/contracts/*
• 1 health alert — "rate-card.md" is thin (180 tokens), never cited

You set priority. Work through one by one.
Agent explains why. You approve / reject / modify.
```

All four item types appear in one prepared document:
- Proposed edits (something outdated or wrong)
- New file suggestions (gap detected from run patterns)
- Archive/merge proposals (redundancy found)
- Health alerts (thin files, unused workflows, low confidence scores)

### Review Session

- Agent prepares the document (triggered by run-count threshold internally, delivered on human's scheduled time)
- Human chairs: reads full document, sets priority order, works item by item
- Agent-initiated urgency override: if something is critical and obvious, agent surfaces it in Now — does not wait for the scheduled session
- Multiple humans can participate in a review session; the chairman (human) owns the final call

### Secondary View: Assets

The global file tree — accessed deliberately when you need to find or edit something specific.

- Unified tree: handbook files and global workflows together
- Workflows are files with a run-capable indicator
- No Run button — running always happens in Work
- "Run in project..." action bridges to Work with workflow pre-selected

### Key Constraints

- No runs in Knowledge
- No project-scoped content in Knowledge (project assets live in Work)
- Focus mode when doing deep work: noise floor lowered, only urgent items break through
- Everyone on the team has access (small team assumption)

---

## Now — Detailed UX Structure

Now is structurally correct as built. The current Inbox collects the right things and the click-through behavior is intentional — solving things inline risks losing context. No structural change needed.

**The only change:** renamed from Inbox → Now (configurable label per workspace).

### What Now Contains

All three types of items belong here:

- **Decisions waiting on you** — escalations, human checkpoints, approvals
- **Things that moved** — run completed, objective status changed, agent did something notable
- **Agent reaching out** — "I noticed X, thought you should know" or "I need guidance on Y"

### Behavior

- Items carry their **project as a context label** — not a navigation container
- **Click-through to resolve** — you go to where the work lives, not inline resolution
- Items **clear when handled** — Now is a daily memo, not a permanent record
- Cross-project — everything yours, regardless of which project it came from

---

## Three Surfaces Summary

```
Now        Renamed Inbox. Personal, cross-project, action-required.
           Finds you. You clear it. Click-through to resolve in context.

Work       Projects as mini-workspace. You go there to engage.
           Default: last active project → Dashboard (collapsible) + channel.
           Inner nav: ★ project-wide + 2 recent channels + Assets.
           Objectives drill-down from dashboard. Runs hidden (surface via channels).
           Assets: unified file tree — files and workflows together.

Knowledge  Work queue, not library. Default: Review queue (agent-prepared).
           Secondary: Assets (global file tree — files + global workflows).
           No runs. "Run in project..." bridges to Work.
           Everyone has access. Focus mode lowers noise floor.
```

---

## Design Filter

Every UI decision should pass this filter:

1. **Does removing this decision break anything?** → If no, remove it.
2. **Can the software make a sensible default 80% of the time?** → If yes, default it and hide the override.
3. **Is this decision phrased in software terms or human terms?** → Rephrase it in human terms.
4. **Does this surface belong in Strategy mode or Operation mode?** → Do not mix them in the same view.
