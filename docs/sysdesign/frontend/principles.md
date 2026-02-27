# Frontend Specification — Principles & IA

## Guiding Principles

- **Mobile and tablet first.** Every screen must be fully functional on a phone. The canvas has touch support. The operator dashboard is designed for thumb navigation.
- **Chat is the entry point.** Nobody opens a blank canvas. The primary design surface is conversation.
- **Operator and designer are separate modes.** The information architecture reflects the two primary use cases without forcing users to navigate between unrelated screens.
- **Knowledge is the handbook, not a file dump.** The UI consistently frames the knowledge base as a company handbook. Case files belong in the run trigger form, not here. Naming, empty states, and onboarding copy all reinforce this without being prescriptive.
- **Teach through consequences, not instructions.** Knowledge health signals are introduced progressively — users see the connection between knowledge quality and agent behaviour through their own runs, not through a tutorial.

---

## Technology

- **Framework**: React 18
- **Canvas**: Custom SVG + @dagrejs/dagre (read-only; click-to-select; no drag-and-drop)
- **Styling**: Tailwind CSS (responsive utilities)
- **State**: Zustand (client state) + React Query (server state)
- **Real-time**: WebSocket (run events, Phase 2) / polling (Phase 1)
- **Markdown editor**: CodeMirror or Milkdown (lightweight, mobile-friendly)

---

## Information Architecture

```
App
├── Designer
│   ├── Graphs list
│   ├── Graph detail
│   │   ├── Chat designer
│   │   ├── Canvas
│   │   └── Node configuration panel
│   └── Handbook  (knowledge base — named "Handbook" in UI)
│       ├── File tree (with health indicators)
│       ├── File editor (with token meter + health score)
│       ├── Suggestions (Mode B)
│       └── Needs Attention (low-health fragments)
│
├── Operator
│   ├── Dashboard (active runs, recent, escalations summary)
│   ├── Runs list
│   ├── Run detail (live canvas + node inspector)
│   └── Escalation inbox
│
├── Tools (owner only)
│   ├── Registry list
│   └── Tool editor / tester
│
└── Settings
    ├── Workspace
    ├── Members & roles
    ├── API keys
    └── Notification preferences
```
