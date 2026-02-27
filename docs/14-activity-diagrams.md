# Activity Diagrams

Key flows shown as swimlane activity diagrams. Swimlanes are rendered as subgraphs.

---

## 1. Design a Workflow (Chat-First)

From a new user's first idea to an active graph ready to run.

```mermaid
flowchart TD
  subgraph Designer
    A1([Start: I need a workflow]) --> A2[Open app → New Graph]
    A2 --> A3[Chat Designer opens]
    A3 --> A4[Describe the process in natural language]
    A4 --> A7{Happy with\nthe structure?}
    A7 -->|No — refine| A8[Continue conversation\nadd / remove / reshape nodes]
    A8 --> A7
    A7 -->|Yes| A9[Switch to canvas]
    A9 --> A10[Drag nodes, adjust positions]
    A10 --> A11[Tap a node → open config panel]
    A11 --> A12[Link knowledge fragments]
    A12 --> A13[Add tools]
    A13 --> A14[Set confidence threshold & checkpoints]
    A14 --> A15{All nodes\nconfigured?}
    A15 -->|No| A11
    A15 -->|Yes| A16[Activate graph]
    A16 --> A17([Graph ready to run])
  end

  subgraph System
    B1[Parse description] --> B2[Propose nodes & edges]
    B2 --> B3[Render graph delta on canvas]
    B3 --> B4{Follow-up\nmessage?}
    B4 -->|Yes| B1
    B4 -->|No| B5[Wait]
  end

  A4 --> B1
  B2 --> A7
  A8 --> B1
```

---

## 2. Import Workflow from Existing Document

For users who already have a process described as an MD file, SOP document, or even an n8n flow description.

```mermaid
flowchart TD
  subgraph Designer
    C1([Start: I have an existing doc]) --> C2[Open Chat Designer]
    C2 --> C3[Attach or paste MD content]
    C3 --> C6{Is the draft\ngood enough?}
    C6 -->|Needs work| C7[Correct or refine via chat]
    C7 --> C6
    C6 -->|Yes| C8[Switch to canvas]
    C8 --> C9[Configure knowledge & tools per node]
    C9 --> C10([Graph activated])
  end

  subgraph System
    D1[Parse MD structure\ndetect steps, conditions, roles] --> D2[Map to node types]
    D2 --> D3[Generate draft graph definition]
    D3 --> D4[Render on canvas]
    D4 --> D5{Clarification\nneeded?}
    D5 -->|Yes| D6[Ask designer a clarifying question]
    D6 --> D1
    D5 -->|No| D7[Wait]
  end

  C3 --> D1
  D4 --> C6
  C7 --> D1
```

---

## 3. Execute a Run (Normal Path — No Escalation)

```mermaid
flowchart TD
  subgraph Operator
    E1([Start: trigger a run]) --> E2[Open graph → tap Run]
    E2 --> E3[Fill run trigger form]
    E3 --> E4[Attach case files — Run Context]
    E4 --> E5[Submit]
    E5 --> E6[Receive run_id and ETA]
    E6 --> E7[Monitor live canvas]
    E7 --> E11[Review final output]
    E11 --> E12[Rate node outputs]
    E12 --> E13([Done])
  end

  subgraph System
    F1[Queue run] --> F2[Load graph definition]
    F2 --> F3[For each node in order / parallel]
    F3 --> F4[Load knowledge tree\nfolder-as-domain filter]
    F4 --> F5[Snapshot knowledge versions]
    F5 --> F6[Execute node\nGUIDELINES + THIS CASE prompt]
    F6 --> F7[Evaluate confidence & checkpoints]
    F7 --> F8{Pass?}
    F8 -->|Yes| F9[Save RunNodeState]
    F9 --> F10{More nodes?}
    F10 -->|Yes| F3
    F10 -->|No| F11[Mark run completed]
    F11 --> F12[Trigger post-run hooks\nwebhook, notification]
  end

  E5 --> F1
  F3 --> E7
  F11 --> E11
  E12 --> F13[Update knowledge health scores]
```

---

## 4. Execute a Run (Escalation Path)

