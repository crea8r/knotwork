# Frontend Specification

## Guiding Principles

- **Mobile and tablet first.** Every screen must be fully functional on a phone. The canvas has touch support. The operator dashboard is designed for thumb navigation.
- **Chat is the entry point.** Nobody opens a blank canvas. The primary design surface is conversation.
- **Operator and designer are separate modes.** The information architecture reflects the two primary use cases without forcing users to navigate between unrelated screens.
- **Knowledge is the handbook, not a file dump.** The UI consistently frames the knowledge base as a company handbook. Case files belong in the run trigger form, not here. Naming, empty states, and onboarding copy all reinforce this without being prescriptive.
- **Teach through consequences, not instructions.** Knowledge health signals are introduced progressively — users see the connection between knowledge quality and agent behaviour through their own runs, not through a tutorial.

---

## Technology

- **Framework**: React
- **Canvas**: React Flow (touch-enabled, mobile-compatible)
- **Styling**: Tailwind CSS (responsive utilities)
- **State**: Zustand (client state) + React Query (server state)
- **Real-time**: WebSocket (run events)
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

---

## Designer Mode

### Graph List

```
┌────────────────────────────────────┐
│  Knotwork          [+ New Graph]   │
│                                    │
│  🔍 Search graphs...               │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ Hotel Contract Review    ▶   │  │
│  │ Active · 12 runs this week   │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ Construction RFP Pipeline ▶  │  │
│  │ Draft · Last edited 2d ago   │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

Creating a new graph opens the Chat Designer.

---

### Chat Designer

The primary workflow design surface. Available at any time alongside the canvas.

```
┌────────────────────────────────────┐
│  ← Back    Chat Designer      [▣]  │  ← [▣] toggles canvas panel
│                                    │
│  ┌──────────────────────────────┐  │
│  │                              │  │
│  │  Hi! Describe the workflow   │  │
│  │  you want to build.          │  │
│  │                              │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ I need a workflow to review  │  │
│  │ hotel purchase contracts...  │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ Got it. I'm seeing 5 nodes:  │  │
│  │                              │  │
│  │  1. Contract intake          │  │
│  │  2. Asset valuation          │  │
│  │  3. Financial analysis       │  │
│  │  4. Legal risk check         │  │
│  │  5. 3-way approval           │  │
│  │                              │  │
│  │ What contract types do you   │  │
│  │ handle? (purchase / build /  │  │
│  │ sale / all?)                 │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ Type a message...  [📎] [▶]  │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

The `[📎]` button allows attaching an existing `.md` file to import from.

As the conversation progresses, the canvas updates live in the background. The `[▣]` button shows the canvas panel side-by-side (on tablet/desktop) or as a full-screen toggle (on mobile).

---

### Canvas

React Flow canvas with touch support. Used to review, refine, and tinker after the chat designer has produced a draft.

```
┌─────────────────────────────────────────────┐
│  ← Back   Hotel Contract Review   [Chat] [▶]│
│                                             │
│   ┌──────────┐      ┌──────────────┐        │
│   │ Contract │─────►│ Asset        │        │
│   │ Intake   │      │ Valuation    │        │
│   └──────────┘      └──────┬───────┘        │
│                            │                │
│                     ┌──────▼───────┐        │
│                     │ Financial    │        │
│                     │ Analysis     │        │
│                     └──────┬───────┘        │
│                            │                │
│                     ┌──────▼───────┐        │
│                     │ Legal Risk   │        │
│                     │ Check        │        │
│                     └──────┬───────┘        │
│                            │                │
│                     ┌──────▼───────┐        │
│                     │ 3-Way        │        │
│                     │ Approval  👤  │        │
│                     └──────────────┘        │
│                                             │
│   [+ Node]  [+ Edge]  [Auto-layout]  [Save] │
└─────────────────────────────────────────────┘
```

Node icons indicate type: 🤖 LLM Agent, 👤 Human Checkpoint, ⑂ Router, ⚙ Tool Executor.

Tap a node to open its configuration panel (slides up from bottom on mobile).

---

### Node Configuration Panel

Slides up from the bottom on mobile. Full right panel on desktop.

Tabs: **General** / **Knowledge** / **Tools** / **Checkpoints** / **Advanced**

```
┌────────────────────────────────────┐
│  Financial Analysis       [✕]      │
│  ──────────────────────────────    │
│  General  Knowledge  Tools  ...    │
│                                    │
│  Name                              │
│  [Financial Analysis          ]    │
│                                    │
│  Model                             │
│  [openai/gpt-4o          ▼]        │
│                                    │
│  Confidence threshold              │
│  [────────●──────] 0.75            │
│                                    │
│  Knowledge                         │
│  ┌──────────────────────────────┐  │
│  │ 📄 finance/cfo-criteria.md   │  │
│  │    ↳ 📄 finance/ratios.md    │  │
│  │ ⚠️ Resolved: 7,240 tokens    │  │
│  └──────────────────────────────┘  │
│  [+ Add knowledge fragment]        │
└────────────────────────────────────┘
```

