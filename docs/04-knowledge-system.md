# Knowledge System

## Purpose and Philosophy

The knowledge base is your company handbook — not a file storage system.

It exists for one purpose: to tell your agents **how to work**. Guidelines, SOPs, procedures, checklists, templates, rules of thumb, red flags, and quality criteria. Content that is timeless, reusable, and prescriptive.

Case-specific files — a client's contract, a customer's order, a specific property document — belong in the **Run Context** (attached when triggering a run), not here. The knowledge base should never contain "John Smith's contract from March 2024." It should contain "How to review a purchase contract."

This distinction is the foundation of reliable agents. When the system loads a knowledge fragment, it assumes the content describes *how to do something*, not *what happened in a specific case*. Mixing these produces agents that confuse general rules with specific instances.

The UI, the suggested folder structure, and the onboarding flow are all designed to nudge users toward this mental model — gradually, through experience, not through rules.

---

## Mental Model

Knowledge is organised exactly like files on a computer — or notes in Obsidian. Users see **folders and files**. No new concepts to learn.

```text
knowledge/
  company/
    code-of-conduct.md
    communication-guidelines.md
  legal/
    contract-review-guide.md
    red-flags.md
    approval-thresholds.md
  finance/
    cfo-review-criteria.md
    financial-ratios.md
  shared/
    company-tone.md
    legal-disclaimers.md
  templates/
    contract-summary-template.md
```

The suggested top-level structure is: `company/`, department folders, `shared/`, `templates/`. There is no `cases/` or `clients/` folder — the absence is intentional.

Each `.md` file is a **Knowledge Fragment**. Files link to each other using `[[wiki-style links]]`.

---

## Knowledge Base vs Run Context

Two separate spaces. Two different mental models.

| | Knowledge Base | Run Context |
|-|----------------|-------------|
| **What goes here** | Guidelines, SOPs, procedures, templates | Case files, contracts, client data, specific documents |
| **When it's created** | Deliberately, between runs | At the moment of triggering a run |
| **Lifespan** | Persists and improves over time | Belongs to one run |
| **Mental model** | Company handbook | Today's work |
| **In the UI** | "Handbook" — wiki-like editor | "Start a task" — file upload form |

When a legal director triggers a contract review run, she uploads the specific contract as a Run Context attachment. The knowledge base contains her team's review procedures. The agent gets both — but it knows which is which.

---

## File Linking

Inside a fragment, reference other fragments with double-bracket links:

```markdown
# Contract Review Guide

When reviewing a purchase contract, always check:

- Valuation methodology: see [[valuation-checklist]]
- Common red flags: see [[red-flags]]
- Approval thresholds: see [[approval-thresholds]]
```

At run time, the agent loads the root fragment and recursively fetches all linked fragments. The full resolved tree is the agent's knowledge context for that node.

### Folder-as-domain traversal

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

### Loop and duplication prevention

A visited set ensures each file is loaded exactly once, regardless of how many paths reference it. Circular links are handled automatically — a file already in the visited set is skipped.

### Link resolution rules

- Links are resolved relative to the current file's folder, then workspace root
- Missing links (file not found) are logged as warnings and skipped — they do not fail the run
- External URLs in links are not fetched (they remain as text references)

---

## Versioning

Every time a fragment is saved, a new version is created automatically. No drafts, no manual version management — just save and the history is there.

Each version has:

- `version_id` — unique identifier (provided by storage layer)
- `saved_at` — timestamp
- `saved_by` — user or agent that made the change
- `change_summary` — optional short note about what changed

Users can view version history and restore any previous version from the knowledge editor.

### Version snapshot in runs

When a node executes, the runtime records the exact `version_id` of every file in the resolved knowledge tree. This snapshot is stored in `RunNodeState`.

This means:

- You can always replay a run with the exact knowledge that was used
- You can compare two runs to see if knowledge changed between them
- Rating feedback is always attached to a specific knowledge version

---

## Storage

Knowledge files are stored through a **StorageAdapter** abstraction:

```text
StorageAdapter
  read(path) → content
  write(path, content) → version_id
  list(folder) → [path]
  history(path) → [version]
  restore(path, version_id) → version_id
  delete(path)
```

Implementations:

- **LocalFSAdapter** — files on disk with a version table in PostgreSQL (dev / self-hosted)
- **S3Adapter** — files in S3 with object versioning enabled (cloud production)

Switching adapters requires no changes to application code.

### PostgreSQL knowledge index

The database stores metadata only — not file content:

```text
knowledge_files
  id                    uuid
  workspace_id          uuid
  path                  text        -- "legal/contract-review-guide.md"
  title                 text        -- first H1 or filename
  owner_id              uuid
  raw_token_count       int         -- this file only
  resolved_token_count  int         -- full linked tree (updated on save)
  linked_paths          text[]      -- direct [[links]] in this file
  current_version_id    text
  health_score          float       -- 0.0–1.0, computed (see Knowledge Health)
  health_updated_at     timestamptz
  created_at            timestamptz
  updated_at            timestamptz
```

---

## Knowledge Health

Every fragment has a **health score** — a 0–5 rating that reflects how reliably it performs in production. This is the primary signal users get about whether their knowledge is working.

Health is not a technical metric. It is a business outcome indicator.

### What feeds into health

| Signal | Weight | Source |
|--------|--------|--------|
| Token count in healthy range | 20% | Computed on save |
| Average confidence score across recent runs | 30% | RunNodeState |
| Escalation rate of nodes using this fragment | 25% | Escalation records |
| Average human rating for nodes using this fragment | 25% | Rating records |

