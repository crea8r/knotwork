# Frontend Specification — Channel

Channels are a single UX primitive in Knotwork. A channel is not a special page
type for one domain area. It is the consistent conversation frame through which
work, decisions, updates, and context are rendered.

Different channel types may expose different metadata, actions, and attached
context, but the **core channel frame stays the same**.

---

## Purpose

The channel system exists to make work feel continuous.

Users should not feel like they are jumping between:

- a project page
- a task page
- a run monitor
- a workflow design page
- a knowledge-maintenance chat

Instead, they should feel like they are always inside the same interaction model:

- a header that says what context they are in
- a timeline that shows messages, system events, and decisions
- a composer that lets them act
- a context area that changes based on channel type

This makes Work feel centered on ongoing operations instead of on configuration
screens.

---

## Channel Frame

The channel frame is the template that all channel types use.

### 1. Header

Always present.

Contains:

- channel title
- channel type badge
- parent context label
- status badges where relevant
- small set of primary actions

Examples:

- `Project-wide · Hiring Pipeline`
- `Objective · Close 3 enterprise deals`
- `Run · run_abc123`
- `Workflow · Client onboarding`

The header should identify context quickly without forcing the user to inspect
the body.

### 2. Context Strip

Optional, but uses the same slot across all channel types.

Contains structured references such as:

- linked project
- linked objective
- linked run
- linked workflow
- linked file
- attached assets
- responsible agent

These appear as pills or compact cards.

The context strip explains what this channel is connected to. It should not
replace the timeline.

### 3. Timeline

Always present. This is the primary body of the channel.

The timeline renders a unified ordered stream of:

- human messages
- agent messages
- system messages
- decision cards
- significant state changes

Messages are conversation. Decisions are durable state transitions. They should
look visually related, but not identical.

### 4. Composer

Always present.

The composer is consistent across channel types:

- text input
- mentions
- send action
- lightweight helpers where appropriate

Type-specific actions may appear near the composer, but should not replace it.

### 5. Secondary Detail Panel

Optional.

This is where type-specific structured detail belongs:

- objective progress
- run status and ETA
- workflow metadata
- file metadata
- handbook proposal controls

This panel can appear as:

- right rail on desktop
- bottom sheet on mobile
- collapsible section when space is constrained

Important rule:

**Type-specific detail belongs in context modules, not in a different page
anatomy.**

---

## Channel Principles

### 1. One channel system, not many mini-products

Changing channel type should not make the user feel they entered a different
app. Type changes metadata and tools, not the fundamental layout.

### 2. Timeline-first

The timeline is the center of the channel. Structured controls support the
conversation; they do not replace it.

### 3. Decisions are first-class

Decision actions are distinct from plain messages. They create durable state and
must be visible as such in every channel type.

### 4. Context without navigation churn

A channel should surface the context needed to act without forcing the user to
leave the current thread.

This includes:

- attached assets
- linked runs and workflows
- mentioned participants, assets, runs, and channels with inline peek

### 5. Same frame, different emphasis

All channel types share the same frame, but each type may emphasize different
context modules:

- objective channel emphasizes progress and runs
- run channel emphasizes execution state
- handbook channel emphasizes proposals and file changes

### 6. Preview before navigate

When a channel references another participant, asset, run, or channel, users
should be able to inspect it without leaving the current one.

References should support:

- clickable mention token
- peek panel or bottom sheet
- relevant summary or recent activity preview
- optional full navigation

### 7. Mobile keeps the same mental model

On mobile, the layout compresses, but the model stays the same:

- header
- context
- timeline
- composer
- optional sheet for secondary detail

---

## Channel Functions

All channel types should support the same base capabilities unless explicitly
restricted:

- read timeline
- post message
- render decisions
- create a workflow run from channel context
- mention participants
- mention assets
- mention runs
- mention channels
- preview mentioned participants inline
- preview mentioned assets inline
- preview mentioned runs inline
- preview mentioned channels inline
- show attached assets and linked context
- navigate to full linked context if needed

Shared optional capabilities:

- attach workflow
- attach run
- attach file
- create workflow run
- subscribe or mute
- show participants

Type-specific capabilities can be added, but they must sit on top of the common
channel frame.

---

## Channel Types

Knotwork currently has seven concrete channel types and one practical subtype.

### 1. Project Channel (`project`)

Role:

- main project-wide buffer
- coordination, delegation, free-form discussion
- home channel for the project

Customization:

- dashboard sits above or beside the channel as a context module
- objective summary appears in project context, not as a different chat UI
- project status and latest movement emphasized in header/context

