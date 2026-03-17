# Frontend Specification — Shared UX Patterns

## Token Warning Badge

Shown anywhere a knowledge fragment's resolved token count is outside range:

- `⚠️ 7,240 tokens — too large` (orange)
- `⚠️ 210 tokens — too sparse` (yellow)

---

## Knowledge Health Indicator

Shown in the file tree, node config panel, and post-run screens:

- `●●●●●` (green) — Excellent (4.5–5.0)
- `●●●●○` (green) — Good (3.5–4.4)
- `●●●○○` (yellow) — Fair (2.5–3.4)
- `●●○○○` (orange) — Needs attention (1.5–2.4)
- `●○○○○` (red) — Poor (< 1.5)

Sub-scores are only shown when data exists for them. Empty sub-scores are hidden, not shown as zeroes.

---

## Run ETA

Shown as a countdown during active runs. Computed from historical run times for that graph. Displayed as "~X min left" on the dashboard and run detail screens.

---

## Node Status Icons

| Status | Icon | Colour |
|--------|------|--------|
| pending | ⏳ | Grey |
| running | 🔄 | Blue |
| paused | ⚠️ | Orange |
| completed | ✅ | Green |
| failed | ❌ | Red |
| skipped | ⊘ | Grey |

---

## Mobile-Specific Considerations

- **Canvas on mobile**: pinch-to-zoom, drag to pan, tap to select, long-press to open context menu
- **Chat designer on mobile**: full-screen chat, canvas accessible via toggle button
- **Node config panel**: bottom sheet (not side panel)
- **Escalation response**: large tap targets for Approve/Edit/Guide/Abort buttons
- **Markdown editor on mobile**: simplified toolbar (bold, italic, link, `[[link]]` autocomplete only)
- **File tree on mobile**: collapsible accordion, full-screen when editing
