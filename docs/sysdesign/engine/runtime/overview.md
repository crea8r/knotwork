# Runtime Specification — Overview & Compilation

## Overview

The Knotwork runtime converts a graph definition into a LangGraph execution graph and runs it. LangGraph provides the execution backbone: conditional edges, parallel node execution, state management, and human interrupts.

---

## LangGraph Mapping

| Knotwork concept | LangGraph concept |
|-----------------|-------------------|
| Graph | `StateGraph` |
| Node | Node function added via `graph.add_node()` |
| Direct edge | `graph.add_edge()` |
| Conditional edge | `graph.add_conditional_edges()` |
| Run state | `TypedDict` state schema |
| Human escalation | `interrupt()` |
| Checkpointing | `MemorySaver` / `PostgresSaver` |
| Parallel nodes | Fan-out edges to multiple nodes |

---

## Run State Schema

The run state is a typed dictionary that flows through all nodes. Its structure is defined by the graph's input/output mappings across all nodes.

```python
class RunState(TypedDict):
    # System fields (always present)
    run_id: str
    graph_id: str
    current_node_id: str
    escalation_pending: bool
    error: Optional[str]

    # User-defined fields (from graph input/output mappings)
    # e.g.:
    contract_type: Optional[str]
    contract_file_url: Optional[str]
    asset_valuation: Optional[dict]
    financial_analysis: Optional[dict]
    legal_review: Optional[dict]
    final_recommendation: Optional[str]
```

The state schema is inferred from all node input/output mappings when the graph is compiled. Any field referenced in any mapping is added to the schema.

---

## Graph Compilation

Before a graph can run, it is compiled from the stored definition.

```python
def compile_graph(graph_def: GraphDefinition) -> CompiledGraph:
    builder = StateGraph(RunState)

    for node in graph_def.nodes:
        fn = build_node_function(node)
        builder.add_node(node.id, fn)

    for edge in graph_def.edges:
        if edge.type == "direct":
            builder.add_edge(edge.source, edge.target)
        elif edge.type == "conditional":
            builder.add_conditional_edges(
                edge.source,
                build_router_function(edge.source_node),
            )

    builder.set_entry_point(graph_def.entry_node_id)
    builder.set_finish_point(graph_def.exit_node_id)

    checkpointer = PostgresSaver(db_pool)
    return builder.compile(checkpointer=checkpointer)
```

Compiled graphs are cached in memory. The cache is invalidated when a graph definition changes.
