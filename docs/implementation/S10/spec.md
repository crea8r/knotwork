# Session 10 — Agent-Usable Release

## Goal

Make Knotwork ready for agents to use as first-class operators.

## Core Decisions To Finalize

1. Access model for user-provided agents.
2. Whether user-provided agent may receive full workspace access.
3. Trust boundaries, permissions, and audit expectations for agent-initiated actions.
4. Human override and kill-switch design for agent-driven operations.

## In Scope

1. Agent-first interaction model where users can operate through their own agents.
2. Permission model and enforcement for agent actions.
3. Security controls and visibility for agent-driven changes.
4. Clear operator UX for reviewing and governing agent behavior.

## Non-Goals

1. Phase 2 feature set (cron, Slack, advanced roles, per-node chat, sub-graphs, auto-improvement loop).

## Acceptance Criteria

1. Agent-driven actions are policy-constrained and auditable.
2. Humans can understand what an agent did and why.
3. Human operators can interrupt/override at any point.
4. S10 model is production-safe for agent-mediated operation.
