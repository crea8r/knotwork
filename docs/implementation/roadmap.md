# Implementation Roadmap

Each session lives in `docs/implementation/S<N>/` with its own spec, visual validation checklist, and automated test suite.

**Before starting a session:** read `S<N>/spec.md` and run `cd backend && pytest ../docs/implementation/S<N>/tests/ -v` to confirm the baseline passes.

---

## Product Vision (updated after S8 planning)

Knotwork is a **structured workflow platform for external agents**. It is not an LLM execution
engine — it is the layer that gives agents structure, knowledge, and human oversight.

**Who it's for:** Solo experts and small teams who need one conversational surface for daily
operations, while gradually distilling repeated work into reusable workflows.

**What Knotwork provides agents and teams:**
1. A structured sequence of steps (the workflow)
2. Relevant knowledge per step (the Handbook fragment)
3. Context from prior steps (prior node outputs)
4. A way to write structured logs back into the run
5. A way to propose Handbook improvements
6. A human-in-the-loop gate at any step (agent calls `escalate`, human responds)
7. A thread-first collaboration surface where humans, agents, and system decisions are visible together

**What Knotwork does NOT do:**
- Own tools (agents bring their own — Knotwork does not manage them)
- Run LLM calls directly after S7 (each node delegates to an external agent)
- Act as an agent framework (that's openclaw, LangGraph, etc.)

**Agent systems supported:** OpenClaw (primary). Claude/OpenAI remain <span style="color:#c1121f;font-weight:700">LEGACY / TRANSITIONAL</span> adapters.

---

| Session | Delivers | Feeds into | Status |
|---------|----------|-----------|--------|
| **S1** | Walking skeleton: graph CRUD, run trigger, LLM Agent + Human Checkpoint, dagre canvas, async queue | S2 | ✅ Done — 28 tests |
| **S2** | Confidence scoring, checkpoint evaluation, RunNodeState persistence, escalation CRUD + resolve (approve / edit / guide / abort), node ratings, escalation timeout, run abort, WebSocket run events, PostgresSaver, escalation inbox UI | S3 | ✅ Done — 55 tests |
| **S3** | Handbook CRUD UI (file tree, markdown editor, wiki-links), knowledge versioning + history, health score (4-signal composite), token badges, Mode B improvement suggestions, progressive health education | S4 | ✅ Done — 31 tests |
| **S4** | Chat designer agent (graph deltas), node config panel (knowledge / tools / checkpoints / confidence rules / fail-safe), conditional router and tool executor editors | S5 | ✅ Done — 26 tests |
| **S5** | Operator dashboard (active runs, escalation widget, recent runs), run trigger form, full canvas with live node status overlay, run history, node inspector, escalation inbox, post-run feedback nudges | S6 | ✅ Done — 11 tests |
| **S6** | Tool registry CRUD + execution, built-in tools (web.search, web.fetch, http.request, calc), tool_executor node, notification channels (email + Telegram + WhatsApp), notification preferences + log | S6.1 | ✅ Done — 20 tests |
| **S6.1** | `input_schema` in graph definition, designer emits `set_input_schema`, smart run trigger form, run result banner, readable prose output in node inspector, run delete (abort vs hard delete), graph name in runs table | S6.2 | ✅ Done — 11 tests |
| **S6.2** | Run naming + inline rename, delete queued/paused runs, exact graph version in run detail, enriched runs table (tokens/output/needs_attention), full LLM input captured in node inspector | S6.3 | ✅ Done — 11 tests |
| **S6.3** | **Critical:** system prompt + knowledge config key alignment (fix silent empty prompts), per-node input sources, edit draft run input, "Run now" debounce | S6.4 | ✅ Done — 13 tests |
| **S6.4** | Builtin tool test modal, designer chat DB persistence, modal scroll fix, input schema editor, node names in run detail, START/END nodes, parallel starts, pre-run validation, copy output, failed node errors, unsaved changes warning | S6.5 | ✅ Done — 16 tests |
| **S6.5** | **Part A (fixes):** start/end auto-injection for all graphs, start/end clickable + wirable, <span style="color:#c1121f;font-weight:700">LEGACY</span> validation enforcement, loop edge rendering (purple dashed fallback), applyDelta deduplication. **Part B (new):** Handbook two-panel UX (FileTree + inline editor + drag-drop upload + format conversion), sidebar nav reorder (Handbook first, Workflows rename), run model extensions (`node_name`, `agent_ref`, `agent_logs`, worklog table, proposals table), Agent API (4 endpoints: log/propose/escalate/complete + session JWT) | S7 | ✅ Done — 25 tests |
| **S7** | **Agent Architecture Pivot.** Unified `agent` node type (agent_ref + trust_level). AgentAdapter ABC (`run_node()` → NodeEvent stream). ClaudeAdapter (Anthropic SDK direct). OpenAIAdapter (Assistants API). HumanAdapter. 4 Knotwork-native tools in `adapters/tools.py`. Engine refactored: delegates to adapters, `next_branch` routing, extracted `runner.py`. Built-in tool registry removed. Handbook proposals review UI (ProposalsPanel). Canvas store `updateNodeConfig` splits `_config`/top-level fields. | S7.1 | ✅ Done — 19 tests |
| **S7.1** | **Agent Registration.** `registered_agents` table + CRUD API. Settings → Agents tab: register Claude / ChatGPT agents with display name + API key + model. Designer dropdown shows registered agents by display name (replaces hardcoded list). Runtime looks up per-workspace API key by `registered_agent_id`; falls back to env vars for <span style="color:#c1121f;font-weight:700">LEGACY</span> nodes. OpenClaw registration UI placeholder (adapter deferred). | S7.2 | ✅ Done — 14 tests |
| **S7.2** | **Conversational Shell + Decision Model.** Global nav fixed mental model. Timeline-first run chat UX with explicit decisions (`accept_output`, `override_output`, `request_revision`, `abort_run`). Message immutability and override artifact semantics. Handbook chat + proposal-based edits. Gap distilled: provider/toolbox transparency remains unresolved and is promoted to S8. | S8 | ✅ Done — Completed |
| **S8** | **Chat-first agent runtime.** Plugin-first OpenClaw connectivity remains, with split chat domains: agent main session chat for preflight, separate workflow chat for design consultation, and run-per-session chat timeline for execution. Capability is derived from chat-visible skills/tools, escalation continuity is preserved in run chat, and run detail uses persisted chat as source of truth. | S8.1 | ✅ Done — OpenClaw connected; chat domains live |
| **S8.1** | **Early adopter sharing.** Full-stack Docker (dev hot-reload + prod profiles). Magic-link auth (no passwords, uses own SMTP). Workspace invitations (owner invites by email → magic link). JWT middleware wired to all workspace routes. Settings → Members tab (real data + invite form). OpenClaw plugin install URL (agent-triggered setup). Agent description field flows from OpenClaw → Knotwork on handshake. **Public workflow run trigger MVP:** owner-only publish links with required markdown description, token-protected public workflow/run pages, public trigger + redirect, final-output-only public run view, pending + email notify, basic rate limit, explicit "test / future paid" notice. Git flow guide. | S8.2 | ✅ Done — Early-adopter sharing + public trigger pages live |
| **S8.2** | **Clean cloud deployment milestone (remote server).** Deploy Knotwork on a remote server with production docker profile, migration runbook, env/secrets checklist, reverse proxy + TLS guidance, and smoke-test checklist. Hide unfinished Settings surfaces (`Workspace`, `Notifications`) to match shipped scope. **Explicitly out of scope in S8.2:** workspace creation flow and notification system implementation. | S9 | Planned |
| **S9** | **Human-usable Knotwork release.** Add workspace creation flow, implement notification system, harden workflow readiness validation (fail-fast invalid runs, block invalid public publish/trigger, surface blocking issues), refine core UI, refine node branching UX/logic, support intentional review/revision loop-back workflows with safeguards, upgrade OpenClaw transport from polling to WebSocket (or equivalent efficient push), add multi-task OpenClaw concurrency (default is `2` tasks per remote agent, capped per plugin instance), add full escalation answer/resume UX in run detail, and deliver mobile-ready UI. | S10 | Planned |
| **S10** | **Agent-usable Knotwork release.** Product mode where users can operate Knotwork through their own agents. Finalize access/trust model (including option where user-provided agent has full workspace access), agent-first interaction contract, and security boundaries for agent-driven operations. | — (Phase 1 complete) | Planned |

---

## Phase 2 (post-S10, not in scope for Phase 1)

- Scheduled / cron run triggers
- Slack integration
- Advanced roles (beyond owner / operator)
- Per-node conversation threads
- Auto-improvement loop for workflows and handbook docs
- Sub-graph nodes (compose workflows from workflows)
- LLM judge checkpoints + auto-ratings
- Run replay from checkpoint
- Self-hosted deployment option
- LLM provider OAuth PKCE — users connect their own OpenAI / Anthropic account directly

---

## Architectural decisions (updated through S8 planning)

These decisions are stable and should not be revisited without a documented breaking change:

1. **One conversational surface for all work.** Inbox and channels are first-class shells for operations; workflows remain first-class distilled assets.
2. **Agents bring their own tools.** Knotwork does not manage tool registries after S7. The existing tool registry is <span style="color:#c1121f;font-weight:700">LEGACY / DEPRECATED</span> and should not be expanded.
3. **Two Knotwork-native skills for agents:** `write_worklog` and `propose_handbook_update`. These are always available, never user-configured.
4. **Messages are immutable for humans and agents.** Corrections happen through explicit decision events and follow-up artifacts, never by editing prior messages.
5. **Session tokens are scoped to run + node.** An agent cannot write to the wrong place.
6. **`propose` never writes to the handbook.** Human approval is always required.
7. **All graphs must have Start and End nodes to run.** The <span style="color:#c1121f;font-weight:700">LEGACY</span> bypass is permanently removed.
8. **Agent systems are pluggable via adapters, but OpenClaw is the primary path.** Claude/OpenAI are <span style="color:#c1121f;font-weight:700">LEGACY / TRANSITIONAL</span> until a final deprecation decision.
9. **Agent capability contract is mandatory for production use.** Tools, constraints, and testability must be visible before workflow execution.
10. **Escalation resolution is decision-based.** `accept_output`, `override_output`, `request_revision`, and `abort_run` are explicit state transitions.
11. **Handbook edits via agent remain human-governed by default.** Agent suggestions for file content/structure are proposal-based and require explicit approval before write.
12. **Sidebar order is fixed.** Nav order encodes product mental model and is not user-reorderable.
