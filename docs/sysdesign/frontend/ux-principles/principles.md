# Frontend Principles & Information Architecture

> The full mental model behind these decisions lives in **mental-model.md**.
> This file records the resulting design principles and the IA that implements them.

---

## Guiding Principles

### 1. Organise around the person, not the software

Navigation is built on the user's mental state, not system layers. Three surfaces,
each answering a human question:

- **Now** — What needs me right now?
- **Work** — What am I working on?
- **Knowledge** — How do we do things here?

Users should never have to choose between a "chat tool" and a "workflow tool". The
three surfaces contain everything; the user moves between mental states, not between
feature silos.

### 2. The software makes the routine decisions; humans set priorities

Defaults should be right 80% of the time. Overrides are always available but never
foregrounded. No decision should appear in the UI that the software could make
sensibly for the user.

### 3. Decisions are first-class state transitions

The interface separates "who said what" (message log) from "what the system decided"
(decision log). Decision cards are not chat messages. Approvals, overrides, and
aborts create durable state.

### 4. Asset is the core; Project is how it becomes useful

The handbook and global workflows are what make a team's work distinct from anyone
else's. Projects are containers for applying that knowledge to specific goals. Runs
belong to projects — you cannot run anything without a project home.

### 5. Agent is the baseline — human-only is a valid mode

Knotwork is designed to run with agents. That is the intended experience. But every
surface works without any agent configured. No page should be blank or broken without
an agent. Empty states are valid states, not error states.

When no agent: humans write status summaries manually, the review queue is empty,
channels carry only human messages, and workflows run through human checkpoint nodes.
The agent augments the human; it does not replace the surface.

### 6. The agent does the cognitive labour; the human chairs

The agent observes, prepares, and surfaces. The human reviews, approves, and
redirects. This division must be visible: agents never act silently on strategic
decisions; humans never hunt for what the agent found.

### 7. Knowledge is a work queue, not a library

Opening Knowledge defaults to the Review queue, not the asset tree. With an agent,
the queue is prepared and human-chaired. Without an agent, the queue is empty and the
human works directly in the Assets tab. Either way, the surface is valid and useful.

### 8. Messages are immutable

Nobody edits another participant's message. Corrections happen through explicit
follow-up messages and decision actions.

### 9. Mobile and tablet first

Every action — including escalation responses — must be fast on a phone.

### 10. Interface copy is earned

Do not add static explanatory text by default. Prefer compact, stateful UI: labels,
names, icons, controls, and direct status. Add helper copy only when it resolves a
real ambiguity, risk, or empty state that the interface cannot make clear on its own.
Avoid counts, descriptions, and instructional blurbs that merely restate what is
already visible.

---

## Technology

| Concern | Choice |
|---|---|
| Framework | React 18, TypeScript |
| Canvas | Custom SVG + @dagrejs/dagre — read-only, click-to-select, no drag-and-drop |
| Styling | Tailwind CSS |
| Client state | Zustand |
| Server state | TanStack Query (React Query) |
| Real-time | WebSocket (run events) |
| Icons | Lucide React |
| Routing | React Router v6 |

---

## Navigation Model

Four items. Fixed order, not user-configurable.

```
Now         /inbox      Personal attention surface. Unread badge.
Work        /projects   Project mini-workspace.
Knowledge   /knowledge  Review queue + global asset tree.
──────────────────────────────────────────────────────────
Settings    /settings
```

Old items (Channels, Runs, Handbook) are removed from the sidebar. Their routes
(`/channels`, `/runs`, `/graphs`, `/handbook`) remain accessible via direct URL.
`/handbook` redirects to `/knowledge`.

---

## Information Architecture