Token count warning is shown inline with the knowledge tree.

---

### Handbook (Knowledge Editor)

Named "Handbook" in the UI — not "Knowledge Base." The name sets the mental model before the user reads any copy.

File tree on the left, editor on the right (stacked on mobile).

**Empty state** (new workspace):
```
┌────────────────────────────────────┐
│  Handbook                          │
│                                    │
│  This is where your team's         │
│  expertise lives.                  │
│                                    │
│  Write your procedures, guidelines │
│  and rules here. The clearer they  │
│  are, the more reliably your       │
│  agents will work.                 │
│                                    │
│  [ Start with a template ]         │
│  [ Import from a document ]        │
│                                    │
└────────────────────────────────────┘
```

**File tree with health scores:**
```
┌────────────────────────────────────┐
│  Handbook                [+ File]  │
│                                    │
│  📁 legal                          │
│    📄 contract-review.md  ●●●●○    │  ← health score
│    📄 red-flags.md        ●●●●●    │
│  📁 finance                        │
│    📄 cfo-criteria.md     ●●○○○ ⚠  │  ← needs attention
│  📁 shared                         │
│    📄 company-tone.md     ●●●●○    │
│                                    │
│  ⚠ 1 fragment needs attention      │
│  [View all]                        │
└────────────────────────────────────┘
```

**File editor with health breakdown:**
```
┌────────────────────────────────────┐
│  cfo-criteria.md     [History] [⚙] │
│  Owner: Nguyen Thi A · 2d ago      │
│                                    │
│  Health  ●●○○○  2.1               │
│  ├ Tokens   ●●●●○  in range       │
│  ├ Confidence ●○○○○  avg 0.51     │  ← shown after first run
│  ├ Escalations ●○○○○  8 in 12 runs│  ← shown after first run
│  └ Rating  ●●○○○  2.4 avg         │  ← shown after first rating
│                                    │
│  Resolved: 7,240 tokens  ⚠️ Too large│
│                                    │
│  ──────────────────────────────    │
│  # CFO Review Criteria             │
│                                    │
│  When reviewing financial terms... │
│                                    │
│  See also: [[finance/ratios]]      │
│                                    │
│  💡 3 improvement suggestions      │
│  [Review suggestions]              │
└────────────────────────────────────┘
```

Health sub-scores are revealed **progressively**: token count from day one, confidence and escalations after the first run, ratings after the first rating. Users are not confronted with empty metrics on a new fragment.

**Needs Attention list** (owner view):
```
┌────────────────────────────────────┐
│  ⚠ Needs Attention         (3)     │
│                                    │
│  📄 cfo-criteria.md                │
│     ●●○○○  8 escalations · 12 runs │
│     Owner: Nguyen Thi A            │
│     💡 3 suggestions  [Review →]   │
│                                    │
│  📄 building-contract.md           │
│     ●○○○○  avg confidence 0.38     │
│     Owner: Tran Van B              │
│     [View →]                       │
└────────────────────────────────────┘
```

---

## Operator Mode

### Run Trigger Form

Accessed by tapping "▶ Run" on any graph. This is where case-specific material is attached — the counterpart to the Handbook.

```
┌────────────────────────────────────┐
│  Start a task              [✕]     │
│  Hotel Contract Review             │
│  ──────────────────────────────    │
│                                    │
│  What are you working on today?    │
│                                    │
│  Contract type                     │
│  [ Purchase  ▼ ]                   │
│                                    │
│  Upload files                      │
│  ┌──────────────────────────────┐  │
│  │  📎 Drop files here          │  │
│  │     or tap to browse         │  │
│  │                              │  │
│  │  📄 acme-purchase-v3.pdf  ✕  │  │
│  └──────────────────────────────┘  │
│                                    │
│  Notes (optional)                  │
│  [Pay attention to clause 12...]   │
│                                    │
│  Estimated time: ~4 minutes        │
│                                    │
│  [ Start run ▶ ]                   │
└────────────────────────────────────┘
```

Files uploaded here are **Run Context** — they are available to agents during this run only. They are never stored in the Handbook and never treated as guidelines.

The form fields (e.g. "Contract type") are defined per graph by the designer. The file upload is always present.

---

### Dashboard

The default view for operators. Designed for quick scanning on a phone.

