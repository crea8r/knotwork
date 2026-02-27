# Knowledge System — File Linking

## Wiki-style Links

Inside a fragment, reference other fragments with double-bracket links:

```markdown
# Contract Review Guide

When reviewing a purchase contract, always check:

- Valuation methodology: see [[valuation-checklist]]
- Common red flags: see [[red-flags]]
- Approval thresholds: see [[approval-thresholds]]
```

At run time, the agent loads the root fragment and recursively fetches all linked fragments. The full resolved tree is the agent's knowledge context for that node.

---

## Folder-as-Domain Traversal

The folder structure defines **knowledge domains**. When traversing transitive links, the runtime uses these domains to filter what gets loaded:

- **`shared/` and root-level files** are universal — their transitive links are always followed
- **Domain-folder files** (`legal/`, `finance/`, `operations/`, etc.) are domain-scoped — their transitive links are only followed if that domain is active in the current traversal

**Active domains** = the union of folder domains of all files the node directly references.

Example:

```text
Node references: [legal/contract-review-guide.md, shared/company-tone.md]
Active domains:  {legal, shared}

Traversal:
  shared/company-tone.md (shared → universal)
    → shared/legal-disclaimers.md     domain: shared  → follow ✓
    → finance/financial-ratios.md     domain: finance → NOT active → skip ✓

  legal/contract-review-guide.md (domain: legal → active)
    → legal/red-flags.md              domain: legal   → follow ✓
    → legal/approval-thresholds.md    domain: legal   → follow ✓
    → finance/financial-ratios.md     domain: finance → NOT active → skip ✓
```

The legal node loads only legal and shared content — never finance content — without any explicit configuration. The folder structure the user naturally creates is sufficient.

If a finance node genuinely needs a legal file, the user directly references it on the node. Direct references always load, regardless of domain.

---

## Loop and Duplication Prevention

A visited set ensures each file is loaded exactly once, regardless of how many paths reference it. Circular links are handled automatically — a file already in the visited set is skipped.

---

## Link Resolution Rules

- Links are resolved relative to the current file's folder, then workspace root
- Missing links (file not found) are logged as warnings and skipped — they do not fail the run
- External URLs in links are not fetched (they remain as text references)
