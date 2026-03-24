# Session 9.4 — Deferred

## Goal

This session is no longer planned in S9. The OpenClaw transport upgrade has been deferred to S12.1 so it can be re-evaluated after the S12 MCP/plugin split changes the role of the OpenClaw plugin.

## Context

The original S9.4 proposal assumed the plugin would continue to be both the Knotwork transport and the OpenClaw execution environment. That assumption changes in S12, where the plugin/MCP boundary is reworked and the plugin is expected to become an inbound communication path only.

Because of that architectural dependency, the transport decision should be made after S12 lands:

- if the plugin remains timer-driven and the remaining traffic pattern is still noisy or operationally weak, revisit WebSocket in S12.1
- if S12 materially reduces plugin responsibilities and request volume, the added complexity of WebSocket may no longer be worth it

See `docs/implementation/S12.1/spec.md` for the deferred transport-upgrade spec.
