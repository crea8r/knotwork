# Frontend — Shared UX Patterns

Reusable interaction patterns used across multiple surfaces. Each pattern captures the
behaviour contract, not the pixel-level implementation.

---

## ProjectDashboard — Collapsible Status Header

Used at the top of the project home view (above the project-wide channel).

**Authorship:** The human can write the status summary directly (via the "Update" button),
or configure a system prompt so an agent generates it automatically. Both are valid.
Without any agent configured, the human is the sole author.

**Behaviour:**
- Header row is always visible: shows `latest_status_update.summary` if set, otherwise `project.description` or `project.title`
- ChevronDown icon indicates collapsed/expanded state
- Collapsed state persisted in `localStorage('kw-dash-collapsed-{projectId}')`
- **Auto-expands** when a new status update is posted (by agent or human) with a timestamp newer than last-seen (`localStorage('kw-dash-seen-{projectId}')`)
- On expand: last-seen timestamp is updated so the auto-expand triggers only once per new update
- "+ Objective" and "Update" buttons always visible in the header row regardless of collapsed state

**When expanded:**
- List of objectives with status badge, title/code, and progress %
- Each objective is clickable → navigates to `/objectives/:id`
- Empty state: "No objectives yet. Add one to track what this project is trying to achieve."

---

## ProjectInnerSidebar — Channel List Navigation

Left sidebar within a project. Replaces the global app sidebar for project-internal navigation.

**Structure:**
```
★  Project title          ← always pinned (home view)
#  Objective A            ← recent slot 1 (sorted by updated_at desc)
#  Objective B            ← recent slot 2
   + N more               ← shows when > 2 objectives; click to expand
──────────────────────
   Assets                 ← assets view
```

**Behaviour:**
- Active item highlighted with `bg-brand-50 text-brand-700`
- "N more" toggled locally with `useState`; no persistence needed (navigation context makes it clear)
- Sorted by `updated_at` descending — most recently touched objective surfaces to the top
- `VISIBLE_SLOTS = 2` is a constant; future: replace with last-channel-message timestamp

---

## Review Queue — Agent-Prepared Work Items

Used in Knowledge → Review tab.

**Empty state:**
```
✅  All caught up
No strategic work pending. The agent will surface improvements as your workflows run.
```
This is a valid state, styled positively (green icon, calm copy). Could mean the agent
found nothing, or no agent is configured. Either way, the Assets tab is always
available for direct editing.

**Items present:**
- Each `ProposalCard` shows: file path (monospace), reason (plain text), expandable proposed content (`<pre>` block, max-height capped), Approve + Reject buttons
- Approve calls `approve.mutate({ id, final_content: proposal.proposed_content })`
- Reject calls `reject.mutate(id)`
- Loading state on both buttons while mutation pending
- Cards are stacked vertically, full-width, in a scrollable container

**Default tab selection:**
- If pending proposals exist and user has not explicitly chosen a tab: default to Review
- Tab choice persisted in `localStorage('kw-knowledge-tab')`

---

## Unified Asset Tree

Used in Project → Assets view and Knowledge → Assets tab.

Files (`.md`, PDFs, other docs) and workflows share one file tree. A workflow is a
file that happens to be runnable. The distinction is revealed when opened, not from
the navigation label.

**Visual differentiation:**
- Markdown files: standard file icon
- Workflows: workflow icon (distinct but same tree depth)

**Knowledge Assets vs Project Assets:**
- Knowledge: global handbook files + global workflows; no Run button; "Run in project..." bridges to Work
- Project Assets: project-scoped docs + project-scoped workflows; run triggers live in ObjectiveDetailPage

---

## Objective Status Badge

Used in ProjectDashboard, ProjectInnerSidebar, and ObjectiveDetailPage.

| Status value | Badge colour |
|---|---|
| `done`, `completed` | green |
| `blocked`, `failed` | red |
| `in_progress`, `running` | orange |
| anything else | gray |

Status text is displayed with underscores replaced by spaces.

---

## Token Warning Badge

Shown where a knowledge file's resolved token count is outside acceptable range:

- `⚠️ 7,240 tokens — too large` (orange, `>6000`)
- `⚠️ 210 tokens — too sparse` (yellow, `<300`)

Thresholds are workspace-configurable.

---

## Knowledge Health Indicator

Shown in the file tree, node config panel, and post-run screens:

| Display | Colour | Score range |
|---|---|---|
| `●●●●●` | green | 4.5 – 5.0 |
| `●●●●○` | green | 3.5 – 4.4 |
| `●●●○○` | yellow | 2.5 – 3.4 |
| `●●○○○` | orange | 1.5 – 2.4 |
| `●○○○○` | red | < 1.5 |

Sub-scores hidden when no data; never shown as zero.

---

## Run ETA

Shown as a countdown during active runs. Computed from historical run times for the
graph. Displayed as "~X min left" on dashboard and run detail screens.

---

## Node Status Icons

| Status | Icon | Colour |
|---|---|---|
| pending | ⏳ | Grey |
| running | 🔄 | Blue |
| paused | ⚠️ | Orange |
| completed | ✅ | Green |
| failed | ❌ | Red |
| skipped | ⊘ | Grey |

---

## Empty States

Every empty state should:
1. State the condition in plain language
2. Tell the user what will appear here when there is something
3. Never show a zero count — hide the section or show the empty state instead

Good examples:
- Review queue: "All caught up. The agent will surface improvements as your workflows run."
- Project objectives: "No objectives yet. Add one to track what this project is trying to achieve."
- Work landing: "Create your first project to start running workflows."

---

## Modal Pattern

Full-screen dimmed overlay (`bg-black/45`), centred card with `rounded-[32px]`.
Always has: title, body content, Cancel + primary action buttons.
Cancel is always `variant="ghost"`, destructive actions use `variant="danger"`.

---

## Mobile Considerations

- **Canvas on mobile**: pinch-to-zoom, drag to pan, tap to select
- **Chat designer on mobile**: full-screen chat; canvas accessible via toggle
- **Node config panel**: bottom sheet (not side panel)
- **Escalation response**: large tap targets for decision buttons
- **Markdown editor on mobile**: simplified toolbar (bold, italic, link, `[[link]]` autocomplete)
- **File tree on mobile**: collapsible accordion, full-screen when editing
- **Inner sidebar on mobile**: hidden by default; accessible via hamburger in AppLayout
