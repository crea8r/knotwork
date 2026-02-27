# Frontend Specification — Operator Mode

## Run Trigger Form

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

---

## Dashboard

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

## Run Detail (Live)

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
