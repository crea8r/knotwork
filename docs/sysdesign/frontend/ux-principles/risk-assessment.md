# UX Risk Assessment

This document captures likely UX risks that arise from the design philosophy in
`mental-model.md`, `principles.md`, and `ux-patterns.md`.

## Summary

Knotwork's UX direction is coherent and disciplined: reduce unnecessary user
decisions, organise around the user's mental state, separate strategy from
operation, and keep agents as the baseline without making them a requirement.

The main execution risk is not conceptual inconsistency. The main risk is that a
high-abstraction UX can become hard to understand, hard to debug, or hard to
trust when defaults are wrong, agent quality is uneven, or users need lower-level
control.

## Core UX Principle

The core UX principle is:

**Users should think about their work, not about the software.**

This leads to several design commitments:

- Navigation is built around human questions, not product modules:
  - `Now` = what needs me right now?
  - `Work` = what am I working on?
  - `Knowledge` = how do we do things here?
- The system should make routine decisions by default and hide unnecessary
  configuration.
- Durable decisions are distinct from chat messages.
- Assets are the strategic core; projects are the container for active work.
- Agents are the intended default, but every surface must remain valid in
  human-only mode.
- Knowledge is treated as a work queue rather than a passive library.
- Runs are intentionally backgrounded so users focus on objective movement, not
  execution mechanics.
- Chat exists as a parallel surface for ambiguous intent.

## Risk Areas

### 1. Hidden system complexity

The design intentionally hides runs, workflow mechanics, and many channel types
behind human-first framing. This reduces clutter, but it also creates a risk:
when users need to debug behavior, inspect execution history, or understand why
something happened, the system may feel opaque.

Likely consequence:
- Advanced users may struggle to build trust because the system explains outcomes
  better than mechanisms.

### 2. Defaults become invisible product decisions

The design filter says the software should make sensible defaults 80% of the
time. That improves flow when defaults are correct, but when they are wrong, the
user may not understand what assumption was made or where to override it.

Likely consequence:
- Users experience loss of control rather than convenience when the system's
  guess does not match their intent.

### 3. Discoverability tradeoff

The IA deliberately removes classic product categories like Channels, Runs,
Handbook, and Graphs from primary navigation. This supports the mental model, but
it reduces discoverability of what the system can actually do.

Likely consequence:
- New users may understand the framing of the product before they understand the
  capabilities of the product.

### 4. Person-centered framing conflicts with project-centered structure

The docs strongly emphasize that the person, not the project, should be the
frame. But the actual execution model still depends on projects:

- runs belong to projects
- objective detail is project-scoped
- project channels are the main operating context

Likely consequence:
- Users may encounter a mismatch between the way the app describes work and the
  way the system actually stores and constrains work.

### 5. Forced project requirement introduces friction

The docs explicitly state that nothing can run without a project. That gives runs
context, but it makes lightweight experimentation harder. The default-project
approach for solo users reduces the friction without eliminating the structural
constraint.

Likely consequence:
- Users with simple or exploratory workflows may feel the project model is
  overhead imposed by the system rather than a reflection of how they work.

### 6. Knowledge quality depends heavily on agent quality

Knowledge is framed as a review queue, not a library. That works only if the
agent can surface useful, timely, trustworthy proposals. If the proposals are
weak, repetitive, or irrelevant, the whole surface loses value.

Likely consequence:
- The Knowledge surface risks feeling empty, noisy, or ceremonial instead of
  operationally useful.

### 7. Ownership boundaries may be unclear

The intended split is elegant: the agent observes and prepares, the human
reviews and redirects. In real use, users may still be unclear about whether an
agent has merely suggested something, already acted, or changed durable state.

Likely consequence:
- Trust erosion when users cannot quickly tell what is advisory versus what is
  committed state.

### 8. Chat and structured UI may split the mental model

The design says structured UI is for precise maintenance and chat is for
ambiguous intent. That is sensible, but many real tasks are mixed. Users may not
know when to stay in chat, when to switch to structured UI, or whether both
surfaces are equally authoritative.

Likely consequence:
- The same task may feel like it has two entry points with unclear boundaries.

### 9. Clean navigation can hide operational accountability

Runs, audit trails, and passive channels are pushed behind secondary access. This
keeps the main surfaces calm, but can also bury history and reduce visibility
into how work progressed.

Likely consequence:
- Operational accountability becomes harder unless secondary views are very easy
  to reach from the context where the question arises.

### 10. Valid empty states can still feel unhelpful

The docs correctly state that empty states should be valid states, not broken
states. That is necessary, especially for no-agent mode. But a valid empty state
can still feel like a dead product state if it does not lead to meaningful next
action.

Likely consequence:
- Human-only mode may technically work while still feeling underpowered or
  under-guided.

### 11. Mobile-first may compress expert workflows too far

The commitment that every action must be fast on a phone is valuable, especially
for escalations. The risk is that strategic tasks, debugging flows, and deep
knowledge maintenance may be simplified around mobile constraints more than the
desktop use case warrants.

Likely consequence:
- Expert workflows lose depth or efficiency in order to preserve a universal
  mobile interaction model.

## Most Important Design Tensions To Watch

These are the tensions most likely to determine whether the UX succeeds:

- simplicity vs debuggability
- defaulting vs user control
- abstraction vs discoverability
- person-centered framing vs project-bound execution model
- agent-led preparation vs user trust

## Recommended Validation Questions

These questions should guide future UX refinement:

- When a default is wrong, can users see what happened and correct it quickly?
- When a run behaves unexpectedly, can users trace why without leaving their
  working context?
- Can a first-time user explain where workflows live, where runs live, and how
  Knowledge differs from Work after a short session?
- In human-only mode, does each primary surface still feel useful, not merely
  non-broken?
- Can users tell at a glance what the agent suggested, what the human approved,
  and what the system already committed?

## Bottom Line

The UX philosophy is strong. The likely failure mode is not "confusing
information architecture" in the usual sense. The likely failure mode is
**elegant opacity**: a system that feels conceptually clean at the top level but
becomes hard to inspect, predict, or trust at the edges.

The implementation should therefore prioritize:

- visible system state when needed
- strong escape hatches to lower-level detail
- explicit ownership and decision boundaries
- onboarding that explains the hidden structure without exposing too much of it
  in primary navigation
