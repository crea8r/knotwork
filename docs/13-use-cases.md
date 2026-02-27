# Use Cases

## Actors

| Actor | Description |
|-------|-------------|
| **Graph Designer** | Builds and edits workflows. Configures nodes, knowledge, tools, access. Usually the team lead or process owner. |
| **Graph Operator** | Runs workflows daily. Handles escalations, rates outputs. May be the same person as the Designer in small teams. |
| **Knowledge Worker** | Owns and maintains specific knowledge fragments. May be an internal employee or an external agent. |
| **External Agent** | An automated system (Claude, custom agent, MCP client) granted access to read or write knowledge, or trigger runs. |
| **System** | The Knotwork runtime — LangGraph engine, notification dispatcher, health scorer. |

---

## System Overview

```mermaid
graph TD
  subgraph Designers["Graph Designer"]
    D1[Design workflow via chat]
    D2[Import workflow from MD file]
    D3[Refine graph on canvas]
    D4[Configure node knowledge]
    D5[Configure tools & checkpoints]
    D6[Manage roles & access]
    D7[View knowledge health]
  end

  subgraph Operators["Graph Operator"]
    O1[Trigger a run]
    O2[Attach case files — Run Context]
    O3[Monitor active run live]
    O4[Handle escalation]
    O5[Rate node output]
    O6[View run history & inspect nodes]
    O7[Receive notifications]
  end

  subgraph KW["Knowledge Worker"]
    K1[Create & edit knowledge fragments]
    K2[Review improvement suggestions]
    K3[Restore previous version]
    K4[Share fragment with team]
    K5[View fragment usage & health]
  end

  subgraph EA["External Agent / API"]
    E1[Trigger run via API]
    E2[Read knowledge fragments]
    E3[Write knowledge fragments — Mode C]
    E4[Resolve escalation via MCP]
    E5[Design workflow via MCP chat]
  end

  subgraph SYS["System — Knotwork Runtime"]
    S1[Execute graph nodes]
    S2[Evaluate confidence & checkpoints]
    S3[Escalate to human]
    S4[Send notifications]
    S5[Snapshot knowledge versions per run]
    S6[Compute knowledge health score]
    S7[Generate improvement suggestions — Mode B]
  end

  D1 -->|produces| D3
  D2 -->|imports into| D3
  D3 -->|activates| O1
  O1 -->|triggers| S1
  S1 -->|may trigger| S3
  S3 -->|notifies| O7
  O7 -->|leads to| O4
  O4 -->|resumes| S1
  O5 -->|feeds| S6
  S6 -->|may trigger| S7
  S7 -->|surfaces to| K2
  K2 -->|approves into| K1
  E1 -->|triggers| S1
  E5 -->|produces| D3
```

---

## Use Case 1: Design a Workflow

**Primary actor:** Graph Designer
**Goal:** Create a working agent graph from scratch or from an existing document

```mermaid
graph TD
  UC1_1[Describe process in chat]
  UC1_2[System proposes graph structure]
  UC1_3[Designer refines via follow-up messages]
  UC1_4[Designer switches to canvas to adjust]
  UC1_5[Designer configures each node]
  UC1_6[Designer links knowledge fragments]
  UC1_7[Designer configures tools & checkpoints]
  UC1_8[Designer activates graph]

  UC1_A[Import existing MD workflow]
  UC1_B[System parses MD into draft graph]

  UC1_1 --> UC1_2 --> UC1_3 --> UC1_4
  UC1_A --> UC1_B --> UC1_4
  UC1_4 --> UC1_5 --> UC1_6 --> UC1_7 --> UC1_8

  style UC1_A fill:#e8f4f8,stroke:#aac
  style UC1_B fill:#e8f4f8,stroke:#aac
```

**Alternate path:** Designer pastes an existing MD document (e.g. an n8n flow description, a process SOP). The system scaffolds the graph from it. The designer reviews and adjusts on the canvas rather than starting from scratch.

---

## Use Case 2: Execute a Run

**Primary actor:** Graph Operator
**Goal:** Run a workflow on a specific case and get a result

```mermaid
graph TD
  UC2_1[Operator opens graph]
  UC2_2[Operator fills run trigger form]
  UC2_3[Operator attaches case files — Run Context]
  UC2_4[System queues run, returns run_id and ETA]
  UC2_5[Operator monitors live on canvas]

  UC2_6[All nodes complete]
  UC2_7[Run pauses — escalation]

  UC2_8[Run completed]
  UC2_9[Operator reviews output & rates nodes]

  UC2_10[Operator handles escalation]
  UC2_11[Run resumes]

  UC2_1 --> UC2_2 --> UC2_3 --> UC2_4 --> UC2_5
  UC2_5 --> UC2_6 --> UC2_8 --> UC2_9
  UC2_5 --> UC2_7 --> UC2_10 --> UC2_11 --> UC2_5
```

---

## Use Case 3: Handle an Escalation

**Primary actor:** Graph Operator
**Goal:** Review an agent's uncertain or flagged output and decide what to do

```mermaid
graph TD
  UC3_1[Operator receives notification\nTelegram / WhatsApp / email / in-app]
  UC3_2[Operator opens escalation in-app]
  UC3_3[Operator reviews agent output and context]

  UC3_4{Decision}

  UC3_5[Approve — accept output as-is]
  UC3_6[Edit — modify output directly]
  UC3_7[Guide — write instructions for retry]
  UC3_8[Abort — stop the run]

  UC3_9[Run resumes with approved output]
  UC3_10[Run resumes with edited output]
  UC3_11[Node retries with guidance in prompt]
  UC3_12[Run stopped — owner notified]

  UC3_1 --> UC3_2 --> UC3_3 --> UC3_4
  UC3_4 --> UC3_5 --> UC3_9
  UC3_4 --> UC3_6 --> UC3_10
  UC3_4 --> UC3_7 --> UC3_11
  UC3_4 --> UC3_8 --> UC3_12

  UC3_11 -->|if still low confidence| UC3_1
```

---

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

**Primary actor:** External Agent (via API key + MCP)
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
