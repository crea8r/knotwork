# Frontend Specification — S8 Agents UX (Settings + Profile)

> **Chat-first revision (latest):**
> - Main session chat is the primary surface for preflight only.
> - Workflow design consultation is persisted in per-workflow chat.
> - Run detail chat uses persisted run session messages as source of truth.
> - Capability display is unified as `Skills & Tools` (no file/shell).

## Scope

This document defines the implementation-grade UX contract for Session 8 agent management.

It covers two distinct surfaces:
1. **`Settings > Agents`**: onboarding and operational control plane.
2. **`Agent Profile`**: identity, capability transparency, history, and debug inspection.

It replaces the previous single-form registration behavior.

> <span style="color:#c1121f;font-weight:700">LEGACY DESIGN</span>: "register agent by entering provider/model/API key in one modal and use immediately".

---

## UX Goals

1. Users can understand agent capability before using it in a workflow.
2. Users can validate tools and constraints before activation.
3. Users can diagnose behavior from profile and run debug without guessing.
4. Mobile behavior keeps one focused panel at a time.

---

## Information Architecture

## Routes

1. `/settings/agents`
2. `/agents/:agentId`

## Navigation behavior

1. `Settings > Agents` is accessed from global sidebar `Settings`.
2. Clicking an agent name/avatar in any surface opens `/agents/:agentId`.
3. Back navigation from profile returns to previous location (settings, run, workflow, or handbook).

---

## Page 1: Settings > Agents (Onboarding + Ops)

## Purpose

Operational control plane for registration, preflight, activation state, and capability refresh.

## Layout (desktop)

1. Top bar: title, search, provider filter, status filter.
2. Primary list/table: one row per registered agent.
3. Right utility panel (optional): selected row quick summary and latest preflight state.
4. Primary CTA: `Register Agent`.

## Layout (small screen)

1. One panel visible at a time.
2. Default shows list only.
3. Opening `Register Agent` uses full-screen wizard and hides list.
4. Opening row actions uses bottom sheet.

## Agent list columns

1. Avatar
2. Display name
3. Provider (`openclaw`, `<span style="color:#c1121f;font-weight:700">LEGACY</span> openai`, `<span style="color:#c1121f;font-weight:700">LEGACY</span> anthropic`)
4. Capability version
5. Last capability refresh
6. Preflight status (`pass`, `warning`, `fail`, `never_run`)
7. Activation status (`active`, `inactive`)
8. Last used (run timestamp)
9. Actions menu

## Row actions

1. `Open profile`
2. `Refresh capabilities`
3. `Run preflight`
4. `Activate` or `Deactivate`
5. `Archive` (soft remove from picker)

## Register Agent Wizard

## Step 1: OpenClaw plugin handshake

1. Generate one-time handshake token in Settings.
2. OpenClaw owner installs Knotwork plugin and pastes token.
3. Plugin calls handshake endpoint and establishes integration.
4. UI shows integration connected state.

## Step 2: Remote agent sync and selection

1. Display synced OpenClaw remote agents from integration.
2. User selects remote agent and registers binding.
3. Binding generates Knotwork `agent_ref` as `openclaw:{slug}`.

## Step 3: Capability fetch and preflight tests

1. Auto-run required tests.
2. Optional advanced tests.
3. Results table includes test id, tool, latency, status, error snippet.
4. User can rerun failed tests.

## Step 4: Activation decision

1. If required tests pass, user can activate now or save as inactive.
2. If required tests fail, activation blocked and `Save inactive` only.
3. Summary block shows endpoint, version, pass rate, and timestamp.

## Ops states and badges

1. `Needs refresh` when capability contract age exceeds threshold.
2. `Preflight stale` when tests older than threshold.
3. `Capability changed` when fetched manifest hash differs from baseline.

---

## Page 2: Agent Profile (Identity + Capability + History)

## Purpose

Inspection surface for trust, provenance, and debugging of one agent.

## Layout (desktop)

1. Header card: avatar, display name, provider badge, activation badge, quick actions.
2. Main content split into panels:
3. Capability panel.
4. Test history panel.
5. Usage history panel.
6. Debug links/pointers panel.

## Layout (small screen)

1. One panel visible at a time using tabs/segmented control.
2. Default panel is `Overview`.
3. Opening avatar editor or raw debug uses full-screen overlay.

## Header actions

