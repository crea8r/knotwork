# S12.3 Plan — Participant Coordination

Status: **Completed** on 2026-04-08.

Validated with:
- `pytest ../docs/implementation/S12.3/tests/ -q` — 9 passed.
- `pytest tests/test_mcp_server.py -q` — 8 passed.
- `npx tsc --noEmit` — passed.
- `npm test` in `agent-bridge/plugins/openclaw` — 4 passed.

Scope boundary: S12.3 completed visible channel participation, subscription, and
routing behavior. Fine-grained read/write ACLs remain a Phase 2 concern.
Representative work is mostly outside Knotwork runtime scope: it belongs in how
a human or agent member is configured to watch context, use external tools, and
bring updates back through normal channels/MCP/API.

## Aim

Implement the S12.3 spec as a human-first coordination layer:

- Channel participation is visible and explicit.
- Members publish a short workspace role/objective brief that guides how they contribute.
- AgentZero role can attach to one human or agent per workspace.
- Agent Zero is an agent with the AgentZero role, not a separate architecture.
- Member status exposes busyness, commitments, and recent work through UI and MCP/bridge surfaces.

Do not revive the old OpenClaw workload-honesty plan. Workload honesty is participant status and communication, not plugin-owned queue code.

## Track 1 — Channel Participation

Define the minimum participation model needed for S12.3.

Deliver:
- Participant list on channel detail/header.
- Add/invite member flow for channels.
- Workspace owner can remove a member from a channel.
- Any member can leave a channel.
- Mentioning a non-participant opens an explicit add/invite path.
- New channels stop silently including every workspace member by default.
- Top-line project channels can include AgentZero members by default.
- Existing channels with no explicit participation record show a clear default state: every workspace member is currently participating. Do not hide implicit members.

Decision to make before coding:
- Whether participation is a hard read/write permission in S12.3 or a visible subscription/routing layer first.

Acceptance:
- A user can see who is in a channel.
- A user can add another member intentionally.
- A workspace owner can remove a member from a channel.
- A member can leave a channel themselves.
- Existing channels without explicit participation data clearly show that all workspace members are participating.
- A mention does not silently grant invisible workspace-wide access.

## Track 2 — AgentZero Role

Add the AgentZero role as a member role before adding Agent Zero behavior.

Deliver:
- Assign the AgentZero role to one workspace member.
- The role can be held by a human or agent.
- Assigning a new AgentZero clears the previous AgentZero member.
- Explain the concept with a compact help icon and popover/tooltip, not inline explanatory text.
- Show a visual indicator on AgentZero avatars wherever member avatars appear in channel/member coordination surfaces.

Keep lightweight:
- Do not make the role the same thing as access. Access still follows channel/project participation.
- Do not require an agent for this role; Knotwork must work in human-only workspaces.

Acceptance:
- A human can hold the AgentZero role.
- An agent can hold the AgentZero role.
- Only one workspace member can hold the AgentZero role at a time.
- AgentZero members have a visible avatar indicator.
- The UI explains that AgentZero can be human or machine without persistent inline copy.

## Track 3 — Agent Zero

Layer Agent Zero on top of member responsibilities.

Deliver:
- Register or designate an agent member with the AgentZero role.
- Add objective-scoped private consultation as the first intervention point.
- Consultation opens a one-on-one session with the current AgentZero member and the requesting member.
- Consultation can use objective/project context without posting into the objective group chat.
- Optional onboarding flow that assigns Agent Zero to top-line project channels according to participation rules.
- Agent Zero uses the normal S12.2 bridge path.
- Agent Zero monitoring is limited to permitted channel/project/member-status surfaces.

Do not add:
- Workspace-wide read access by default.
- Agent-only coordination channels.
- `@agentzero` handle.
- Automatic group-chat intervention.
- Special runtime APIs for Agent Zero.

Acceptance:
- Agent Zero can be configured without changing the participant model.
- The same role can be held by a human.
- Objective detail can start a private AgentZero consultation.
- Consultation output stays private unless the requester explicitly shares it.

## Track 4 — Member Status and Workload Honesty

Expose contribution intent and workload as member profile signals.

Deliver:
- Member role/objective brief: a short workspace-specific statement like product, marketing, CMO, customer support, onboarding, or equivalent.
- The brief guides how a member contributes to objectives coming from workspace projects.
- Member can edit their own brief; owner can edit if needed for agents or managed workspace setup.
- Expose the brief anywhere member context is used for routing or consultation, without bloating dense channel displays.
- Member profile status: `available`, `focused`, `busy`, `away`, or `blocked`.
- Qualitative capacity: `open`, `limited`, or `full`.
- Optional status note.
- Current commitments as a participant-reported list until assignment ownership is explicit enough to derive it.
- Recent work as a participant-reported list until objective/run ownership can produce it automatically.
- Last status update timestamp. Last seen or heartbeat can be layered on when a bridge can honestly report it.
- Exact slots only when a bridge can honestly report them.

Bridge/MCP:
- Expose member role/objective brief, status, capacity, commitments, and recent work through MCP.
- Provide an MCP write path for participants to update their own profile/status.
- Allow agent bridge status reports without making the plugin the owner of queue truth.

UI:
- Show the role/objective brief on member profile/detail surfaces.
- Let AgentZero consultation use the brief when suggesting who should help with an objective.
- Show status, capacity, commitments, and recent work in member profile.
- Show status context near assignment and routing decisions.
- Run/task labels may use `unclaimed`, `queued`, `running`, `stalled`, and `orphaned`, but only as consumers of participant status.

Acceptance:
- Humans and agents can have a workspace-specific role/objective brief.
- Objective routing and consultation can use the brief as guidance.
- Humans can update or expose status manually.
- Agents can report status through bridge/MCP surfaces.
- Operators can tell whether a member is busy, blocked, unavailable, or recently active.

## Validation

Before closing S12.3:

- Human-only workspace can use channel participation, AgentZero role, and member status.
- Agent Zero can be added as an agent with the AgentZero role without special runtime behavior.
- A detail channel can exclude Agent Zero while a top-line project channel includes it.
- Member profile shows role/objective brief, status, and recent work.
- MCP exposes enough member status for agents to coordinate honestly.
- Existing channel routing and authorship continue to use normal participant/member identity.
- No old OpenClaw-centric workload queue behavior is implemented as the source of truth.
