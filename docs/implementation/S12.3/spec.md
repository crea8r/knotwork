# Session 12.3 — Participant Coordination

Status: **Completed** on 2026-04-08.

Validation:
- S12.3 focused backend tests: 9 passed.
- MCP server tests: 8 passed.
- Frontend typecheck: passed.
- OpenClaw bridge message-response policy tests: 4 passed.

Completed scope note: channel participation is implemented as visible membership,
subscription, and routing behavior. Strict enterprise read/write ACLs remain out
of scope for S12.3.

## Goal

Introduce the coordination layer for a workspace whose members may be humans, agents, or both.

Knotwork must work perfectly without agents. S12.3 should not add "agent features" as a separate architecture. It should add human-usable coordination primitives that agents can also participate in through the bridge from S12.2.

## Foundation

- **S12.1:** Humans and agents are unified as `WorkspaceMember` records. Agents authenticate with ed25519 challenge-response and use the same API surface as humans.
- **S12.2:** The bridge lets agents consume normal participant surfaces: inbox, channels, guide, skills, and MCP/API.

S12.3 builds on that by making participation, contribution intent, responsibility, and workload visible.

## Principles

1. **No free-for-all access.** Channel participation must be visible. Members should not be silently included in every channel by default.
2. **AgentZero is a member role, not an agent architecture.** One member per workspace can hold the AgentZero role. That member can be human or agent. The role means "broadest workspace context to consult," not special runtime access.
3. **Every member needs a contribution brief.** Each member should have a short workspace role and objective statement, such as product, marketing, CMO, customer support, or onboarding. This tells other members how that person or agent should contribute to project objectives.
4. **Representatives are mostly agent/member behavior, not Knotwork rules.** As Knotwork shifted to "works perfectly without agents," representative work should be treated as how a human or agent is set up to behave, not as a Knotwork-managed runtime role. Knotwork may expose member context and normal MCP/API tools, but it should not own the external communication workflow.
5. **Workload honesty is a communication protocol.** It applies to humans and agents. Humans can report status manually; agents/bridges can report status automatically. Knotwork should surface this honestly through UI and MCP instead of hiding it in app-only queue code.

## Scope

### 1. Channel Participation

S12.3 defines who is participating in each channel.

Required behavior:
- Show channel participants.
- New channels do not automatically include every workspace member.
- Members can invite another member into a channel.
- Mentioning a non-participant should create an explicit invite/add flow, not silent global access.
- Top-line project channels can include AgentZero members by default.
- Detail channels can stay narrower.

Open decision:
- Whether S12.3 enforces channel participation as read/write permission immediately, or first ships it as visible subscription/routing with stricter ACLs later. The product behavior must still stop presenting channels as invisible free-for-all spaces.

### 2. AgentZero Role

AgentZero is a single-member role for the person or machine with the broadest workspace context to consult.

An AgentZero member may:
- Onboard members
- Explain workspace norms
- Consult other members when work is unclear
- Keep top-line project channels updated
- Maintain or propose updates to shared knowledge
- Notice stalled work or overloaded members
- Suggest when to invite another person or agent
- Bring cross-project or external context into the right channel

Implementation direction:
- Model AgentZero as a role assigned to a `WorkspaceMember`, not as an agent-only role.
- The role can be assigned to one human or agent per workspace.
- Show a compact visual indicator on AgentZero avatars so members know who to consult for broad context.
- Explain the concept through an icon-triggered popover/tooltip, not inline explanatory text.
- If `agent_config.role = "orchestrator"` remains for compatibility, it must not be the source of access or permissions.
- Access still follows channel/project participation; AgentZero does not imply workspace-wide read access.

### 3. Agent Zero

Agent Zero is an agent member assigned the AgentZero role.

It:
- Connects through the same S12.2 bridge path as any other agent
- Can run onboarding conversations when assigned the AgentZero role
- Can be consulted from an objective through a private one-on-one consultation session
- Can be included in top-line project channels according to channel participation rules
- Can monitor work only through normal permitted surfaces
- Can propose knowledge updates, new agents, or coordination actions, with human approval where writes or new members are involved

It does not:
- Get workspace-wide read access by default
- Create a special channel model
- Use an `@agentzero` handle
- Intervene in group chat by default
- Become required for the workspace to function

### 4. Representatives

A representative is a member accountable for external-facing context.

Representatives may:
- Bring client, vendor, contractor, or outside conversation updates into Knotwork
- Update relevant project/channel context
- Trigger structured work through MCP/API when needed
- Receive relevant internal events first when the workspace chooses that routing rule

Representatives are not a separate runtime and should not become a Knotwork rule system. The representative behavior mostly belongs in the human or agent setup: what context they watch, what external tools they use, and how they bring outside information into normal Knotwork channels/projects. Knotwork stays agent-optional by exposing member profiles, participation, and MCP/API tools rather than enforcing a representative-specific data model.

### 5. Member Contribution Brief

Each workspace member should have a short description of their role and objective in the workspace.

Examples:
- Product: clarify user problems, shape objectives, and keep scope coherent.
- Marketing: turn product progress into positioning, campaigns, and market feedback.
- CMO: set growth priorities and decide which market signals matter.
- Customer support: bring customer pain into project objectives and validate fixes.
- Onboarding: help new members understand channels, norms, and first tasks.

