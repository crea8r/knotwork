# Implementation Roadmap

Each session lives in `docs/implementation/S<N>/` with its own spec, visual validation checklist, and automated test suite.

**Before starting a session:** read `S<N>/spec.md` and run `cd backend && pytest ../docs/implementation/S<N>/tests/ -v` to confirm the baseline passes.

---

| Session | Delivers | Feeds into | Status |
|---------|----------|-----------|--------|
| **S1** | Walking skeleton: graph CRUD, run trigger, LLM Agent + Human Checkpoint, dagre canvas, async queue | S2 | ✅ Done — 28 tests |
| **S2** | Confidence scoring, checkpoint evaluation, RunNodeState persistence, escalation CRUD + resolve (approve / edit / guide / abort), node ratings, escalation timeout, run abort, WebSocket run events, PostgresSaver, escalation inbox UI | S3 (needs escalation + rating data for health score) | ✅ Done — 55 tests |
| **S3** | Handbook CRUD UI (file tree, markdown editor, wiki-links), knowledge versioning + history, health score (4-signal composite), token badges, Mode B improvement suggestions, progressive health education | S4 (knowledge picker), S5 (dashboard shows health), S6 (notification priority) | ✅ Done — 31 tests |
| **S4** | Chat designer agent (graph deltas), node config panel (knowledge / tools / checkpoints / confidence rules / fail-safe), conditional router and tool executor editors | S5 (complete designer UX), S7 (MCP design tools) | Planned |
| **S5** | Operator dashboard (active runs, escalation widget, recent runs), run trigger form, full canvas with live node status overlay, run history, node inspector, escalation inbox, post-run feedback nudges | S6 (trigger point for notifications), S7 (MCP exposes these views) | Planned |
| **S6** | Tool registry CRUD + execution, built-in tools (web.search, web.fetch, file.read, etc.), notification channels (email + Telegram + WhatsApp Phase 1 deep links), notification preferences, notification log | S7 (MCP exposes tools + notification tools) | Planned |
| **S7** | MCP server (SSE + stdio): graph, run, escalation, knowledge, tool, and rating tools; MCP resources; Claude Desktop + Cursor integration | S8 (full surface complete) | Planned |
| **S8** | JWT auth wiring + API key enforcement, RBAC (owner vs operator), workspace + member settings UI, API key management UI, audit log viewer, E2E tests, mobile polish, Docker + deployment guide | S9 | Planned |
| **S9** | LLM provider OAuth PKCE — users connect their own OpenAI / Anthropic account; token storage, refresh handling, model selector UI | — (Phase 1 complete) | Planned |

---

## Phase 2 (post-S9, not in scope)

- Scheduled / cron run triggers
- Sub-graph nodes
- LLM judge checkpoints + auto-ratings
- Knowledge Mode C (autonomous agent writes directly)
- External agents as knowledge workers (API-scoped)
- Direct Telegram / WhatsApp response (bot as MCP client)
- Slack integration
- Self-hosted deployment option
- Run replay from checkpoint
