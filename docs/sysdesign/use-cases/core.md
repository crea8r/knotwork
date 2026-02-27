# Use Cases — Core

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

**Alternate path:** Designer pastes an existing MD document. The system scaffolds the graph from it. The designer reviews and adjusts on the canvas rather than starting from scratch.

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
