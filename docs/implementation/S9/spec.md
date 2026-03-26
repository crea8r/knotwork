# Session 9 — Single Human-Usable Release

## Goal

Make Knotwork reliably usable by a single human operator running real workflows in production — before collaborative and multi-participant features land in S9.1–S10.

## Sub-sessions

| Session | Scope |
|---------|-------|
| **S9** (this) | Workflow readiness hardening, loop safety, escalation polish, Handbook UI hardening, workflow org, session hardening, update mechanism, mobile UI |
| **S9.1** | Workflow version management — draft model, explicit versioning, production designation, public URLs, visual branch timeline |
| **S10** | Participant-specific event delivery — participant addressing, participant-bound communication means (`app`, `email`, `OpenClaw plugin`), event routing/preferences, deep links |

## In Scope

1. Core UI refinement for daily operator/designer workflows.
   - when the user has uploaded a file, the run/public trigger input field may be left empty
   - public workflow trigger pages support file upload as an input path
2. Workflow readiness hardening:
   - validate the exact graph version before run trigger
   - block runs when executable nodes are missing required config (for example agent nodes without `agent_ref`)
   - block public publish / public trigger for invalid workflows
   - surface structured blocking issues in API and UI
   - keep runtime defensive with explicit node/run errors if invalid state still slips through
3. Node branching UX/behavior refinement:
   - **Already done:** loop-back edges render in canvas (purple dashed Bezier), validation allows loops, LangGraph routes them via conditional edges
   - **Remaining:** define and enforce loop execution safety rules (max iterations per loop, explicit stop conditions), surface explicit iteration counter in run timeline ("Visit 2 of 3" — currently separate rows exist but are unlabeled), make review/revision loops understandable in designer and run UI
4. Escalation response UX hardening:
   - Q&A answer form (DecisionCardAnswers), auto-resume on submit, all 4 resolution types (accept/override/revise/abort), inline in run chat
5. Handbook UI hardening:
   - file rename inline in the file tree (currently no rename without re-upload)
   - sub-folder UX improvements: collapsible sub-folders render cleanly at any depth; creating a file inside a sub-folder is a first-class action (not just drag-drop)
   - file search/filter in Handbook tree (by name or health state)
   - file move between folders via drag-drop or a dedicated move action
6. Workflow organization UX:
   - workflows support folders for easier browsing
   - workflow list/tree should reuse the Handbook file-tree interaction model for consistency
   - users can browse workflows in a collapsible tree view by folder
7. Install/session-state hardening:
   - frontend must not trust cached `workspaceId`, role, or localhost bypass state across reinstall/reset events
   - backend should expose a stable per-install `installation_id` (e.g. on `/health` or `/auth/me`) that persists across normal restarts but changes on DB reset / fresh install
   - on app bootstrap, frontend must compare cached `installation_id` with server `installation_id`; mismatch forces auth/workspace cache reset and re-bootstrap
   - frontend must always revalidate cached `workspaceId` against the current `/workspaces` response before using it for API calls
   - if cached workspace is missing, frontend must switch to a valid current workspace or clear auth state if none exist
   - localhost bypass sessions must refresh identity + workspace from the backend on load; persisted `localhost-bypass` alone is not a valid source of truth
   - cached role is display-only; authorization decisions must come from current backend membership data
   - backend should support machine-readable invalidation semantics for broken client state (e.g. `installation_changed`, `workspace_not_found`)
8. Installation update mechanism:
    - define a supported upgrade path so a running Knotwork install can be kept current with the upstream repo without ad hoc manual steps
    - installation must expose current app version, schema version, and minimum compatible OpenClaw plugin version (via `/health` or `/version` endpoint)
    - provide a canonical update entry point (versioned docker compose pull/up flow or dedicated update script)
    - update flow: fetch release → stop/recreate services → run migrations exactly once → verify health → verify background worker → verify plugin compatibility
    - define behavior for active runs during update (drain, resume, or explicitly unsupported)
    - UI should surface current version and warn when server/plugin compatibility is out of date
    - update contract must preserve persisted installation identity unless this is intentionally a reinstall/reset
9. Mobile-ready UI for key user journeys.

## Out of Scope

- **Workspace creation flow** — Phase 2 (multi-tenant Cloud only).
- **Workflow version management** — S9.1. See `docs/implementation/S9.1/spec.md`.
- **OpenClaw workload honesty under the current plugin two-way execution model** — deferred to S12.2. See `docs/implementation/S12.2/workload-honesty-spec.md`.
- **Participant-specific event delivery** — S10. Notifications become participant routing tied to chat events and communication means. See `docs/implementation/S10/spec.md`.
- **OpenClaw WS transport upgrade** — deferred to S12.1 pending the S12 MCP/plugin split. See `docs/implementation/S12.1/spec.md`.
- **Plugin-owned queue semantics / claim strategy that assume OpenClaw still does two-way execution/runtime coordination** — deferred to S12.2 pending the MCP/plugin rethink.
- **Inviting/assigning agents into designer chat or workflow chat** — deferred to S12.2. This needs a rethink after the MCP/plugin split because OpenClaw's role may change from execution/runtime assumptions that the current design relied on.
- **Designer chat Handbook-file mention syntax** (`/filename`, `[[filename]]`) — deferred to S12.2. This should be revisited together with the post-MCP rethink of designer/workflow chat behavior and how chat actions bind into workflow configuration.
- Phase 2 features: cron, Slack, advanced roles, sub-graphs, auto-improvement loop, multi-tenancy, Handbook/workflow tags.

## Acceptance Criteria

1. Triggering a run fails fast with `400`-class validation errors when the pinned graph version is not runnable.
3. Publish/public-trigger flows reject workflows with blocking configuration issues.
4. Workflow UI clearly shows runnable vs blocked state and identifies blocking nodes/fields.
6. Operator and public trigger forms accept an uploaded file as sufficient input when no text is entered.
7. Public workflow pages support file upload wherever the workflow input contract allows it.
8. Review/revision workflows with loop-back edges can run successfully; runtime enforces a max iteration limit and the run timeline shows explicit iteration counts.
9. When an agent escalates with a question, the operator can answer in the run UI and resume the run to completion.
10. Handbook files can be renamed inline and moved between folders; file tree renders sub-folders cleanly at any depth.
12. Workflows can be organized by folder; browsing experience is consistent with the Handbook tree view.
13. After a clean reinstall or DB reset, the browser does not keep sending stale workspace IDs from local storage.
14. Frontend automatically detects installation drift (`installation_id` mismatch) and recovers to a valid workspace/auth state without manual localStorage editing.
15. Localhost bypass installs bootstrap against current backend state on page load and do not rely on stale cached credentials.
16. A deployed install can be updated to a newer Knotwork release through a documented, supported mechanism.
17. Version/build information and compatibility state are visible so an operator can determine whether backend, frontend, worker, DB schema, and OpenClaw plugin are aligned.
18. Main workflows are usable on mobile screens.
19. Product is ready for human operators as primary users.
