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
   ├── 4b. Execute node
   │       LLM Agent: call LLM with knowledge + state + tools
   │       Human Checkpoint: pause, notify human, wait
   │       Conditional Router: evaluate condition, select edge
   │       Tool Executor: invoke tool, return result
   │
   ├── 4c. Evaluate output
   │       Run checkpoint rules
   │       Score confidence (structured output + rule signals)
   │       If checkpoint fails: apply fail-safe → retry → escalate
   │       If confidence low: escalate to human
   │
   ├── 4d. Persist RunNodeState
   │       input, output, knowledge_snapshot, confidence, status
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
| Model abstraction | LangChain model interface | Any provider, swappable per node |
