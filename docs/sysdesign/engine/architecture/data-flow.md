# Architecture — Data Flow & Deployment

## Data Flow: Run Execution

```
1. Trigger (API call or manual)
   │
2. API creates Run record (status: queued), returns run_id + ETA
   │
3. Runtime picks up run, resolves graph definition
   │
4. For each node (parallel where graph allows):
   │
   ├── 4a. Load knowledge tree
   │       Fetch all linked .md files via StorageAdapter
   │       Snapshot version IDs → log to RunNodeState
   │       Flag if token count outside configured range
   │
   ├── 4b. Execute node (dispatch to AgentAdapter)
   │       Anthropic agent:  Claude tool-calling loop → NodeEvent stream
   │       OpenAI agent:     Assistants API poll loop → NodeEvent stream
   │       Human agent:      Emit escalation event → interrupt LangGraph
   │       LEGACY Conditional Router type:
   │                         executes via AgentAdapter and sets `next_branch`
   │
   ├── 4c. Evaluate output
   │       Run checkpoint rules
   │       Score confidence (agent-reported + rule signals)
   │       If checkpoint fails or confidence low → create escalation → interrupt
   │
   ├── 4d. Persist RunNodeState
   │       input, output, knowledge_snapshot, confidence, status, agent_ref
   │       Worklog entries → run_worklog_entries
   │       Handbook proposals → run_handbook_proposals
   │
   └── 4e. Pass state to next node(s)
       │
5. Run completes → status: completed | failed | stopped
   │
6. Trigger post-run hooks (rating prompt, notifications, webhooks)
```

## Deployment (Cloud-First)

```
                    ┌─────────────────┐
                    │   CDN / Edge    │  Static frontend assets
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Load Balancer  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼──┐   ┌───────▼───┐   ┌─────▼──────┐
     │ API       │   │ Runtime   │   │ Worker     │
     │ (FastAPI) │   │ (LangGraph│   │ (Async     │
     │           │   │  Engine)  │   │  runs,     │
     └────────┬──┘   └───────┬───┘   │  notify)   │
              │              │       └─────┬──────┘
              └──────────────┼─────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼──┐   ┌───────▼───┐   ┌─────▼──────┐
     │ PostgreSQL│   │   S3      │   │  Queue     │
     │           │   │  (files)  │   │  (runs)    │
     └───────────┘   └───────────┘   └────────────┘
```

Phase 1 targets a single-region cloud deployment. Self-hosted is a Phase 2 option unlocked by the storage adapter abstraction already in place.

## Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage abstraction | Adapter pattern | Swap local FS → S3 without changing business logic |
| Knowledge versioning | Storage-layer versioning (S3) + DB index | Versioning is automatic, no Git complexity for users |
| Run state persistence | After every node | Enables resume, replay, and full inspection |
| Execution engine | LangGraph | Native support for conditional edges, parallel nodes, human interrupts, checkpointing |
| API style | REST + WebSocket | REST for CRUD, WebSocket for real-time run progress |
| Async runs | Queue + worker | Long runs don't block API; ETA returned on trigger |
| Agent abstraction | AgentAdapter ABC | Any agent provider (Claude, OpenAI, custom) pluggable per node |
| Agent credentials | RegisteredAgent table | Per-workspace API keys; env-var fallback for <span style="color:#c1121f;font-weight:700">LEGACY</span> nodes |
