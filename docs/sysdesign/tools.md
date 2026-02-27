# Tool Registry

## Purpose

Tools allow agents to act, not just reason. They also allow humans to inject known logic and data into workflows — making agents faster and cheaper by offloading deterministic decisions from LLM calls.

A tool that answers "what is the current USD/VND exchange rate?" should not require an LLM to reason through it. It should just fetch the rate.

---

## Tool Categories

### Function Tool

A Python function exposed to the LLM via tool-use (function calling). The LLM decides when to call it and with what arguments.

Use for: computations, data transformations, domain logic that can be expressed as code.

```python
@tool
def calculate_irr(cash_flows: list[float], initial_investment: float) -> float:
    """Calculate internal rate of return for a series of cash flows."""
    ...
```

### HTTP Tool

An external API call. No code required — configured entirely in the UI.

Use for: third-party services, internal APIs, webhooks.

```yaml
name: exchange-rate
method: GET
url: "https://api.exchangerate.host/latest?base=USD&symbols=VND"
output_mapping:
  vnd_rate: "$.rates.VND"
```

### RAG Tool

Retrieves semantically relevant chunks from a document collection. Used when the knowledge is too large to load in full, or when the relevant section depends on the query.

Phase 1: built-in support for indexing uploaded documents (PDF, DOCX, TXT).

```yaml
name: contract-clauses-search
index: contract-clause-library
top_k: 5
```

### Lookup Tool

Structured data queried by key. Faster and cheaper than LLM reasoning for known values.

Use for: product catalogs, pricing tables, tax rates, country codes, classification schemes.

```yaml
name: hotel-category-lookup
type: json_table
data: "tools/data/hotel-categories.json"
key_field: "category_code"
```

### Rule Tool

Deterministic logic encoded as human-defined rules. The rules are written in plain language by operators and stored in the tool registry. The tool evaluates the rules against input and returns a result.

Use for: approval conditions, classification logic, routing decisions that follow known business rules.

```yaml
name: contract-approval-required
rules:
  - if: "contract_value > 10000000000"
    result: { approval_required: true, approver: "cfo" }
  - if: "contract_type == 'land_purchase'"
    result: { approval_required: true, approver: "asset_owner" }
  - default:
    result: { approval_required: false }
```

---

## Tool Scoping

Tools exist at three scopes:

| Scope | Visible to |
|-------|-----------|
| **Workspace** | All graphs and nodes in the workspace |
| **Graph** | Only nodes within that graph |
| **Node** | Only that node (inline tool, not reusable) |

Most tools should be workspace-scoped for reuse. Graph-scoped tools are useful for tools that are specific to one workflow's logic. Node-scoped tools are for one-off needs.

---

## Tool Registry UI

The tool registry screen (owner access) lets users:

- Browse all tools by category and scope
- Create new tools (form-based for HTTP, Lookup, Rule; code editor for Function)
- Test a tool with sample inputs before attaching it to a node
- View which nodes and graphs use each tool
- Manage versions (tools are also versioned; a node references a tool at a specific version or "latest")

---

## Built-in Tools (Phase 1)

Knotwork ships with a set of built-in workspace tools available in every workspace:

| Tool | Category | Description |
|------|----------|-------------|
| `web.search` | HTTP | Web search (via configured search API) |
| `web.fetch` | HTTP | Fetch and extract text from a URL |
| `file.read` | Function | Read a file from the run's file attachments |
| `text.extract` | Function | Extract structured fields from unstructured text |
| `date.now` | Function | Current date and time in a specified timezone |
| `math.calculate` | Function | Safe arithmetic expression evaluator |
| `notify.send` | HTTP | Send a notification to a channel |

Built-in tools cannot be deleted. They can be disabled at the workspace level.

---

## Tool Execution and Cost

| Category | Latency | LLM cost | Notes |
|----------|---------|----------|-------|
| Function | Low | None | Pure compute |
| HTTP | Variable | None | Depends on external API |
| Lookup | Very low | None | In-memory or DB query |
| Rule | Very low | None | Pure evaluation |
| RAG | Medium | Embedding only | No LLM generation |

Prefer Rule, Lookup, and Function tools for known business logic. Reserve LLM Agent nodes for reasoning tasks that genuinely require language understanding.

---

## Tools as Human Knowledge

The tool registry is where human expertise is encoded as reusable logic. When an expert knows the answer — the pricing table, the approval matrix, the classification rules — that knowledge should live in a tool, not in a prompt.

This is the primary cost-reduction lever in Knotwork. Every decision encoded as a Rule or Lookup tool is a decision the LLM does not need to reason through.