Implementation direction:
- Attach the contribution brief to `WorkspaceMember`, not only to the user account, because the same member may play different roles in different workspaces.
- Keep it short enough to scan in member/profile surfaces.
- Make it editable by the member, with owner edit support if needed for agents or managed workspaces.
- Expose it through UI and MCP/bridge surfaces so humans and agents can route objective work to the right contributor.
- Use it as guidance, not permission. Channel/project participation still controls access.

The contribution brief should inform:
- Who should be consulted for an objective.
- Which member is likely to contribute useful context.
- How AgentZero routes or frames private consultation suggestions.
- How workload/status should be interpreted in the context of the member's role.

### 6. Agent Message-Response Policy

Agent participants must not treat every delivered channel event as an invitation
to speak. In channels with more than one agent, answering every
`message_posted` event creates feedback loops and race conditions.

Required behavior for agent bridges:
- If a `message_posted` event directly mentions the agent, the agent should
  answer when it can help.
- If the message mentions another member and does not mention this agent, the
  agent must not answer. It should emit a no-op action and archive the delivery.
- If the message mentions nobody, the agent should first check whether it is
  already directly involved in the recent message chain. If yes, it may answer
  when useful.
- If the message mentions nobody and the agent is not already involved, it
  should compare the message against its member role/objective/contribution
  brief and the channel/project/objective context. It should answer only when
  the message is clearly in scope for its contribution; otherwise it should
  no-op.
- If another member is a better owner for the work, the agent should avoid
  competing replies. It may mention or defer to that member only when doing so
  clearly improves coordination and does not create a loop.

Implementation direction:
- The bridge should apply a deterministic pre-LLM gate for the unambiguous
  case: "mentions other member(s), not self" -> no-op.
- The bridge should include response policy context in the model prompt:
  self participant id, display name, mention handle, workspace role,
  contribution brief, channel participants, detected mentions, whether the
  current message directly mentioned the agent, and whether the agent was
  recently involved in the thread.
- MCP should expose primitives needed by any bridge: current member, workspace
  participants/members, channel participants, channel messages with metadata,
  project dashboard, objective chain, and channel assets. MCP should not decide
  whether OpenClaw speaks; that is adapter policy.

Channel-specific context rules:
- Asset channels should continue loading attached files/folders.
- Objective channels should load the current objective plus upstream objectives
  to the root.
- Run channels should load run and node context.
- Normal/free chat channels should load recent messages, participants, mention
  metadata, and the agent's contribution brief. They should default to no-op
  unless directly addressed, already involved, or clearly in the agent's scope.
- Project channels should load project dashboard/status/objectives in addition
  to participants and recent messages. They should use the same mention gate,
  but relevance is evaluated against the project plus the agent's contribution
  brief.

### 7. Workload Honesty

Historical workload-honesty work came from an old OpenClaw-centric design where the plugin owned task claiming, queue semantics, and backpressure. That assumption is no longer valid after S12.1/S12.2:

- MCP/API is the participant-to-Knotwork surface.
- The bridge/plugin is an agent-side participant client, not a Knotwork-side execution authority.
- Do not implement the old plugin-centric state machine or node-level `compute_intensity` claim behavior as written.

The product requirement remains:
- Work should not sit under a generic `pending` label when the system knows more.
- Members should be able to see whether someone is available, busy, blocked, overloaded, or gone quiet.
- Operators should have enough information before and after assigning work to make reasonable decisions.
- Queue/backpressure signals should be honest for humans and agents.

S12.3 should express this as member status and recent work:
- Availability/status: `available`, `focused`, `busy`, `away`, or `blocked`
- Qualitative capacity: `open`, `limited`, or `full`
- Optional status note
- Current commitments, participant-reported until ownership can be derived honestly
- Recent work, participant-reported until objective/run ownership can produce it automatically
- Last status update timestamp; last seen or heartbeat when available
- Exact slots only when a bridge can honestly report them

Run/task labels can consume these signals:
- `unclaimed`
- `queued`
- `running`
- `stalled`
- `orphaned`

But those labels are not the core architecture. The core architecture is a participant status protocol surfaced through member profiles, channel context, UI, and MCP/bridge access. S12.3 stores these signals on the workspace member profile so humans can update them manually and agents/bridges can report them through MCP without owning Knotwork's queue truth.

## Out of Scope

- Unified participant model (done in S12.1)
- Bridge software/plugin rewrite (done in S12.2)
- Agent-only coordination architecture
- Knotwork-managed external CRM/email/Slack workflows
- Representative-specific runtime, data model, or routing rules
- Full enterprise ACL system beyond S12.3 participation rules
- The old OpenClaw workload-honesty implementation plan

## Acceptance Criteria

1. Channel participants are visible, and channels no longer behave as implicit free-for-all spaces.
2. Mentioning or inviting a non-participant has an explicit add/invite flow.
3. The AgentZero role can be assigned to exactly one human or agent member per workspace.
4. Agent Zero is modeled as an agent member with the AgentZero role using the normal bridge path, not a special runtime.
5. Representative work remains outside Knotwork runtime scope unless it can be expressed through normal member setup, channel participation, and MCP/API behavior.
6. Member profiles expose role/objective brief, status, busyness, current commitments, and recent work.
7. Workload honesty is exposed through UI and MCP/bridge surfaces as participant status, with run/task labels consuming those signals.
8. The old workload-honesty assumptions are merged into this spec as historical context and are not implemented as written.
9. Agent bridges do not answer every `message_posted` event. They no-op when
   another member is explicitly mentioned, and they use member role/objective
   plus channel/project context before responding to unmentioned messages.