1. `Edit name`
2. `Edit avatar`
3. `Refresh capabilities`
4. `Run preflight`
5. `Activate` or `Deactivate`

## Avatar editing (required UX)

1. Small edit icon next to avatar opens avatar panel.
2. Panel remains hidden until user clicks icon.
3. Panel shows default avatar options without category label text.
4. Panel includes `Upload` option.
5. Upload flow requires crop before save.
6. Save flow compresses image before upload/persist.

## Capability panel

1. Contract summary: manifest version, refreshed_at, hash.
2. Tool matrix: tool name, purpose, input schema summary, risk class.
3. Constraint matrix: network/search/file/runtime/timeouts.
4. Policy notes: escalation hints and safety constraints.
5. `View raw contract` debug toggle.

## Test history panel

1. Latest preflight result card.
2. Historical runs table: timestamp, pass rate, failed tests, median latency.
3. Baseline comparison view (`current` vs `baseline`).
4. `Set baseline` action on passing run.

## Usage history panel

1. Workflows using this agent with last edited timestamp.
2. Runs using this agent with status and created timestamp.
3. Quick links to workflow detail and run detail.

## Debug panel

1. Most recent provider IDs.
2. Recent tool call trace summary.
3. Jump actions to run debug section.
4. `View raw payload` guarded by explicit toggle.

---

## Shared Interaction Contracts

## Agent picker behavior in workflow builder

1. Agent picker only shows `active` agents by default.
2. Picker exposes capability summary on hover/tap.
3. Selecting an agent triggers capability compatibility checks for the step.
4. Incompatibilities render warning cards with specific missing capability keys.

## Activation policy

1. Brand-new agents default to `inactive` until preflight pass.
2. Manual override to activate with warnings requires explicit confirmation.
3. Deactivation hides agent from default picker and blocks new runs with that agent.

## Capability refresh policy

1. Refresh can be manual from settings/profile.
2. Refresh updates manifest hash and version metadata.
3. If contract changes, baseline test state is marked stale.

---

## Data Requirements (frontend contract)

## Agent summary model

1. `id`
2. `display_name`
3. `avatar_url`
4. `provider`
5. `status`
6. `capability_version`
7. `capability_hash`
8. `capability_refreshed_at`
9. `preflight_status`
10. `preflight_run_at`
11. `last_used_at`

## Agent profile model additions

1. `capabilities.tools[]`
2. `capabilities.constraints`
3. `capabilities.policy_notes`
4. `preflight_runs[]`
5. `workflow_usage[]`
6. `run_usage[]`
7. `debug_links`

---

## Empty, Loading, and Error States

## Settings > Agents

1. Empty: explain why capability validation matters and show `Register Agent` CTA.
2. Loading: skeleton rows.
3. Error: retry surface with transport vs auth error distinction.

## Agent Profile

1. Empty capability: show explicit `No capability contract fetched` with refresh CTA.
2. No usage history: show `Not used in workflows/runs yet`.
3. Preflight failures: show pinned failure summary with rerun CTA.

---

## Accessibility and Usability

1. All status indicators require text plus color.
2. Every icon-only action has aria label and tooltip.
3. Wizard supports keyboard-only progression.
4. Raw debug content is copyable with one click.
5. Focus trap in full-screen overlays on mobile.

---

## Telemetry Events (recommended)

1. `agent_register_started`
2. `agent_capability_fetch_succeeded`
3. `agent_capability_fetch_failed`
4. `agent_preflight_run_started`
5. `agent_preflight_run_completed`
6. `agent_activated`
7. `agent_deactivated`
8. `agent_profile_opened`
9. `agent_avatar_updated`
10. `agent_capability_contract_viewed_raw`

---

## Acceptance Criteria

1. Settings list can onboard and operate agents without opening profile.
2. Profile page gives sufficient data to decide trust and diagnose behavior.
3. Avatar edit panel behavior matches the panel/crop/compress requirements.
4. Workflow picker exposes capability mismatches before run execution.
5. Mobile always shows one focused panel for this feature set.

---

## Migration Notes

1. Keep reading existing provider records.
2. Mark non-OpenClaw providers as <span style="color:#c1121f;font-weight:700">LEGACY / TRANSITIONAL</span> in settings/profile.
3. Preserve existing `registered_agent_id` references in workflows.
4. Do not auto-activate migrated agents without at least one successful preflight.
