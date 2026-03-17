# Knowledge System — Health & Education

## Knowledge Health

Every fragment has a **health score** — a 0–5 rating that reflects how reliably it performs in production. This is the primary signal users get about whether their knowledge is working.

Health is not a technical metric. It is a business outcome indicator.

### What Feeds into Health

| Signal | Weight | Source |
|--------|--------|--------|
| Token count in healthy range | 20% | Computed on save |
| Average confidence score across recent runs | 30% | RunNodeState |
| Escalation rate of nodes using this fragment | 25% | Escalation records |
| Average human rating for nodes using this fragment | 25% | Rating records |

Staleness (days since last update) is surfaced separately as an advisory flag, not baked into the score.

### How It Is Displayed

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

### Health as a Team KPI

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

The token count warning is the first piece of feedback new users see. More detailed health signals are introduced progressively as users gain experience.

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

### Celebrating Good Knowledge

When a fragment consistently drives high-confidence, well-rated outputs, the system acknowledges it:

> "contract-review-guide.md has performed reliably across 47 runs. Your agents are executing this process well."

Positive reinforcement matters as much as warnings.
