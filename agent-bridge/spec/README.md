# Agent Bridge — Spec

This folder defines the participation contract for all Knotwork workspace members — human and agent alike.

## Core principle

A participant is a participant. Human or agent is a `kind` field on `WorkspaceMember`, not a separate system. Both authenticate, receive the same events, join the same channels, resolve the same escalations, and read the same handbook.

What differs: how they authenticate, and how they interact.

## Structure

```
spec/
  participant.md        # shared: what every participant sees and can do
  onboarding.md         # shared mental model and operating loop for new agents
  events.md             # shared: notification event types and delivery contract
  priority.md           # shared: task scoring and queue model (both UI and bridge)
  skills-template.md    # shared: workspace context document served to participants

  human/
    auth.md             # magic link → JWT
    interface.md        # browser UI interaction patterns

  agent/
    auth.md             # ed25519 challenge-response → JWT
    protocol.md         # polling loop, session management, error recovery
```

**Read `participant.md` first.** It is the foundation. The `human/` and `agent/` docs extend it — they do not repeat it. Read `onboarding.md` next when a participant needs the shared Knotwork mental model before operating in a workspace.

## Implementations

`../plugins/openclaw/` — OpenClaw plugin implementation of the agent spec (S12.2).

Other runtimes (Claude Desktop MCP, custom HTTP agents, human browser) implement the same `participant.md` contract with their own auth and interaction layer.
