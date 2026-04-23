# Session 12.2 Extension Plan — OpenClaw Semantic Layer

## Goal

Add a semantic action layer on top of the existing OpenClaw transport/runtime implementation.

The current plugin code already works as a transport layer:

- authenticate to Knotwork
- poll inbox
- load guide and channel context
- execute OpenClaw subagent sessions
- post back to Knotwork

This extension must preserve that working transport behavior while introducing a clean semantic layer for:

- private agent thinking sessions
- structured action envelopes
- capability-aware dispatch
- future transport replacement with Knotwork MCP or another client surface

## Design Principle

The plugin must be split into two layers with a hard boundary:

1. **Transport layer**
   - OpenClaw session/runtime integration
   - Knotwork REST calls
   - polling, auth, retries, archive/ack
   - no product semantics beyond request/response

2. **Semantic layer**
   - prompt contract for "thinking, not chatting"
   - action-envelope schema and parsing
   - capability snapshot
   - semantic dispatch rules
   - no direct dependency on REST helpers or OpenClaw runtime objects

This boundary is required so a future `KnotworkMcpTransport` can replace the current REST-backed transport with minimal semantic-layer changes.

## Non-Goals

- rewriting the current plugin transport flow
- changing poll/auth/lease/concurrency behavior unless required for the new seam
- migrating to Knotwork MCP in S12.2

## Current Constraint

The current transport code is working and must remain stable:

- `agent-bridge/plugins/openclaw/src/openclaw/bridge.ts`
- `agent-bridge/plugins/openclaw/src/openclaw/session.ts`
- `agent-bridge/plugins/openclaw/src/lifecycle/worker.ts`
- `agent-bridge/plugins/openclaw/src/plugin.ts`

The semantic-layer implementation must be additive first, then selectively wired in behind feature flags.

## Target Architecture

### Runtime coordinator

The runtime coordinator remains responsible for:

- polling inbox events
- preparing the task object
- invoking a thinking runtime
- archiving the delivery
- preserving plugin-level health, retry, and logs

### Transport interfaces

Introduce stable interfaces that the semantic layer depends on:

- `ThinkingRuntime`
- `KnotworkTransport`

The initial concrete implementations will wrap existing code:

- `OpenClawThinkingRuntime` -> existing `session.ts` mechanics
- `KnotworkRestTransport` -> existing `bridge.ts` REST helpers

### Semantic core

The semantic core will own:

- `ActionEnvelope` schema
- strict `json-action` parsing
- prompt builder for action-protocol mode
- capability snapshot generation/consumption
- action dispatcher
- semantic orchestration

## Directory Plan

Add new files without disturbing current ones:

### Transport

- `agent-bridge/plugins/openclaw/src/transport/contracts.ts`
- `agent-bridge/plugins/openclaw/src/transport/knotwork-rest-transport.ts`
- `agent-bridge/plugins/openclaw/src/transport/openclaw-thinking-runtime.ts`

### Semantic

- `agent-bridge/plugins/openclaw/src/semantic/types.ts`
- `agent-bridge/plugins/openclaw/src/semantic/parser.ts`
- `agent-bridge/plugins/openclaw/src/semantic/prompt-builder.ts`
- `agent-bridge/plugins/openclaw/src/semantic/dispatcher.ts`
- `agent-bridge/plugins/openclaw/src/semantic/orchestrator.ts`

The current files stay in place as backing implementations.

## Semantic Protocol

### Core rule

The subagent session is private thinking state.

The agent must not use its final message as normal chat output.

The only valid external product of a semantic task is one strict action envelope:

````text
```json-action
{ ... }
```
````

### Envelope goals

- machine-validated
- typed actions
- batchable
- idempotent
- capability-aware
- transport-agnostic

### Initial action set

S12.2 initial supported actions:

- `channel.post_message`
- `control.noop`
- `control.fail`

Planned next actions after the seam is stable:

- `escalation.resolve`
- `knowledge.propose_change`

## Transport Contracts

### ThinkingRuntime

The semantic layer should depend on a runtime with one job:

- take prompt inputs
- run private agent thinking
- return raw final text for semantic parsing

It must not interpret semantic meaning itself.

### KnotworkTransport

The semantic layer should depend on a transport with semantic-facing methods such as:

- `getCapabilitySnapshot(trigger)`
- `loadThinkingContext(trigger)`
- `postChannelMessage(...)`
- `resolveEscalation(...)`
- `proposeKnowledgeChange(...)`
- `archiveDelivery(...)`
- optional later: `emitSignal(...)`

The semantic layer must not import `fetch()` helpers, OpenClaw gateway helpers, or direct REST endpoints.