```
App
│
├── Now  (/inbox)
│   ├── Escalations waiting on you
│   ├── Run completions, objective status changes
│   ├── Agent reach-outs
│   └── Each item shows its project as a label — not a nav destination
│
├── Work  (/projects)
│   │
│   │   Default landing: last active project (not the project list).
│   │   The project list is a "switch project" action, not the entry point.
│   │   Work is continuous — it remembers where you were.
│   │
│   ├── Project list  (/projects)  ← secondary; for switching or creating
│   │
│   └── Project detail  (/projects/:id)
│       │
│       ├── Inner sidebar  — channel navigation, not page tabs
│       │   ├── ★ Project-wide  (always pinned → home view)
│       │   ├── # recent objective context A  (shortcut to recently active)
│       │   ├── # recent objective context B  (shortcut to recently active)
│       │   ├── + N more  (all other channels, collapsed by default)
│       │   └── Assets  (→ assets view)
│       │
│       │   The 2 recent slots are shortcuts, not the primary way to reach
│       │   objectives. Objectives are reached by clicking through the dashboard.
│       │
│       ├── Home view  (default — project-wide channel selected)
│       │   ├── ProjectDashboard  (collapsible)
│       │   │   ├── Status summary — always visible in header
│       │   │   │   Human can write it directly, or configure a system prompt
│       │   │   │   so an agent generates it. Both are valid. Without an agent,
│       │   │   │   the human is the author. Content describes what needle moved:
│       │   │   │   objective progress, blockers, notable changes.
│       │   │   ├── Objective list: status badge + progress % (clickable)
│       │   │   └── Auto-expands when new content is posted
│       │   └── Project-wide chat channel  (body below dashboard)
│       │       The main buffer. Free-form, invoke anything, coordinate, delegate.
│       │       Runs surface here — not as a separate tab.
│       │
│       ├── Objective detail  (/objectives/:id)  ← drill-down from dashboard
│       │   ├── Reached by clicking an objective in the dashboard summary
│       │   ├── Breadcrumb back to parent project
│       │   ├── Objective detail (title, status, key results, progress)
│       │   ├── Run trigger (workflow selector + run input)
│       │   ├── Objective channel (messages + decisions)
│       │   └── Run history scoped to this objective
│       │
│       └── Assets view  (Assets selected in inner sidebar)
│           └── Unified file tree — project docs and project workflows together
│           No runs here. Runs belong to objectives, not asset browsing.
│
├── Knowledge  (/knowledge)
│   ├── Review tab  (default when pending items exist)
│   │   ├── Agent-prepared proposals: outdated files, gaps, overlaps, health alerts
│   │   ├── Approve / Reject per item
│   │   └── Empty state: "All caught up"
│   └── Assets tab
│       └── Global file tree — handbook files + global workflows together
│       No runs. "Run in project..." bridges to Work with workflow pre-selected.
│
└── Settings  (/settings)
    ├── Workspace
    ├── Members & roles
    ├── Agents
    └── Notification preferences
```

---

## Route Map

| Path | Component | Status |
|---|---|---|
| `/inbox` | `InboxPage` | In sidebar as "Now" |
| `/projects` | `ProjectsPage` | In sidebar as "Work"; secondary (switch/create) |
| `/projects/:id` | `ProjectDetailPage` | Work default landing (last active project) |
| `/objectives/:id` | `ObjectiveDetailPage` | Drill-down within Work; not a sidebar item |
| `/knowledge` | `KnowledgePage` | In sidebar as "Knowledge" |
| `/knowledge/file` | `KnowledgeFilePage` | File editor from Review tab |
| `/handbook` | redirect → `/knowledge` | Backward compat |
| `/handbook/file` | `KnowledgeFilePage` | Direct file links still work |
| `/channels` | `ChannelsPage` | Accessible, not in sidebar |
| `/channels/:id` | `ChannelDetailPage` | Accessible, not in sidebar |
| `/runs` | `RunsPage` | Accessible, not in sidebar |
| `/runs/:id` | `RunDetailPage` | Accessible, not in sidebar |
| `/graphs` | `GraphsPage` | Accessible, not in sidebar |
| `/graphs/:id` | `GraphDetailPage` | Full-viewport outside AppLayout |
| `/escalations` | `EscalationsPage` | Accessible, not in sidebar |
| `/settings` | `SettingsPage` | In sidebar |
| `/agents/:id` | `AgentProfilePage` | Via Settings |

---

## Channel Types

Within a project, channels are typed but share the same conversation UI:

| Type | Role | Visibility in sidebar |
|---|---|---|
| Project-wide | Main buffer — free-form, invoke anything | Always pinned |
| Objective | Focused work scoped to one objective | Recent slots |
| Free-chat | Ad hoc collaboration | Recent slots |
| Run | Execution record; events bubble to project-wide | Behind "N more" |
| Asset | Audit trail for file/workflow changes | Behind "N more" |

All types use the same message + decision timeline components. Type differences are
capability flags and metadata, not separate UX paradigms.