```mermaid
flowchart TD
  subgraph Operator
    G1[Monitoring live canvas] --> G5[Receive notification\nTelegram / WhatsApp / in-app]
    G5 --> G6[Open escalation screen]
    G6 --> G7[Review agent output + context]
    G7 --> G8{Decision}
    G8 -->|Approve| G9[Tap Approve]
    G8 -->|Edit| G10[Modify output → save]
    G8 -->|Guide| G11[Write guidance text → submit]
    G8 -->|Abort| G12[Tap Abort → run stopped]
    G9 --> G13[Run resumes]
    G10 --> G13
    G11 --> G14[Node retries with guidance]
    G14 --> G15{Retry\nconfident?}
    G15 -->|Yes| G13
    G15 -->|No| G5
  end

  subgraph System
    H1[Node produces output] --> H2{Confidence ≥\nthreshold?}
    H2 -->|Yes| H3{Checkpoints\npass?}
    H3 -->|Yes| H4[Proceed to next node]
    H2 -->|No| H5[Create escalation record]
    H3 -->|No| H6{Fail-safe\ndefined?}
    H6 -->|Yes| H7[Execute fail-safe action]
    H6 -->|No| H8{Retries\nexhausted?}
    H8 -->|No| H9[Retry node]
    H9 --> H1
    H8 -->|Yes| H5
    H5 --> H10[Pause run]
    H10 --> H11[Send notifications]
    H11 --> H12{Timeout\nexceeded?}
    H12 -->|Yes| H13[Mark run stopped]
    H12 -->|No| H14[Wait for operator]
  end

  H11 --> G5
  G9 --> H4
  G10 --> H4
  G11 --> H9
  G12 --> H13
```

---

## 5. Human Checkpoint Node

A planned stop — always requires human action, regardless of confidence.

```mermaid
flowchart TD
  subgraph Graph_Execution["Graph Execution"]
    I1[Previous node completes] --> I2[Human Checkpoint node reached]
    I2 --> I3[Run paused unconditionally]
    I3 --> I4[Context fields extracted from run state]
  end

  subgraph System
    I5[Create escalation — type: human_checkpoint]
    I6[Send notifications per node config\nin-app + email + Telegram + WhatsApp]
    I7{Operator responds\nbefore timeout?}
    I8[Mark run stopped]
    I9[Resume run with human response in state]
  end

  subgraph Operator
    I10[Receives notification]
    I11[Opens escalation in-app]
    I12[Reviews displayed context fields]
    I13{Response type}
    I14[Approve]
    I15[Edit output]
    I16[Provide guidance → node before retries]
    I17[Abort]
  end

  I4 --> I5 --> I6
  I6 --> I7
  I7 -->|No — timeout| I8
  I7 -->|Yes| I9
  I6 --> I10 --> I11 --> I12 --> I13
  I13 --> I14 --> I9
  I13 --> I15 --> I9
  I13 --> I16 --> I9
  I13 --> I17 --> I8
  I9 --> I20[Next node executes]
```

---

## 6. Knowledge Improvement Loop

From a low-rated run to an improved knowledge fragment and better future runs.

```mermaid
flowchart TD
  subgraph Operator
    J1[Rates node output low\n1–2 stars + comment]
  end

  subgraph System
    J2[Rating saved → linked to RunNodeState\nand knowledge snapshot]
    J3[Health score recomputed for affected fragments]
    J4{Mode B\nenabled?}
    J5[Flag fragment in Handbook\nMode A only]
    J6[Trigger improvement agent]
    J7[Agent loads: run input, output,\nknowledge snapshot, rating comment]
    J8[Agent identifies weak sections]
    J9[Agent generates diff + rationale]
    J10[Create suggestion record]
    J11[Notify fragment owner]
  end

  subgraph Knowledge_Worker["Knowledge Worker"]
    J12[Receives notification]
    J13[Opens suggestion in Handbook editor]
    J14[Reviews diff and rationale]
    J15{Decision}
    J16[Approve → new version saved]
    J17[Edit → modify diff → save]
    J18[Dismiss]
    J19[Edit fragment directly — Mode A]
  end

  subgraph Next_Run["Next Run"]
    J20[Loads new version of fragment]
    J21[Higher confidence — fewer escalations]
    J22[Health score improves over runs]
  end

  J1 --> J2 --> J3 --> J4
  J4 -->|No| J5
  J4 -->|Yes| J6 --> J7 --> J8 --> J9 --> J10 --> J11
  J5 --> J19 --> J16
  J11 --> J12 --> J13 --> J14 --> J15
  J15 --> J16
  J15 --> J17
  J15 --> J18
  J16 --> J20 --> J21 --> J22
  J17 --> J20
```

---

## 7. Onboarding a New User

First-time experience that establishes the "Handbook first" mental model before the user ever builds a graph.