Staleness (days since last update) is surfaced separately as an advisory flag, not baked into the score.

### How it is displayed

```text
📄 contract-review-guide.md
   ●●●●○  Good  (4.1)
   47 runs · avg confidence 0.84 · 1 escalation

📄 cfo-review-criteria.md
   ●●○○○  Needs attention  (2.1)
   12 runs · avg confidence 0.51 · 8 escalations
   💡 3 improvement suggestions
```

Health is shown in the file tree, the node configuration panel, and the post-run inspection screen. It is always connected to the relevant context so users understand what it means.

### Health as a team KPI

Workspace owners can see an aggregate health view across the entire knowledge base. Fragments below a threshold appear in a "Needs Attention" list. This makes knowledge quality a measurable, manageable business concern — not an invisible technical detail.

---

## Knowledge Size Flagging

Token count affects cost and quality. Knotwork flags when a node's resolved knowledge tree is outside a healthy range.

`resolved_token_count` = total tokens of the fully resolved tree (root + all linked fragments, deduplicated, filtered by domain). Recalculated on every save.

| Signal | Default threshold | Meaning |
|--------|------------------|---------|
| Too sparse | < 300 tokens | Likely insufficient context for the agent |
| Too large | > 6,000 tokens | Expensive and may dilute focus |

These are workspace-level defaults. They are advisory — shown as warnings, not blockers.

The token count warning is the first piece of feedback new users see. More detailed health signals are introduced progressively as users gain experience (see Progressive Education below).

---

## Progressive Education

The product teaches users that knowledge quality determines agent quality — not through instructions, but through lived experience. The education is gradual and tied to observable outcomes.

### Stage 1 — First week

Show: token count warning only. Keep it simple.
Message: "This fragment may be too large. Agents work best with focused context."

### Stage 2 — After first run

Show: confidence scores on nodes, connected to the knowledge used.
Message: "This node had low confidence. The knowledge driving it has a health score of 2/5."

### Stage 3 — After several runs

Show: escalation rate per fragment. Trend over time.
Message: "This fragment causes frequent pauses. Here are 3 suggestions for improving it."

### Stage 4 — Established user

Show: full health dashboard, knowledge health as a team KPI, improvement loop analytics.

At each stage, the connection between knowledge quality and agent behaviour is made explicit. Users do not need to believe the philosophy upfront — they learn it through the consequences of good and poor knowledge.

### Celebrating good knowledge

When a fragment consistently drives high-confidence, well-rated outputs, the system acknowledges it:

> "contract-review-guide.md has performed reliably across 47 runs. Your agents are executing this process well."

Positive reinforcement matters as much as warnings.

---

## Access Control

Knowledge files use a simple file-sharing model. Users see files and folders — no new permission concepts.

**Ownership**: Every file has one owner. The owner can edit and share the file.

**Sharing**: An owner can share a file with specific users (read or edit), a role, or the whole workspace.

**Inheritance**: A folder can have default access that new files inside it inherit.

**External agents**: An agent (via API key with scoped permissions) can be granted read or write access to specific files or folders. All writes are versioned and logged identically to human edits.

---

## Shared Fragments

A fragment lives in the workspace knowledge base and can be referenced by any number of nodes across any number of graphs.

`shared/company-tone.md` might be referenced by nodes in the customer support graph, the marketing content graph, and the contract summary graph. When it is updated, all graphs benefit immediately on their next run.

---

## Improvement Loop

Ratings and escalation outcomes feed into knowledge improvement.

### Mode A: Human-driven (always on)

Low ratings and frequent escalations surface flags on the relevant fragment. The owner sees: "This fragment received a low rating in 3 recent runs. Consider reviewing it." The human edits the file. A new version is saved.

### Mode B: Agent-assisted (default)

After a low-rated run, the system triggers an improvement agent. The agent:

1. Reviews the run input, output, knowledge snapshot, and rating feedback
2. Proposes specific edits to the fragment (shown as a diff with rationale)
3. Creates a suggestion in the knowledge editor

The human reviews and approves, edits, or dismisses. Nothing is saved without human approval in Mode B.

### Mode C: Autonomous (opt-in per fragment)

The same agent as Mode B, but with write access. It commits changes directly. Every autonomous edit is logged in the audit trail with full diff and rationale, and is revertable by any user with edit access. Mode C is disabled by default — enabled per-fragment by the owner.

---

## External Agent as Knowledge Worker

An external agent can be granted file access via API key with scoped permissions. Use cases:

- A research agent that keeps a market data fragment up to date
- An external expert's agent that maintains a specialised domain fragment
- A quality agent that reviews and improves fragments based on run history

All writes are versioned and logged identically to human edits.

---

## Knowledge Editor (UI)

- **File tree** — folder/file navigation with health score indicators per file
- **Markdown editor** — rich text or raw markdown, with `[[link]]` autocomplete
- **Link graph** — visual view of how fragments connect, with domain colouring
- **Token meter** — live token count for this file and the resolved tree
- **Health score** — live health indicator, broken down by signal
- **Version history** — timeline of all saves, diff viewer, restore
- **Suggestions** — Mode B improvement suggestions waiting for review
- **Usage** — which nodes and graphs reference this fragment
- **"Needs Attention" list** — workspace-wide view of low-health fragments, grouped by owner
