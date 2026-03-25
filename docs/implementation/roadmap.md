# Implementation Roadmap

Each session lives in `docs/implementation/S<N>/` with its own spec, visual validation checklist, and automated test suite.

**Before starting a session:** read `S<N>/spec.md` and run `cd backend && pytest ../docs/implementation/S<N>/tests/ -v` to confirm the baseline passes.

---

## Product Vision (updated post-S9 planning)

Knotwork is **digital organizational infrastructure** — the operating system for running a modern organization where the team is a mix of humans and agents.

**Who it's for:** Solo experts and small teams running outcome-focused projects. Work is managed through Projects (objectives + tasks), not just workflow runs. The workspace is the digital organization; registered identities (human or agent) are the team.

**What Knotwork provides:**
1. A project layer: objectives, tasks, project documents — useful with zero AI
2. A structured workflow layer: graphs, runs, knowledge (Handbook + Run Context)
3. A knowledge layer: Handbook (how to work), Project Documents (what this project is about), Run Context (this task's input)
4. A human-in-the-loop gate at any step (`escalate`, human responds)
5. A thread-first collaboration surface (channels per task, workflow, or handbook resource)
6. A workspace representative model: designated humans or agents handle external interactions and call Knotwork when structured work is needed

**What Knotwork does NOT do:**
- Own tools (agents bring their own)
- Run LLM calls directly (each node delegates to an external agent via adapter)
- Act as an agent framework (that's OpenClaw, LangGraph, etc.)
- Own external business communication workflows. Knotwork may deliver its own internal events over configured means such as app, email, or OpenClaw plugin, but representatives still use their own tools for customer/vendor communication

**Agent systems supported:** OpenClaw (primary, zero-key install). Direct provider keys (Anthropic, OpenAI) supported via RegisteredAgent as power-user path. No AI required at all — Knotwork is fully useful with human-only workflows.

**Automation spectrum:**
```
No agent     → Human-only tasks, manual runs. Fully valid.
OpenClaw     → User's existing AI handles tasks. Zero-key install.
Registered   → Dedicated agent identities per workflow. Power-user path.
```

---

Estimated session timestamps below are educated guesses from git/document history, not exact implementation boundaries. For completed sessions, `Delivers` includes the estimated start timestamp and approximate elapsed duration from the first to last known doc/roadmap touch. For sessions not yet done, `Delivers` includes only the estimated start timestamp.

| Session | Delivers | Feeds into | Status |
|---------|----------|-----------|--------|
| **S1** | `[est. start: 2026-02-27 19:51, duration: ~6d 20h]` Walking skeleton: graph CRUD, run trigger, LLM Agent + Human Checkpoint, dagre canvas, async queue | S2 | ✅ Done — 28 tests |
| **S2** | `[est. start: 2026-02-27 19:51, duration: ~25d 1h]` Confidence scoring, checkpoint evaluation, RunNodeState persistence, escalation CRUD + resolve (approve / edit / guide / abort), node ratings, escalation timeout, run abort, WebSocket run events, PostgresSaver, escalation inbox UI | S3 | ✅ Done — 55 tests |
| **S3** | `[est. start: 2026-02-28 02:57, duration: ~0h]` Handbook CRUD UI (file tree, markdown editor, wiki-links), knowledge versioning + history, health score (4-signal composite), token badges, Mode B improvement suggestions, progressive health education | S4 | ✅ Done — 31 tests |
| **S4** | `[est. start: 2026-02-28 03:58, duration: ~13d 9h]` Chat designer agent (graph deltas), node config panel (knowledge / tools / checkpoints / confidence rules / fail-safe), conditional router and tool executor editors | S5 | ✅ Done — 26 tests |
| **S5** | `[est. start: 2026-03-02 01:52, duration: ~0h]` Operator dashboard (active runs, escalation widget, recent runs), run trigger form, full canvas with live node status overlay, run history, node inspector, escalation inbox, post-run feedback nudges | S6 | ✅ Done — 11 tests |
| **S6** | `[est. start: 2026-03-02 01:52, duration: ~4d 14h]` Tool registry CRUD + execution, built-in tools (web.search, web.fetch, http.request, calc), tool_executor node, notification channels (email + Telegram + WhatsApp), notification preferences + log | S6.1 | ✅ Done — 20 tests |
| **S6.1** | `[est. start: 2026-03-02 01:52, duration: ~22d 19h]` `input_schema` in graph definition, designer emits `set_input_schema`, smart run trigger form, run result banner, readable prose output in node inspector, run delete (abort vs hard delete), graph name in runs table | S6.2 | ✅ Done — 11 tests |
| **S6.2** | `[est. start: 2026-03-02 01:52, duration: ~22d 9h]` Run naming + inline rename, delete queued/paused runs, exact graph version in run detail, enriched runs table (tokens/output/needs_attention), full LLM input captured in node inspector | S6.3 | ✅ Done — 11 tests |
| **S6.3** | `[est. start: 2026-03-02 01:52, duration: ~22d 9h]` **Critical:** system prompt + knowledge config key alignment (fix silent empty prompts), per-node input sources, edit draft run input, "Run now" debounce | S6.4 | ✅ Done — 13 tests |
| **S6.4** | `[est. start: 2026-03-02 01:52, duration: ~22d 9h]` Builtin tool test modal, designer chat DB persistence, modal scroll fix, input schema editor, node names in run detail, START/END nodes, parallel starts, pre-run validation, copy output, failed node errors, unsaved changes warning | S6.5 | ✅ Done — 16 tests |
| **S6.5** | `[est. start: 2026-03-06 16:04, duration: ~0h]` **Part A (fixes):** start/end auto-injection for all graphs, start/end clickable + wirable, <span style="color:#c1121f;font-weight:700">LEGACY</span> validation enforcement, loop edge rendering (purple dashed fallback), applyDelta deduplication. **Part B (new):** Handbook two-panel UX (FileTree + inline editor + drag-drop upload + format conversion), sidebar nav reorder (Handbook first, Workflows rename), run model extensions (`node_name`, `agent_ref`, `agent_logs`, worklog table, proposals table), Agent API (4 endpoints: log/propose/escalate/complete + session JWT) | S7 | ✅ Done — 25 tests |
| **S7** | `[est. start: 2026-03-06 16:04, duration: ~17d 19h]` **Agent Architecture Pivot.** Unified `agent` node type (agent_ref + trust_level). AgentAdapter ABC (`run_node()` → NodeEvent stream). ClaudeAdapter (Anthropic SDK direct). OpenAIAdapter (Assistants API). HumanAdapter. 4 Knotwork-native tools in `adapters/tools.py`. Engine refactored: delegates to adapters, `next_branch` routing, extracted `runner.py`. Built-in tool registry removed. Handbook proposals review UI (ProposalsPanel). Canvas store `updateNodeConfig` splits `_config`/top-level fields. | S7.1 | ✅ Done — 19 tests |
| **S7.1** | `[est. start: 2026-03-06 16:04, duration: ~17d 19h]` **Agent Registration.** `registered_agents` table + CRUD API. Settings → Agents tab: register Claude / ChatGPT agents with display name + API key + model. Designer dropdown shows registered agents by display name (replaces hardcoded list). Runtime looks up per-workspace API key by `registered_agent_id`; falls back to env vars for <span style="color:#c1121f;font-weight:700">LEGACY</span> nodes. OpenClaw registration UI placeholder (adapter deferred). | S7.2 | ✅ Done — 14 tests |
| **S7.2** | `[est. start: 2026-03-06 16:04, duration: ~0h]` **Conversational Shell + Decision Model.** Global nav fixed mental model. Timeline-first run chat UX with explicit decisions (`accept_output`, `override_output`, `request_revision`, `abort_run`). Message immutability and override artifact semantics. Handbook chat + proposal-based edits. Gap distilled: provider/toolbox transparency remains unresolved and is promoted to S8. | S8 | ✅ Done — Completed |
| **S8** | `[est. start: 2026-03-06 16:04, duration: ~18d 5h]` **Chat-first agent runtime.** Plugin-first OpenClaw connectivity remains, with split chat domains: agent main session chat for preflight, separate workflow chat for design consultation, and run-per-session chat timeline for execution. Capability is derived from chat-visible skills/tools, escalation continuity is preserved in run chat, and run detail uses persisted chat as source of truth. | S8.1 | ✅ Done — OpenClaw connected; chat domains live |
| **S8.1** | `[est. start: 2026-03-12 11:18, duration: ~12d 9h]` **Early adopter sharing.** Full-stack Docker (dev hot-reload + prod profiles). Magic-link auth (no passwords, uses own SMTP). Workspace invitations (owner invites by email → magic link). JWT middleware wired to all workspace routes. Settings → Members tab (real data + invite form). OpenClaw plugin install URL (agent-triggered setup). Agent description field flows from OpenClaw → Knotwork on handshake. **Public workflow run trigger MVP:** owner-only publish links with required markdown description, token-protected public workflow/run pages, public trigger + redirect, final-output-only public run view, pending + email notify, basic rate limit, explicit "test / future paid" notice. Git flow guide. | S8.2 | ✅ Done — Early-adopter sharing + public trigger pages live |
| **S8.2** | `[est. start: 2026-03-12 15:53, duration: ~3d 0h]` **Clean cloud deployment milestone (remote server).** Deploy Knotwork on a remote server with production docker profile, migration runbook, env/secrets checklist, reverse proxy + TLS guidance, and smoke-test checklist. Hide unfinished Settings surfaces (`Workspace`, `Notifications`) to match shipped scope. Includes OpenClaw bootstrap hardening for deployed installs: stable persisted `plugin_instance_id`/`integration_secret`, no auto-handshake in CLI/plugin-load contexts, and only the primary long-running runtime may auto-handshake/poll tasks. **Explicitly out of scope in S8.2:** workspace creation flow and notification system implementation. | S8.3 | ✅ Done — Cloud deploy scripts + OpenClaw hardening live |
| **S8.3** | `[est. start: 2026-03-23 11:44, duration: ~0h]` **Prompt architecture refactor.** Correct prompt block order (GUIDELINES → THIS CASE → ROUTING → COMPLETION). First-node detection (`is_first_node = not all_outputs`). Routing escalation when `next_branch` is None on multi-branch nodes. Grouped escalations (single `interrupt()` after generator). Retry prompt structure (`system_prompt=""`, human guidance only). Condition label enforcement in backend + frontend validation. Stateless subprocess executor for OpenClaw plugin (credentials passed in spawn params, removes `_rpcCtxFactory` assumption). | S9 | ✅ Done — Prompt architecture solid; plugin subprocess stateless |
| **S9** | `[est. start: 2026-03-12 15:53, duration: ~12d 5h]` **Single human-usable release.** Workflow readiness hardening (fail-fast validation, block invalid publish/trigger, surface blocking issues), core UI refinement (file upload as input), node branching loop safety (max iterations + iteration counter in run timeline), Handbook UI hardening (file rename/move, tags, sub-folder UX), workflow folders/tags (Handbook-style tree), install/session-state hardening (`installation_id`, workspace cache revalidation), supported installation update mechanism, mobile-ready UI. **Deferred from S9 to S12.2:** inviting/assigning agents into designer chat and workflow chat, designer-chat Handbook file mentions, and OpenClaw workload-honesty work that assumes the current plugin handles two-way execution/runtime coordination. Those pieces need to be rethought after the OpenClaw/MCP split. | S9.1 | ✅ Done |
| **S9.1** | `[est. start: 2026-03-24 10:48]` **Workflow version management.** Draft model (mutable, auto-saved, no history) + explicit versioning (save-as-version / publish / promote-to-production — test runs never create versions). 9-char immutable ID + default two-words-number name, user-renameable. Production designation (color-highlighted, governs canonical public URL + default run trigger version). Per-version permalink alongside canonical URL. Edit-from-version creates new draft; fork-to-new-workflow. Visual branch timeline showing run counts per version. Archival policy (no delete if runs exist). | S9.2 | Planned |
| **S9.2** | `[est. start: 2026-03-24 10:48]` **Participant-specific event delivery.** Stable participant identity model for run/chat events (workspace humans and workspace agents only in Phase 1). Agent can address a specific participant. Addressed escalations route to the targeted participant's inbox. Event delivery is participant-specific, not workspace-wide. Participants register communication means per event type. Supported means in S9.2: app, email, OpenClaw plugin. Deep links use `PUBLIC_BASE_URL` when available. Telegram, WhatsApp, external clients, and plugin/MCP separation are deferred. | S10 | Planned |
| **S10** | `[est. start: 2026-03-12 15:53]` **Projects, Tasks, and Project Documents.** The missing work container. `Project` (objective, deadline, status), `Task` (channel-linked, may trigger Run), `ProjectDocument` (project-scoped knowledge — third knowledge layer). **Project chat**: one shared channel per project for all workspace members. Project dashboard: task completion, run success, roadblock surface. Three-layer knowledge prompt: Handbook + Project Documents + Run Context. Fully useful with zero AI — agent-less nodes route to human. | S11 | Planned |
| **S11** | `[est. start: 2026-03-12 15:53]` **Agent-Aided Project Intelligence.** Project meta-agent synthesizes qualitative progress assessment on demand ("~60% toward objective, Z is blocked because..."). Proposes objective refinements (human approves — same proposal pattern as Handbook). Versioned assessments. Falls back gracefully if no AI connected. | S12 | Planned |
| **S12** | `[est. start: 2026-03-12 15:53]` **Workspace Representatives + Agent Zero + MCP Expansion.** Designate one or more representatives (WorkspaceMember or RegisteredAgent) as in charge of external interactions. S12 clarifies the separation of concerns: OpenClaw plugin becomes the inbound Knotwork delivery path only, while MCP becomes the agent -> Knotwork interaction surface. **Workspace bulletin**: one workspace-wide channel where any member (human or agent) can post updates and announcements. **Agent Zero**: optional orchestrator agent (`role: orchestrator`) — the workspace's COO. Runs a guided onboarding conversation post-install (re-runnable at any time) to bootstrap projects, Handbook entries, and agent recruitment. Monitors workspace health, surfaces what's blocked, proposes new agents. Always the primary representative when created. MCP toolset expanded with project/task tools: `create_project`, `create_task`, `get_task_output`, `get_project_status`, `add_project_document`. Representatives call Knotwork via MCP from their native context (Claude Desktop, OpenClaw); Knotwork-managed delivery means remain for internal event/task routing. | S12.1 | Planned |
| **S12.1** | `[est. start: 2026-03-24 20:50]` **OpenClaw transport upgrade (re-evaluate after MCP split).** Revisit whether the OpenClaw plugin should move from timer-driven HTTP polling to WebSocket after S12 has reduced the plugin to inbound communication only. If still justified, replace polling with WebSocket and add reliability semantics: ACK/retry for terminal events, reconnect/resume on connection loss, automatic credential recovery without manual restart. Auth-mode auto-resolution (`none` / `token` / `password` / `trusted-proxy`) with unified `callGateway()` wrapper and explicit error codes. Degraded-state observability: explicit states, auth diagnostics, queue diagnostics. Deployment guidance for reverse proxy/TLS idle timeouts. | — (Phase 1 complete) | Planned |
| **S12.2** | `[est. start: 2026-03-24 20:50]` **Post-MCP interaction rethink.** Revisit whether agents can be invited or assigned into designer chat and workflow chat, whether designer chat should support handbook-file mention syntax like `/filename` and `[[filename]]`, and whether workload-honesty/queue semantics should still live in the OpenClaw plugin at all, after S12/S12.1 have clarified the MCP/plugin split and OpenClaw's role. Historical S9.2 workload-honesty material is preserved under `docs/implementation/S12.2/workload-honesty-spec.md` and `docs/implementation/S12.2/workload-honesty-plan.md` as design input for this rethink. The design must not assume the pre-MCP OpenClaw execution/runtime model still applies. | — | Planned |

---

## Phase 2 (post-S12, not in scope for Phase 1)

> Phase 1 is a fully open-source, single-tenant product. One workspace per installation, configured at install time. Phase 2 introduces multi-tenancy and the features that require it.

- **Workspace creation flow** — UI-driven workspace setup; required for multi-tenant (Cloud) deployments. Single-tenant OSS installs have one workspace, bootstrapped at deploy time.
- **Multi-tenant support** — multiple workspaces per installation (Knotwork Cloud only)
- **Channel permission scoping** — fine-grained control over who can read or post in each channel scope; Phase 1 channels are open to all workspace members
- **External clients / run-scoped guest participants** — clients can be invited into a bounded run context with explicit scoping and permissions
- Telegram and WhatsApp delivery means
- Browser/mobile push notifications
- Scheduled / cron run triggers
- Advanced roles (beyond owner / operator)
- Per-node conversation threads
- Auto-improvement loop for workflows and handbook docs
- Sub-graph nodes (compose workflows from workflows)
- LLM judge checkpoints + auto-ratings
- Run replay from checkpoint
- Self-hosted deployment option
- Restore script to repopulate a workspace from an operator backup bundle
- In-product backup/export function for operational stability

> ⚠️ **Note:** "Slack integration" as a Knotwork-managed feature is no longer planned. Representatives use Slack (or any channel) via their own tools. Knotwork-managed delivery remains limited to internal event/task routing.

---

## Architectural decisions (updated through S8 planning)

These decisions are stable and should not be revisited without a documented breaking change:

1. **One conversational surface for all work.** Channels are first-class shells (scoped to task, workflow, or handbook resource); workflows and projects remain first-class assets.
2. **Agents bring their own tools.** Knotwork does not manage tool registries after S7. The existing tool registry is <span style="color:#c1121f;font-weight:700">LEGACY / DEPRECATED</span> and should not be expanded.
3. **Two Knotwork-native skills for agents:** `write_worklog` and `propose_handbook_update`. These are always available, never user-configured.
4. **Messages are immutable for humans and agents.** Corrections happen through explicit decision events and follow-up artifacts, never by editing prior messages.
5. **Session tokens are scoped to run + node.** An agent cannot write to the wrong place.
6. **`propose` never writes to the handbook.** Human approval is always required.
7. **All graphs must have Start and End nodes to run.** The <span style="color:#c1121f;font-weight:700">LEGACY</span> bypass is permanently removed.
8. **Agent systems are pluggable via adapters, but OpenClaw is the primary path.** Claude/OpenAI direct-key adapters are <span style="color:#c1121f;font-weight:700">LEGACY / TRANSITIONAL</span>. Zero-key install is the default; no AI provider key is required at install time.
9. **Agent capability contract is mandatory for production use.** Tools, constraints, and testability must be visible before workflow execution.
10. **Escalation resolution is decision-based.** `accept_output`, `override_output`, `request_revision`, and `abort_run` are explicit state transitions.
11. **Handbook edits via agent remain human-governed by default.** Agent suggestions for file content/structure are proposal-based and require explicit approval before write.
12. **Sidebar order is fixed.** Nav order encodes product mental model and is not user-reorderable.
13. **Knotwork does not manage external business communication workflows.** Representatives still use their own tools for customer/vendor communication. Knotwork may deliver internal events and task assignments over configured means such as app, email, or OpenClaw plugin, and later separates delivery from MCP interaction more cleanly in S12.
14. **AI is additive, not required.** A workspace with no AI connected is a valid, fully-functional human-workflow platform. Agent-less nodes route to human rather than failing.
