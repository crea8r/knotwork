# Session 12.2 Extension — Channel-First Agent Events And Change Actions

## Why This Extension Exists

The current S12.2 work correctly moved agents onto Knotwork's normal participant surfaces, but the current review / handbook implementation still mixes three different concepts:

1. a **channel** as an ongoing conversation
2. an **asset binding** that tells the system what the conversation is about
3. a **change action** that proposes a concrete modification

That mixture produces the wrong shape in code:

- review threads are treated as a special `knowledge_change` channel type
- proposal rows still act like the primary review object
- asset chat and review chat are not modeled as the same kind of thing

This extension freezes the intended model before further implementation changes.

## Core Model

### 1. Channels are conversations

Channels are the main collaboration surface for both humans and agents.

A channel is where ongoing discussion happens:

- free chat
- run chat
- workflow chat
- project chat
- objective chat
- asset chat
- review chat

After a channel exists, follow-up discussion is ordinary channel traffic:

- `message_posted`
- `mentioned_message`
- other normal inbox/event types already supported by the participant model

The system should not require a dedicated channel type just because the channel is being used to discuss a proposed change.

### 2. Asset context is attachment, not channel type

A chat can be about a specific thing without becoming a different kind of product object.

Asset-specific context should come from bindings such as:

- workflow asset
- knowledge file
- knowledge folder
- project-scoped asset

The existing `ChannelAssetBinding` concept is the correct direction. Asset chat should be represented as:

- one general discussion channel for an asset collection or scope
- one specific discussion channel for an individual asset when needed

This rule applies at both workspace scope and project scope.

### 3. A proposal is an action, not a channel

There is a separate concept from chat:

- a concrete request to change knowledge or workflow state

Examples:

- update file content
- rename file
- move file
- create file
- create folder
- move folder
- delete file or folder

This should be represented as a structured action record attached to a discussion channel.

That action is what needs approval / rejection / execution state.
The channel is where people and agents discuss it.

## Product Rules

### Review queue

The Knowledge review surface is a central queue of pending change actions.

Each review item must point to:

- the structured change action
- the discussion channel where the action is being discussed

The review queue is not itself the discussion surface.

### Asset chat

Asset chat follows these rules:

- opening a folder keeps the user in the folder / collection-level asset chat
- opening a specific file moves the user into the file-specific chat for that asset
- this behavior applies to workflows and non-workflow knowledge assets
- the same model applies at workspace and project scope

### Review / proposal chat

When an agent decides that a significant change is needed:

1. it creates or reuses a discussion channel
2. it binds that channel to the relevant source asset(s) and/or source channel
3. it creates a structured change action in that channel
4. it posts an initial message that explains the proposal
5. all follow-up is ordinary channel discussion

This is still "just chat", plus one action record that can be reviewed and resolved.

## Agent Behavior

The workspace guide should instruct agents to:

- treat channels as the primary collaboration surface
- use asset-bound channels for asset-specific discussion
- create a change action when proposing a concrete modification
- continue all follow-up through normal channel discussion
- after every 10 runs, review recent work for repeated friction or drift
- if significant changes are needed, create a review discussion plus a change action instead of silently changing the knowledge base

## Implementation Direction

### Short-term migration

The current `knowledge_change` rename is acceptable only as a transitional compatibility layer.

Implementation should move toward:

- review chats being normal channels
- asset context being represented by bindings
- pending review items being represented by structured change actions

### Avoid

Do not keep extending the product around these assumptions:

- a proposal is a special kind of channel
- review items only mean file-content replacement
- handbook chat is separate in kind from asset chat

### Preferred data shape

The long-term shape should be:

- `Channel`
- `ChannelAssetBinding`
- `ChangeAction` (name can vary, but it must be separate from `Channel`)

`ChangeAction` should eventually replace the current narrow proposal model and support richer actions than content replacement.

## S12.2 Scope Update

S12.2 should therefore be interpreted as:

- agents use the unified participant / inbox / API / MCP surfaces
- channels remain the main collaboration primitive
- review work is channel-first
- proposals are structured actions attached to channels

The OpenClaw bridge and any future bridge should reason in terms of channels and actions, not special review-channel mechanics.