What should remain standard:

- same timeline
- same composer
- same decision rendering

### 2. Objective Channel (`objective`)

Role:

- focused work thread for one objective
- place where objective-specific decisions and updates accumulate

Customization:

- objective progress, status, key results shown in context panel
- run trigger available as a contextual action
- run history scoped to the objective shown as structured context

What should remain standard:

- same conversation shell as project channel

### 3. Run Channel (`run`)

Role:

- execution thread for a specific run
- detailed record of operational events, interventions, and outcomes

Customization:

- run status, current node, ETA, and graph link shown in context panel
- system events are more common here than in other channels
- debug and graph views may open from this channel

What should remain standard:

- same timeline structure
- same decision card treatment
- same composer position

### 4. Free Chat (`normal`)

Role:

- ad hoc collaboration thread
- flexible conversation not bound to one objective by default

Customization:

- attached assets become the main context strip
- can serve as project-scoped free chat when linked to project assets or runs

What should remain standard:

- this is effectively the baseline channel shell that others extend

### 5. Workflow Channel (`workflow`)

Role:

- conversation around a workflow asset
- design iteration, refinement, and discussion

Customization:

- linked workflow metadata shown in context strip
- canvas/designer can open as secondary panel or linked mode
- workflow decisions appear as decision cards in the same timeline

What should remain standard:

- not a separate “designer chat UI”
- still a channel first

### 6. Handbook Channel (`handbook`)

Role:

- knowledge maintenance conversation
- file changes, merge/split proposals, editing requests

Customization:

- file or handbook scope shown in context strip
- proposal cards and approve/reject flows emphasized
- related files may appear in structured side panel

What should remain standard:

- same message/decision stream
- same composer frame

### 7. Agent Main Channel (`agent_main`)

Role:

- direct operational thread with an agent
- main session channel for agent collaboration

Customization:

- agent identity and trust context shown in header/context
- task assignment or agent reach-out items may be emphasized

What should remain standard:

- still a channel, not a different assistant surface

### 8. Asset-Bound Free Chat (practical subtype of `normal`)

Role:

- free chat channel that is made meaningful by attached assets
- often behaves like file-specific chat or asset-specific discussion

Examples:

- a normal channel attached to a project workflow
- a normal channel attached to a project file
- a normal channel attached to an active run

Customization:

- attached assets define identity in the context strip
- title may still be custom, but attached assets provide the operational frame

This subtype should not need a new page layout or a new channel type. The
distinction is contextual, not structural.

---

## Consistency Rules By Type

These should hold across all types:

- same header anatomy
- same timeline rendering rules
- same composer placement
- same decision-card language
- same asset/reference presentation style
- same mention behavior
- same peek behavior for participants, assets, runs, and channel references

Only these should vary:

- header labels
- context cards
- available actions
- side-panel content
- emphasis of certain event types

---

## Mention And Preview UX

Structured mentions are part of the channel model, not a special add-on.

Channels should support structured references to:

- participants
- assets
- runs
- channels

### Participant Mention

Used to direct attention to a human or agent.

Preview should show:

- display name
- participant kind
- enough context to identify who they are

### Asset Mention

Used to reference a workflow or file in context.

Preview should show:

- asset title
- asset type
- key metadata
- action to open the full asset

### Run Mention

Used to reference a specific run without leaving the current channel.

Preview should show:

- run title or ID
- status
- related project or objective context if available
- recent notable events
- action to open run detail

### Channel Mention

Used to reference another conversation thread while preserving focus.

Preview should show:

- channel title
- channel type
- parent context
- recent timeline items
- action to open full channel

### Preview Behaviour

When a message references a participant, asset, run, or channel:

- render it as a structured mention token
- clicking it opens a preview without leaving the current channel
- preview should be lightweight, contextual, and dismissible

Desktop:

- right-side peek panel

Mobile:

- bottom sheet

The preview should use the same visual language as the full destination in a
compressed form. It is a mini view of the same object, not a separate widget
style.

### Focus Rule

Preview preserves focus.

That means:

- peeking is the default action
- full navigation is secondary
- the current channel remains visually primary

---

## Implementation Direction

To keep the system coherent, frontend implementation should converge on shared
building blocks:

- `ChannelPageShell`
- `ChannelHeader`
- `ChannelContextStrip`
- `ChannelTimeline`
- `ChannelComposer`
- `ChannelPeekPanel`

Each channel type should configure these shared primitives rather than defining a
separate page anatomy.

That is the main requirement for making Work feel like the center of the product
rather than a collection of configuration views.