## Capability Model

The semantic layer must reason from an explicit capability snapshot, not from implicit assumptions.

Initial capability snapshot can be conservative:

- action booleans for currently supported action types
- `postAllowed` limited to the trigger channel at first
- `signalAllowed` empty

Later, this can grow to:

- cross-channel post authorization
- explicit escalation and proposal permissions
- signal permissions

## Rollout Strategy

### Feature flags

Add config flags:

- `semanticActionProtocolEnabled`
- `semanticActionStrictMode`

Behavior:

- disabled -> current legacy path only
- enabled + non-strict -> try semantic path, allow temporary legacy fallback
- enabled + strict -> semantic envelope required

This keeps the current transport path safe during migration.

## Implementation Tracks

### Track 1 — Add seam only

Objective:
- introduce transport interfaces and wrappers
- zero behavior change

Work:
- add `contracts.ts`
- add `knotwork-rest-transport.ts`
- add `openclaw-thinking-runtime.ts`
- wrap existing `bridge.ts` and `session.ts`

Acceptance:
- build passes
- current plugin behavior unchanged

### Track 2 — Add semantic core

Objective:
- add schema, parser, prompt builder, dispatcher, orchestrator
- no worker integration yet

Work:
- add semantic files
- define `ActionEnvelope`, `DispatchResult`, `CapabilitySnapshot`
- add strict parser for `json-action`
- add semantic prompt contract
- add dispatcher with mocked transport dependency only

Acceptance:
- parser and dispatcher tests pass
- no runtime behavior change

### Track 3 — Wire semantic path behind flag

Objective:
- allow `worker.ts` to choose legacy or semantic handling

Work:
- keep existing poll/claim/archive flow
- add a semantic execution branch
- preserve legacy branch untouched as fallback

Acceptance:
- semantic mode can run a mention/reply flow
- legacy mode still works unchanged

### Track 4 — Support first safe action subset

Objective:
- prove the architecture with the smallest durable action set

Supported actions:
- `channel.post_message`
- `control.noop`
- `control.fail`

Acceptance:
- agent can think privately and emit a message-post action
- plugin posts only when the envelope instructs it to
- no more implicit "completed output = channel post" assumption in semantic mode

### Track 5 — Expand semantic actions

Objective:
- add more business actions after the seam is stable

Next actions:
- `escalation.resolve`
- `knowledge.propose_change`

If an agent believes another workspace member should do the work, it should ask that member through normal `channel.post_message` content and mentions. This remains channel-level collaboration, not a first-class task/delegation action.

Acceptance:
- each action type has transport adapter support
- capability checks exist before execution

## Minimal File Touch Plan

### Existing files with low-risk changes only

#### `agent-bridge/plugins/openclaw/src/openclaw/bridge.ts`

- keep current helper behavior
- export or wrap existing helpers as needed
- do not convert this file into semantic logic

#### `agent-bridge/plugins/openclaw/src/openclaw/session.ts`

- keep OpenClaw session execution mechanics
- reuse only as a thinking-runtime backend
- do not put action dispatch rules here

#### `agent-bridge/plugins/openclaw/src/lifecycle/worker.ts`

- keep poll loop and archive behavior
- add one semantic branch behind feature flag
- do not rewrite worker state model

#### `agent-bridge/plugins/openclaw/src/plugin.ts`

- add feature-flag config plumbing only
- preserve startup/auth/timer behavior

## Testing Plan

### Unit tests

- semantic envelope parser
- prompt builder
- dispatcher with mocked transport
- orchestrator with mocked runtime and transport

### Integration tests

- semantic mode off -> current behavior unchanged
- semantic mode on -> `channel.post_message` works end-to-end
- malformed semantic output -> rejected in strict mode

### Regression focus

- inbox polling still works
- guide loading still works
- auth renewal still works
- archive/read behavior still works
- worker concurrency and timers remain unchanged

## Acceptance Criteria

1. The plugin has a distinct semantic layer that depends on interfaces, not direct REST/OpenClaw helpers.
2. The current transport implementation remains the default working path during rollout.
3. Semantic mode can be enabled behind config flags without breaking legacy mode.
4. The first semantic action batch can post a channel message only when explicitly instructed by a valid action envelope.
5. The semantic layer can be backed by a future MCP transport without rewriting parser, prompt builder, dispatcher, or orchestrator.
## Recommended First Milestone

Implement Tracks 1 through 4 only:

- add transport interfaces
- add semantic core
- wire feature flag
- support `channel.post_message`, `control.noop`, and `control.fail`

This is the smallest slice that creates the long-term architecture while respecting the existing transport layer.