```mermaid
flowchart TD
  subgraph New_User["New User"]
    L1([Joins workspace]) --> L2[Lands on Handbook — empty state]
    L2 --> L3[Reads: This is where your team's expertise lives]
    L3 --> L4{Choose path}
    L4 -->|Start with template| L5[Select a template\nContract Review / Customer Support / etc.]
    L4 -->|Import document| L6[Paste or upload existing SOP]
    L4 -->|Start blank| L7[Create first fragment manually]
    L5 --> L8[Template creates folder structure\nand starter fragments]
    L6 --> L9[System parses doc into fragments]
    L7 --> L10[Write first guideline in editor]
    L8 --> L11[User has a working Handbook]
    L9 --> L11
    L10 --> L11
    L11 --> L12[Go to Graphs → New Graph]
    L12 --> L13[Chat Designer opens]
    L13 --> L14[Describe first workflow]
    L14 --> L15[System builds draft graph]
    L15 --> L16[Link Handbook fragments to nodes]
    L16 --> L17[Activate graph]
    L17 --> L18[Trigger first run]
    L18 --> L19[See token count indicator — Stage 1 education]
    L19 --> L20([User completes onboarding])
  end

  subgraph System
    M1[Show empty Handbook state with framing copy]
    M2[Scaffold folder structure from template]
    M3[Parse document into fragments]
    M4[Show token count on first run — first health signal]
  end

  L2 --> M1
  L5 --> M2 --> L8
  L6 --> M3 --> L9
  L18 --> M4 --> L19
```

---

## 8. Run Triggered via API / External System

For automated pipelines where no human triggers the run manually.

```mermaid
sequenceDiagram
  participant Caller as External System / Agent
  participant API as Knotwork API
  participant Queue as Run Queue
  participant Runtime as LangGraph Runtime
  participant Operator as Graph Operator

  Caller->>API: POST /graphs/:id/runs { input, files }
  API->>API: Validate input & API key
  API->>Queue: Enqueue run
  API-->>Caller: { run_id, status: queued, eta_seconds: 180 }

  Queue->>Runtime: Execute run
  Runtime->>Runtime: Load graph & knowledge
  Runtime->>Runtime: Execute nodes sequentially / in parallel

  alt All nodes succeed
    Runtime->>API: Mark run completed
    API->>Caller: Webhook POST { run_id, status: completed, output }
  else Node escalates
    Runtime->>API: Pause run, create escalation
    API->>Operator: Notify via Telegram / WhatsApp / email
    Operator->>API: POST /escalations/:id/resolve { resolution }
    API->>Runtime: Resume run
    Runtime->>API: Mark run completed
    API->>Caller: Webhook POST { run_id, status: completed, output }
  else Run stopped (timeout)
    API->>Caller: Webhook POST { run_id, status: stopped }
  end

  Caller->>API: GET /runs/:run_id/nodes — inspect per-node results
```

---

## 9. Knowledge Domain Traversal

How the runtime loads knowledge fragments while respecting folder domains — preventing a legal node from loading finance content.

```mermaid
flowchart TD
  subgraph Node_Config["Node Config"]
    N1["Node references:\n• legal/contract-review.md\n• shared/company-tone.md"]
  end

  subgraph Traversal["Runtime Traversal"]
    N2["Compute active domains:\n{legal, shared}"]
    N3["Load legal/contract-review.md\ndomain: legal — active ✓"]
    N4["Load shared/company-tone.md\ndomain: shared — universal ✓"]
    N5{"Link: [[legal/red-flags]]\ndomain: legal — active?"}
    N6[Load legal/red-flags.md ✓]
    N7{"Link: [[finance/ratios]]\ndomain: finance — active?"}
    N8[Skip — not in active domains ✗]
    N9{"Link: [[shared/disclaimers]]\ndomain: shared — universal?"}
    N10[Load shared/disclaimers.md ✓]
    N11{"Already visited?"}
    N12[Skip — deduplication]
    N13[Build prompt:\nGUIDELINES = resolved tree\nTHIS CASE = run state + Run Context]
  end

  N1 --> N2 --> N3
  N2 --> N4
  N3 --> N5
  N5 -->|Yes| N6
  N5 -->|Loaded from shared too?| N11 --> N12
  N3 --> N7
  N7 -->|No| N8
  N4 --> N9
  N9 -->|Yes| N10
  N6 --> N13
  N10 --> N13
  N8 --> N13
```
