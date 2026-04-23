# S5 Spec — Full App UI

## What Was Built

### Design System
- Extended `tailwind.config.js`: full `brand` palette (50/100/500/600/700/900) + `mock` tokens (border/bg/text)
- `src/mocks/index.ts`: single file for all mock data with removal annotations
- 9 shared components under `components/shared/`:
  - `Btn` — primary/secondary/ghost/danger × sm/md, loading state
  - `Badge` — blue/green/orange/red/gray/purple pill
  - `Card` — white rounded-xl shadow-sm, optional onClick
  - `EmptyState` — icon + heading + subtext + optional action
  - `HealthDots` — ●●●○○ from 0–5, color-coded
  - `StatusBadge` — run/node/escalation status → colored pill
  - `PageHeader` — title + optional subtitle + right actions slot
  - `Spinner` — sm/md/lg animated spinner
  - `MockWrap` — amber tint wrapper with "mock · label" pill

### App Shell
- `components/layout/Sidebar.tsx` — nav with ROLE and RESOURCES sections, active state via NavLink
- `components/layout/AppLayout.tsx` — sidebar + `<Outlet>` for scrollable main content
- `App.tsx` updated: all routes wrapped in `<AppLayout>` except `GraphDetailPage` (keeps own full-viewport layout)

### New Pages
| Page | Route | Data |
|---|---|---|
| DashboardPage | /dashboard | real: useRuns + useEscalations |
| RunsPage | /runs | real: useRuns, filter tabs |
| ToolsPage | /tools | mock: MOCK_TOOLS in MockWrap |
| SettingsPage | /settings | mock: Workspace/Members/Notifications tabs |

### API Addition
- `useRuns(workspaceId, status?)` added to `api/runs.ts` — `GET /workspaces/{ws}/runs`

### Polished Pages
- `GraphsPage` — modal create form, Card layout, search filter, EmptyState
- `EscalationsPage` — Card-based list, count badges, filter tabs
- `EscalationDetailPage` — Card layout, Btn for actions, breadcrumb
- `HandbookPage` — Needs Attention section (health < 2.5), modal create, HealthDots, EmptyState
- `KnowledgeFilePage` — HealthDots, Card layout, Btn, breadcrumb

### GraphDetailPage Enhancements
- `DebugBar` (components/operator/): collapsible bottom panel; left = JSON input + trigger, right = last run output
- `RunTriggerModal` (components/operator/): modal with JSON input + notes + MockWrap file upload + MockWrap ETA
- Header "Run ▶" button opens modal; DebugBar provides quick debug trigger

### RunDetailPage Enhancements
- `NodeInspectorPanel` (components/operator/): slide-in right panel on row click — status, confidence, tokens, output JSON, knowledge paths, star rating
- `PostRunNudge` (components/operator/): dismissable banner with 3 variants (low-confidence, low-rating, success)
- Node table rows are clickable; Spinner shown while loading

## Key Decisions
- `GraphDetailPage` excluded from `AppLayout` to preserve full-viewport layout
- Navigator uses `NavLink` from react-router for active state (no custom logic)
- Mock data centralised in `mocks/index.ts`; `MockWrap` makes mock sections visually distinct
- `useEscalations` called without status filter in `RunDetailPage` (to compute escalation context for PostRunNudge)
- `HandbookPage` uses `window.location.href` for row navigation inside a table (avoids nesting `<a>` inside `<tr>` onClick)

## Breaking Changes
None — all S1–S4 backend and frontend APIs preserved.
