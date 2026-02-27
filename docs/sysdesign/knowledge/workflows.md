# Knowledge System — Workflows & Improvement

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
