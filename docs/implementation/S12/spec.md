# Session 12 — Human-First Baseline

## Goal

Make the app work 100% without agents. Fix the RUN flow end-to-end so an operator can design a multi-branch workflow, trigger a run, resolve each node's escalation, and complete the run. Expose Knotwork through MCP as a whole product surface, not a narrow project/task add-on. Add workspace bulletin.

S12 is about:

- unifying to one node type (drop all legacy types)
- supervisor-based escalation on every node
- completing the RUN flow (the app's core loop)
- MCP server for the whole Knotwork surface
- workspace bulletin channel

**Core principle:** bad UX for humans means bad UX for agents. The MCP server built in S12 makes no distinction between human and agent callers — a human using Claude Desktop and an agent using MCP are indistinguishable at the API surface. If the RUN flow is broken for a human operator (can't route branches, can't see escalation deadlines), it's equally broken for any agent that will use the same interface later. Fixing it for humans fixes it for everyone. S12 builds the interface right; later sessions (S12.1+) define how agents connect to it.

S12 is not the session for agent onboarding, Agent Zero, workspace representatives, or plugin boundary clarification. Those belong to S12.1+ after the human baseline is solid.

## In Scope

### 1. Drop all legacy node types — one unified node

There is one node type: `agent`. Legacy types (`llm_agent`, `human_checkpoint`, `conditional_router`, `tool_executor`) are removed everywhere. Any existing graph data with legacy types is converted to `agent` at load time.

**Backend cleanup:**
- Delete dead code: `nodes/llm_agent.py`, `nodes/human_checkpoint.py`, `nodes/conditional_router.py`
- Simplify `_resolve_agent_ref()` in `agent.py` — remove legacy type fallbacks
- Update `designer/agent.py` system prompt — document only the unified `agent` type
- Update `designer/parser.py` — default to `type: "agent"` instead of `llm_agent`
- Update `runtime/validation.py` — validate `agent` type, remove legacy-specific checks
- Update `bootstrap/default_workflows.json` — convert legacy workflows to modern `agent` type

**Frontend cleanup:**
- Remove legacy types from `NodeType` union in `types/index.ts` → `'agent' | 'start' | 'end'`
- Delete orphaned config components: `LlmAgentConfig.tsx`, `HumanCheckpointConfig.tsx`, `ConditionalRouterConfig.tsx`
- Remove legacy color mappings from `canvas/graphCanvasConstants.ts`
- Remove legacy-specific validation from `utils/validateGraph.ts`
- Update `NodeConfigPanel.tsx` — remove legacy labels and `AGENT_TYPES` set

### 2. Supervisor on every node

Every node must have an assigned supervisor — the person or agent who handles escalations from that node. There is no separate "human node" vs "LLM node" escalation path. All escalations route to the node's supervisor.

- **Node config gains `supervisor_id`** (participant ID — a workspace member or registered agent)
- Escalation creation uses `supervisor_id` as `assigned_to`. Only the assigned supervisor can respond; others see the escalation as read-only.
- If no supervisor is set, fall back to workspace-level default (all human members, as today).

### 3. Operator dropdown — show real names

The agent selection UI in the graph editor replaces abstract labels with real identities:

- Instead of `"Human (always ask)"` → show member names: `"Hieu (member)"`, `"Wed (agent)"`
- Dropdown populated from workspace members + registered agents
- Selected identity stored as `agent_ref` (for agents) or determines the node operates as a human-supervised node (for members)

### 4. Multi-branch selection UI

When a node finishes without picking a branch and has >1 outgoing edge, DecisionCard currently shows branch options as a **read-only bullet list**. Fix:

- Render interactive branch picker (radio buttons or dropdown) populated from `context.options`
- Selected branch flows into `resolution_data.next_branch`
- Supervisor picks the branch, run continues on that path

### 5. Timeout countdown in DecisionCard

`timeout_at` exists in the escalation model (default 24h, cron checks every 5min, sets to `timed_out` → run `stopped`). But the UI shows nothing.

- Display `timeout_at` as a visible countdown in DecisionCard
- Warn when <1 hour remains (color change or badge)
- Show "Timed out" state clearly if escalation expires while the operator is viewing it

### 6. Fix silent channel notification failure

In `escalations/service.py` lines 45-87, the entire channel notification block is wrapped in `try/except Exception: pass`. If notification fails, the escalation exists in the DB but the operator is never notified. The run sits paused until the 24h timeout.

- Replace `pass` with proper error logging (`logger.exception(...)`)
- The escalation is still created (existing behavior) — but failures are now visible in logs for debugging

### 7. MCP server for the whole Knotwork surface

S12 should not treat MCP as a small add-on for projects/tasks. MCP is the human-first command surface for the whole product. A human using Claude Desktop, Cursor, or another MCP client should be able to operate Knotwork without relying on the web UI for normal operational flows.

**Planning rule:** this section must be reviewed against the generated OpenAPI baseline, not only against product memory. The OpenAPI baseline is the source of truth for what the backend actually exposes today. MCP scope should be derived from that baseline, then tightened by product judgment where chat is or is not a good fit.

**Baseline source:** `docs/sysdesign/interfaces/api/openapi-baseline.json` generated from the FastAPI app. The baseline currently exposes major path families for graphs, runs, knowledge, registered agents, channels, projects/objectives, notifications, workspaces, invitations, public workflows, and the agent/plugin install APIs. Section 7 should track that real surface.

The MCP server runs alongside the FastAPI app and should cover at least these scope areas:

#### 7.1 Workspace + operational overview

- list active runs
- list open escalations
- inspect inbox / notifications where appropriate
- inspect workspace participants / agents where appropriate
- read system-health / high-level operational state needed for daily use

#### 7.2 Workflow / graph management

- list graphs
- inspect graph definition + latest version
- create graph
- design graph through the designer chat
- import graph from markdown
- update graph status
- operate version-aware workflow flows where already supported by the product

#### 7.3 Run operations

- trigger run
- inspect run
- list runs
- inspect node state
- abort run
- resolve escalations, including branch selection and revision guidance

#### 7.4 Objective / project operations

- list projects
- create project
- inspect project
- update project
- inspect project dashboard
- list objectives
- create objective
- inspect objective
- update objective title
- update objective description
- update objective progress
- change objective status
- update objective status summary
- update objective key results
- move objective inside the objective tree by changing parent linkage
- list project channels
- list/create/read/update project documents and folders
- create project status update

**Important correction:** S12 should not frame this area as primarily task-based. The implemented project corpus is objective-centered. The OpenAPI baseline exposes project + objective APIs, not a first-class task surface. MCP docs should therefore speak in terms of projects, objectives, project documents, project status updates, and project channels unless the backend later adds more.

#### 7.5 Knowledge operations

- list Handbook files
- read knowledge
- write knowledge
- inspect knowledge history
- review handbook suggestions / proposals

#### 7.6 Channel operations

- list participants for mention / routing context
- list channels
- inspect channel
- list channel messages
- post channel messages
- list channel decisions
- post channel decisions where appropriate
- read channel asset bindings
- attach / detach supported assets where that flow already exists
- use handbook chat flows where the backend already exposes them

**Important gap to cover:** S12 MCP scope must explicitly include the ability to read from and respond into channels. A "whole Knotwork surface" without channel read/write is incomplete. The OpenAPI baseline already exposes this capability and section 7 should preserve it.

#### 7.7 Inbox / notification operations

- list inbox items
- inspect inbox summary
- mark inbox deliveries read / archived
- mark all inbox items read
- inspect participant delivery preferences
- update participant delivery preferences where permissions allow
- inspect workspace notification preferences
- update workspace notification preferences
- inspect notification log / workspace notification state where useful for operators

**Important gap to cover:** notification and inbox behavior are part of daily operation and must be represented in MCP scope, not treated as an afterthought. The OpenAPI baseline already has inbox, delivery-preference, workspace notification-preference, and notification-log paths.

#### 7.8 Agent / participant operations

- list workspace participants
- list registered agents
- register agent
- inspect registered agent
- update registered agent
- activate / deactivate registered agent where supported
- inspect capability refresh / usage / preflight flows where they exist in the baseline
- delete / archive agent where current product policy allows
- inspect participants where needed to support operator/supervisor selection and notification routing

#### 7.9 MCP resources

In addition to tools, expose readable MCP resources for high-value contexts such as:

- workspace graph list
- open escalations
- active runs
- knowledge file content
- run summaries
- project summaries
- objective summaries / trees where useful
- inbox / notification summaries where useful

#### 7.10 Scope boundary

The intent is not "every REST endpoint automatically becomes an MCP tool." The intent is that every important user-facing Knotwork operation has a coherent MCP path if it belongs to Phase 1 and is meaningful in chat.

Still UI-only in S12:

- drag-and-drop canvas editing
- highly visual editing workflows that do not translate well to chat
- sensitive account/member-management flows if they require stronger confirmation UX

**Review discipline:** every time section 7 changes, refresh the OpenAPI baseline first, then compare the section against real path families before expanding or cutting MCP scope.

#### 7.11 MCP implementation plan

Build MCP from the OpenAPI baseline in this order:

1. **Workspace-scoped transport**
   - MCP server authenticates with `KNOTWORK_API_URL`, `KNOTWORK_API_TOKEN`, and `KNOTWORK_WORKSPACE_ID`
   - MCP talks to Knotwork through the HTTP API, not through a second private backend contract
2. **Read-first operational coverage**
   - workspace overview
   - active runs
   - open escalations
   - inbox summary
   - graph list
   - objective/project list
   - channel thread reads
3. **Core write flows**
   - trigger / abort run
   - resolve escalation
   - create / update objective
   - post channel message
   - update knowledge file
   - mark inbox read / archive
4. **Participant and agent management**
   - list participants
   - inspect delivery preferences
   - list / inspect / update registered agents
5. **Resources before endpoint sprawl**
   - add MCP resources for high-context reads such as workspace overview, active runs, open escalations, and inbox summary before expanding into every narrow endpoint
6. **Parity review**
   - maintain a mapping from OpenAPI path families to MCP tool/resource coverage
   - intentional omissions must be documented as UI-only, permission-sensitive, or low-value in chat

### 8. Workspace bulletin

One workspace-wide channel (`channel_type: "bulletin"`) where any workspace member can post updates and announcements. All workspace members are auto-subscribed. This is the team-scope communication surface — distinct from project-scoped channels.

## Explicitly Out of Scope

- Agent Zero (→ S12.2)
- Agent identities as representatives (→ S12.2)
- WorkspaceRepresentative model (→ S12.2)
- Plugin/MCP boundary clarification (→ S12.1)
- OpenClaw/MCP split enforcement (→ S12.1)
- Workload-honesty redesign (→ S12.2)
- Agent chat participation, handbook mentions (→ beyond Phase 1)

## Key Files

**Backend — delete:**
- `runtime/nodes/llm_agent.py`
- `runtime/nodes/human_checkpoint.py`
- `runtime/nodes/conditional_router.py`

**Backend — modify:**
- `runtime/nodes/agent.py` — simplify `_resolve_agent_ref()`, supervisor-based escalation
- `runtime/engine.py` — comment cleanup
- `runtime/validation.py` — validate unified `agent` type only
- `designer/agent.py` — system prompt: document only `agent` type
- `designer/parser.py` — default to `type: "agent"`
- `escalations/service.py` — fix `try/except pass`, supervisor routing
- `bootstrap/default_workflows.json` — convert legacy workflows
- `mcp/server.py` — MCP server (whole-product surface, not just project/task tools)
- `mcp/` tool/resource bindings — graph/run/escalation/objective/project/knowledge/channel/inbox/agent coverage
- `channels/` — bulletin channel type

**Frontend — delete:**
- `components/designer/config/LlmAgentConfig.tsx`
- `components/designer/config/HumanCheckpointConfig.tsx`
- `components/designer/config/ConditionalRouterConfig.tsx`

**Frontend — modify:**
- `types/index.ts` — `NodeType = 'agent' | 'start' | 'end'`
- `components/designer/NodeConfigPanel.tsx` — remove legacy labels, operator dropdown with real names
- `components/designer/config/AgentNodeConfig.tsx` — supervisor field, real name dropdown
- `components/canvas/graphCanvasConstants.ts` — remove legacy colors
- `utils/validateGraph.ts` — remove legacy-specific checks
- `components/operator/DecisionCard.tsx` — branch picker, timeout countdown

## Acceptance Criteria

1. Only one node type (`agent`) exists in the codebase. Legacy types are gone — dead code deleted, legacy data converted at load time.
2. Every node has a supervisor field. Escalations route to the assigned supervisor; others see read-only.
3. Graph editor shows real names in the operator dropdown: "Hieu (member)", "Wed (agent)".
4. DecisionCard has interactive branch selection when a node escalates with multiple outgoing edges.
5. DecisionCard shows timeout countdown from `timeout_at`. Warns when <1 hour remains.
6. Channel notification failures are logged, not silently swallowed.
7. A checked-in OpenAPI baseline exists and section 7 is reviewed against it rather than only by recollection.
8. MCP server is planned and implemented as a coherent whole-Knotwork surface, not just a narrow set of project/task wrappers.
9. The MCP surface covers the major Phase 1 product areas that the backend already exposes meaningfully for chat: workflow, run, escalation, objective/project, knowledge, channel, inbox/notification, and participant/agent operations.
10. Section 7 no longer claims missing or obsolete task-first scope when the baseline is objective-first.
11. Workspace bulletin channel exists and any workspace member can post announcements.
