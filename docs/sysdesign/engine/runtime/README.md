# Runtime

LangGraph execution internals.

- **overview.md** — How `GraphDefinition` is compiled into a LangGraph `StateGraph` and executed.
- **execution.md** — `AgentAdapter` ABC, `NodeEvent` types, adapter implementations (Claude, OpenAI, Human).
- **knowledge-loading.md** — `load_knowledge_tree()`: folder-as-domain traversal, token budgets, caching.
- **reliability.md** — Checkpointing, run recovery, timeout handling, idempotency.
