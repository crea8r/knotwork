# Frontend Specification — Designer Mode

## Graph List

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

## Chat Designer

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

## Canvas

Custom SVG canvas with dagre auto-layout (read-only view; no drag-and-drop). Used to review, refine, and tinker after the chat designer has produced a draft.

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
│                                    [Save]   │
└─────────────────────────────────────────────┘
```

Node icons indicate type: 🤖 LLM Agent, 👤 Human Checkpoint, ⑂ Router, ⚙ Tool Executor.

Tap a node to open its configuration panel (slides up from bottom on mobile).

---

## Node Configuration Panel

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
