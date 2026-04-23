# S5 Validation Checklist

Run backend: `cd backend && uvicorn knotwork.main:app --reload`
Run frontend: `cd frontend && npm run dev`

---

## 1. App Shell — Sidebar

- [ ] **Visit any page (e.g. /graphs)**
  - ✅ PASS: Left sidebar visible with logo "Knotwork", Settings link at top, ROLE section with Designer/Dashboard/Runs/Escalations, RESOURCES section with Handbook/Tools
  - ❌ FAIL: No sidebar, or sidebar items missing

- [ ] **Click each nav item**
  - ✅ PASS: Active item has bold text + brand blue background; other items are gray
  - ❌ FAIL: No active highlighting, or all items look the same

- [ ] **Click Settings (top of sidebar)**
  - ✅ PASS: Navigates to /settings
  - ❌ FAIL: Does not navigate or throws error

---

## 2. DashboardPage (`/dashboard`)

- [ ] **Open /dashboard with no runs**
  - ✅ PASS: "No active runs" and "No completed runs yet" empty states visible
  - ❌ FAIL: Spinner forever or JS error

- [ ] **After triggering a run from a graph**
  - ✅ PASS: Run card appears in "Active Runs" section with StatusBadge and mock ETA in amber [mock] box
  - ❌ FAIL: Card missing or no MockWrap visible

- [ ] **Open escalation card**
  - ✅ PASS: "Escalations" section shows card with "Review →" button that links to /escalations/:id
  - ❌ FAIL: No escalations shown even when backend has open ones

---

## 3. GraphsPage (`/graphs`)

- [ ] **Click "+ New Graph"**
  - ✅ PASS: Modal overlay opens with Name + Description inputs; Cancel closes; Create navigates to graph detail
  - ❌ FAIL: Old inline form shown, or modal doesn't appear

- [ ] **Type in search box**
  - ✅ PASS: Graph list filters by name in real time
  - ❌ FAIL: Filter has no effect

- [ ] **No graphs exist**
  - ✅ PASS: EmptyState with icon and "+ New Graph" action button shown
  - ❌ FAIL: Blank page or spinner

---

## 4. GraphDetailPage (`/graphs/:id`)

- [ ] **Click "Run ▶" in header**
  - ✅ PASS: RunTriggerModal opens with JSON textarea, Notes textarea, amber file upload zone, amber ETA estimate
  - ❌ FAIL: Old behaviour (no modal, direct trigger)

- [ ] **Submit RunTriggerModal with valid JSON**
  - ✅ PASS: Run created, navigated to /runs/:id
  - ❌ FAIL: Error or stays on page

- [ ] **DebugBar at bottom**
  - ✅ PASS: "▶ Debug" bar visible at bottom; clicking expands it to show JSON input left + output right
  - ❌ FAIL: No debug bar or doesn't expand

---

## 5. RunsPage (`/runs`)

- [ ] **Visit /runs**
  - ✅ PASS: Table of runs with Run ID, Status badge, Started, Duration columns; filter tabs "all/active/completed/failed" visible
  - ❌ FAIL: Placeholder page or blank

- [ ] **Click a row**
  - ✅ PASS: Navigates to /runs/:id
  - ❌ FAIL: Nothing happens

---

## 6. RunDetailPage (`/runs/:id`)

- [ ] **Click a node row in the table**
  - ✅ PASS: NodeInspectorPanel slides in from right with status, confidence, tokens, output JSON
  - ❌ FAIL: Nothing happens on row click

- [ ] **Submit a star rating in NodeInspectorPanel**
  - ✅ PASS: Stars become amber on hover; after click shows "Rated N★ — thank you"
  - ❌ FAIL: Stars don't respond or error

- [ ] **PostRunNudge after low rating (≤2)**
  - ✅ PASS: Amber banner appears at top with knowledge path link and "Open Handbook →"
  - ❌ FAIL: No banner shown

---

## 7. EscalationsPage (`/escalations`)

- [ ] **Visit /escalations**
  - ✅ PASS: Card-based list (not table), count badges "N open / N resolved", filter buttons
  - ❌ FAIL: Still shows old table layout

---

## 8. EscalationDetailPage (`/escalations/:id`)

- [ ] **Check breadcrumb**
  - ✅ PASS: "Escalations › run abc12345…" visible at top
  - ❌ FAIL: No breadcrumb

- [ ] **Action buttons**
  - ✅ PASS: Approve=green, Edited=brand blue, Guided=blue, Aborted=red when selected
  - ❌ FAIL: All buttons same color

---

## 9. HandbookPage (`/handbook`)

- [ ] **Files with health < 2.5 exist**
  - ✅ PASS: "Needs Attention" red section appears above search, showing affected paths with HealthDots + "Review →"
  - ❌ FAIL: No "Needs Attention" section

- [ ] **HealthDots in file list**
  - ✅ PASS: ●●●○○ dots replace old numeric badge
  - ❌ FAIL: Still shows "3.0/5" text badge

- [ ] **"+ New File" button**
  - ✅ PASS: Modal opens with Path + Title inputs
  - ❌ FAIL: Old inline form

---

## 10. ToolsPage (`/tools`)

- [ ] **Visit /tools**
  - ✅ PASS: 4 tool cards in amber [mock · tools S6] wrapper; "+ New Tool" button is disabled with tooltip
  - ❌ FAIL: Placeholder or blank page

---

## 11. SettingsPage (`/settings`)

- [ ] **Visit /settings**
  - ✅ PASS: Three tabs (Workspace / Members / Notifications); all content in amber mock wrappers
  - ❌ FAIL: Placeholder or blank page

- [ ] **Toggle a notification switch**
  - ✅ PASS: Toggle animates on/off (client-side only, no API call)
  - ❌ FAIL: Toggle doesn't respond

---

## 12. Mock indicators

- [ ] **All mock sections visible**
  - ✅ PASS: Every MockWrap shows a small amber "mock · label" pill in top-right corner
  - ❌ FAIL: No amber indicators visible anywhere