```
┌────────────────────────────────────┐
│  Dashboard              Feb 2025   │
│                                    │
│  Escalations                       │
│  ┌──────────────────────────────┐  │
│  │ ⚠️ Financial Analysis         │  │
│  │    Contract Review · 2m ago  │  │
│  │    Confidence: 42%           │  │
│  │                    [Review →]│  │
│  └──────────────────────────────┘  │
│                                    │
│  Active Runs                       │
│  ┌──────────────────────────────┐  │
│  │ 🔄 Hotel Contract Review     │  │
│  │    Node 3/5 · ~4 min left    │  │
│  └──────────────────────────────┘  │
│                                    │
│  Recent                            │
│  ✅ Construction RFP  · 1h ago     │
│  ✅ Porcelain Product · 3h ago     │
│  ⛔ Hotel Contract    · 5h ago     │
└────────────────────────────────────┘
```

---

### Run Detail (Live)

Shows the graph canvas with live node statuses during a run. Tap any completed node to inspect its output.

```
┌────────────────────────────────────┐
│  ← Runs   Contract Review  [⏹]     │
│                                    │
│   ✅ Contract Intake               │
│          │                         │
│   ✅ Asset Valuation               │
│          │                         │
│   ⚠️ Financial Analysis   [Review] │  ← escalation badge
│          │                         │
│   ⏳ Legal Risk Check              │
│          │                         │
│   ⏳ 3-Way Approval                │
│                                    │
│  Status: Paused                    │
│  Started: 14:02 · ~6 min left      │
└────────────────────────────────────┘
```

Tap any completed node (✅):
```
┌────────────────────────────────────┐
│  Asset Valuation          [✕]      │
│  Completed · 14:04 · 0.87 conf     │
│  ──────────────────────────────    │
│  Output                            │
│  {                                 │
│    "estimated_value": 45000000,    │
│    "method": "DCF",                │
│    "confidence": 0.87              │
│  }                                 │
│                                    │
│  Knowledge used                    │
│  📄 valuation-checklist.md  v8     │
│  📄 finance/ratios.md       v3     │
│                                    │
│  Rate this output: ★ ★ ★ ☆ ☆      │
└────────────────────────────────────┘
```

---

### Escalation Inbox

See [Human-in-the-Loop](./06-human-in-the-loop.md) for the escalation screen layout.

---

## Post-Run Knowledge Feedback

After a run completes (or after a node is rated), the system surfaces a connection between the outcome and the knowledge used — not as a report, but as a contextual nudge in the flow the user is already in.

**After a low-confidence escalation is resolved:**
```
✅ Run resumed.

  The knowledge driving Financial Analysis
  has a health score of ●●○○○.

  Improving it may reduce future escalations.
  [ Review cfo-criteria.md → ]   [ Later ]
```

**After a low rating is submitted:**
```
  Thanks for the feedback.

  This node used cfo-criteria.md (v4).
  Would you like to review it for improvements?

  [ Review fragment → ]   [ Skip ]
```

**After a high-confidence, well-rated run:**
```
  ✅ Contract Review completed in 3m 42s.

  contract-review-guide.md is performing well
  across 47 runs. Your team's process is solid.
```

These moments are how users learn that knowledge quality drives agent quality — not from a tutorial, but from their own work.

---

## Shared UI Patterns

### Token warning badge

Shown anywhere a knowledge fragment's resolved token count is outside range:

- `⚠️ 7,240 tokens — too large` (orange)
- `⚠️ 210 tokens — too sparse` (yellow)

### Knowledge health indicator

Shown in the file tree, node config panel, and post-run screens:

- `●●●●●` (green) — Excellent (4.5–5.0)
- `●●●●○` (green) — Good (3.5–4.4)
- `●●●○○` (yellow) — Fair (2.5–3.4)
- `●●○○○` (orange) — Needs attention (1.5–2.4)
- `●○○○○` (red) — Poor (< 1.5)

Sub-scores are only shown when data exists for them. Empty sub-scores are hidden, not shown as zeroes.

### Run ETA

Shown as a countdown during active runs. Computed from historical run times for that graph. Displayed as "~X min left" on the dashboard and run detail screens.

### Node status icons

| Status | Icon | Colour |
|--------|------|--------|
| pending | ⏳ | Grey |
| running | 🔄 | Blue |
| paused | ⚠️ | Orange |
| completed | ✅ | Green |
| failed | ❌ | Red |
| skipped | ⊘ | Grey |

---

## Mobile-Specific Considerations

- **Canvas on mobile**: pinch-to-zoom, drag to pan, tap to select, long-press to open context menu
- **Chat designer on mobile**: full-screen chat, canvas accessible via toggle button
- **Node config panel**: bottom sheet (not side panel)
- **Escalation response**: large tap targets for Approve/Edit/Guide/Abort buttons
- **Markdown editor on mobile**: simplified toolbar (bold, italic, link, `[[link]]` autocomplete only)
- **File tree on mobile**: collapsible accordion, full-screen when editing
