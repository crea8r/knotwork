# Use Cases — Advanced

## Use Case 4: Improve Knowledge

**Primary actor:** Knowledge Worker (+ System for Mode B suggestions)
**Goal:** Improve a knowledge fragment based on run feedback

```mermaid
graph TD
  UC4_1[Run produces low rating or frequent escalations]
  UC4_2[System flags fragment — Mode A signal]
  UC4_3[System triggers improvement agent — Mode B]
  UC4_4[Agent reviews run context, output, knowledge snapshot, rating]
  UC4_5[Agent generates diff and rationale]
  UC4_6[Suggestion appears in Handbook editor]
  UC4_7[Knowledge Worker is notified]
  UC4_8[Worker reviews suggestion]

  UC4_9{Decision}
  UC4_10[Approve — new version saved]
  UC4_11[Edit — worker modifies, then saves]
  UC4_12[Dismiss — no change]
  UC4_13[Worker edits fragment directly — Mode A]

  UC4_14[Next run uses new version]
  UC4_15[Health score updates after next runs]

  UC4_1 --> UC4_2
  UC4_2 --> UC4_13
  UC4_2 --> UC4_3 --> UC4_4 --> UC4_5 --> UC4_6 --> UC4_7 --> UC4_8 --> UC4_9
  UC4_9 --> UC4_10 --> UC4_14
  UC4_9 --> UC4_11 --> UC4_14
  UC4_9 --> UC4_12
  UC4_13 --> UC4_14
  UC4_14 --> UC4_15
```

---

## Use Case 5: Operate via Chat (MCP)

**Primary actor:** Graph Operator using Telegram, WhatsApp, or Claude Desktop
**Goal:** Perform any operational action without opening the web app

```mermaid
graph TD
  UC5_1[Operator receives escalation notification on Telegram]
  UC5_2{Phase}
  UC5_3[Phase 1 — tap deep link → open in-app]
  UC5_4[Phase 2 — reply directly in Telegram via bot]

  UC5_5[Operator checks run status via Claude Desktop]
  UC5_6[Claude calls knotwork_get_run MCP tool]
  UC5_7[Claude returns summary to operator]

  UC5_8[Operator asks Claude to design a new workflow]
  UC5_9[Claude calls knotwork_design_graph MCP tool]
  UC5_10[Graph is created and available in web app]

  UC5_1 --> UC5_2
  UC5_2 -->|now| UC5_3
  UC5_2 -->|phase 2| UC5_4

  UC5_5 --> UC5_6 --> UC5_7
  UC5_8 --> UC5_9 --> UC5_10
```

---

## Use Case 6: External Agent as Knowledge Worker

**Primary actor:** External Agent (via ed25519 auth + JWT + MCP)
**Goal:** Keep a knowledge fragment up to date autonomously

```mermaid
graph TD
  UC6_1[External agent reads assigned knowledge fragment]
  UC6_2[Agent processes new data — market update, regulation change, etc.]
  UC6_3{Mode C enabled\non this fragment?}
  UC6_4[Agent commits update directly\nLogged in audit trail]
  UC6_5[Agent creates suggestion\nWaits for human approval]
  UC6_6[Fragment owner is notified]
  UC6_7[Owner reviews and approves or rejects]
  UC6_8[New version is saved]
  UC6_9[Next run uses updated knowledge]

  UC6_1 --> UC6_2 --> UC6_3
  UC6_3 -->|yes| UC6_4 --> UC6_8
  UC6_3 -->|no| UC6_5 --> UC6_6 --> UC6_7 --> UC6_8
  UC6_8 --> UC6_9
```
