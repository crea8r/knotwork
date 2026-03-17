# Frontend Specification — Handbook (Knowledge Editor)

Named "Handbook" in the UI — not "Knowledge Base." The name sets the mental model before the user reads any copy.

File tree on the left, editor on the right (stacked on mobile).

## Handbook Chat (S7.2)

Handbook includes a chat panel where humans can ask an agent to help maintain knowledge structure and content.

Supported intents:
- reorder file/folder structure
- move/rename fragments
- merge/split fragments
- draft edits to file content

Interaction model:
- agent proposes operations as structured proposal cards
- no file mutation happens before approval
- human can `Approve`, `Reject`, or `Edit then approve`
- applied operations create normal handbook history/audit entries

## Empty State (new workspace)

```
┌────────────────────────────────────┐
│  Handbook                          │
│                                    │
│  This is where your team's         │
│  expertise lives.                  │
│                                    │
│  Write your procedures, guidelines │
│  and rules here. The clearer they  │
│  are, the more reliably your       │
│  agents will work.                 │
│                                    │
│  [ Start with a template ]         │
│  [ Import from a document ]        │
│                                    │
└────────────────────────────────────┘
```

## File Tree with Health Scores

```
┌────────────────────────────────────┐
│  Handbook                [+ File]  │
│                                    │
│  📁 legal                          │
│    📄 contract-review.md  ●●●●○    │  ← health score
│    📄 red-flags.md        ●●●●●    │
│  📁 finance                        │
│    📄 cfo-criteria.md     ●●○○○ ⚠  │  ← needs attention
│  📁 shared                         │
│    📄 company-tone.md     ●●●●○    │
│                                    │
│  ⚠ 1 fragment needs attention      │
│  [View all]                        │
└────────────────────────────────────┘
```

## File Editor with Health Breakdown

```
┌────────────────────────────────────┐
│  cfo-criteria.md     [History] [⚙] │
│  Owner: Nguyen Thi A · 2d ago      │
│                                    │
│  Health  ●●○○○  2.1               │
│  ├ Tokens   ●●●●○  in range       │
│  ├ Confidence ●○○○○  avg 0.51     │  ← shown after first run
│  ├ Escalations ●○○○○  8 in 12 runs│  ← shown after first run
│  └ Rating  ●●○○○  2.4 avg         │  ← shown after first rating
│                                    │
│  Resolved: 7,240 tokens  ⚠️ Too large│
│                                    │
│  ──────────────────────────────    │
│  # CFO Review Criteria             │
│                                    │
│  When reviewing financial terms... │
│                                    │
│  See also: [[finance/ratios]]      │
│                                    │
│  💡 3 improvement suggestions      │
│  [Review suggestions]              │
└────────────────────────────────────┘
```

Health sub-scores are revealed **progressively**: token count from day one, confidence and escalations after the first run, ratings after the first rating. Users are not confronted with empty metrics on a new fragment.

## Needs Attention List (owner view)

```
┌────────────────────────────────────┐
│  ⚠ Needs Attention         (3)     │
│                                    │
│  📄 cfo-criteria.md                │
│     ●●○○○  8 escalations · 12 runs │
│     Owner: Nguyen Thi A            │
│     💡 3 suggestions  [Review →]   │
│                                    │
│  📄 building-contract.md           │
│     ●○○○○  avg confidence 0.38     │
│     Owner: Tran Van B              │
│     [View →]                       │
└────────────────────────────────────┘
```
