# Knowledge System — Overview

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
