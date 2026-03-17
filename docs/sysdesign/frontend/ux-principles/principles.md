# Frontend Specification — Principles & IA

## Guiding Principles

- **One conversational surface for all work.** Users should not choose between "chat tool" and "workflow tool." Daily work, runs, escalations, and workflow design all happen in the same thread-first experience.
- **Messages are immutable for humans and agents.** Nobody edits another participant's message. Corrections happen through explicit follow-up messages and decision actions.
- **Decisions are first-class state transitions.** The UI must separate "who said what" (message log) from "what the system did" (decision log).
- **Structured and ad-hoc work coexist.** Workflows are distilled operational assets, not the only place work can happen. Channels can be ad-hoc or workflow-backed.
- **Knowledge is the handbook, not a file dump.** Case files belong in run context. The Handbook remains the reusable source of truth.
- **Mobile and tablet first.** Every action, including escalation decisions, must be fast on a phone.

---

## Technology

- **Framework**: React 18
- **Canvas**: Custom SVG + @dagrejs/dagre (read-only; click-to-select; no drag-and-drop)
- **Styling**: Tailwind CSS (responsive utilities)
- **State**: Zustand (client state) + React Query (server state)
- **Real-time**: WebSocket (run events, Phase 2) / polling (Phase 1)
- **Markdown editor**: CodeMirror or Milkdown (lightweight, mobile-friendly)

---

## Navigation Model (S7.2)

Global nav order is fixed to preserve a consistent mental model:

1. **Inbox**
2. **Channels**
3. **(separator)**
4. **Runs**
5. **Workflows**
6. **Handbook**
7. **(separator)**
8. **Settings**

This order is not user-configurable.

---

## Information Architecture (S7.2)

```
App
├── Inbox
│   ├── Needs action (escalations, pending approvals, mentions)
│   ├── SLA / timeout badges
│   └── One-tap jump into the relevant thread
│
├── Channels
│   ├── Flat channel list
│   │   ├── Normal channels (ad-hoc collaboration)
│   │   └── Workflow channels (structured execution + design)
│   └── Thread view (same UI for both channel types)
│       ├── Message timeline (human + agent + system)
│       ├── Decision cards (accept / override / request revision / abort)
│       ├── Composer
│       └── Right panel (context, handbook refs, run state)
│
├── (separator)
│
├── Runs
│   ├── Global run history/search
│   ├── Run detail timeline
│   └── Graph/inspector toggle
│
├── Workflows
│   ├── Workflow library (distilled repeatable processes)
│   ├── Workflow editor (chat + canvas + node config)
│   └── Run trigger / versioning
│
├── Handbook
│   ├── File tree
│   ├── Editor
│   ├── Health / proposals
│   └── Handbook chat (agent-assisted edit + restructure)
│
├── (separator)
│
└── Settings
    ├── Workspace
    ├── Members & roles
    ├── Agents (onboarding + ops)
    ├── Agent Profile (/agents/:agentId)
    └── Notification preferences
```

See S8 detail spec: [agents-settings-profile.md](/Users/hieu/Work/crea8r/knotwork/docs/sysdesign/frontend/agents-settings-profile.md).

---

## Channel Types

- **Normal channel**: ad-hoc work; can include humans and agents; may launch one-off runs.
- **Workflow channel**: linked to a workflow definition; still thread-based, but exposes design/run controls and structured state chips.
- **Handbook channel**: dedicated to handbook edit/restructure requests and proposal discussion.

All channel types use the same conversation components. Differences are capability flags and metadata, not a separate UX paradigm.
