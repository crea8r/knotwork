# Knotwork Terminology

## Purpose

This document is the canonical naming reference for Knotwork's public MCP and API surface.

Use it to review:

- tool names
- resource names
- prompt names
- public API route names
- user-facing docs

Public naming must follow product intent, not legacy storage, model, or route names.

## Product Intent

Knotwork has one core intent:

- experts want to run their workflow automatically

The public MCP surface should therefore optimize for a small set of operational sub-intents:

- finish a run
- design & improve a workflow
- work with assets needed by that workflow
- communicate in channels
- update project and objective state

## Canonical Public Nouns

These are the preferred nouns for public MCP and API naming.

### Roles

- `operator`
  The actor handling the active run request.
- `supervisor`
  The actor resolving escalations or making higher-authority workflow decisions.

### Key concept

- `asset`
  A file, folder, workflow file, or other durable content object used by work.
- `channel`
  A conversation thread.
- `project`
  A container for objectives, assets, status, and related channels.
- `objective`
  A tracked unit of project progress.

### Main intent

- `workflow`
  A process definition exposed publicly as something experts improve and automate.
- `run`
  One execution of a workflow.
- `escalation`
  A paused or blocked run decision that requires a higher-trust response.

## Legacy Or Internal Terms

These terms may remain in tables, modules, adapters, or compatibility routes, but they should not drive new public MCP naming.

| Legacy / Internal | Public Term |
| --- | --- |
| `graph` | `workflow` |
| `graph root draft` | `workflow draft` |
| `knowledge` | `asset` |
| `knowledge file` | `asset file` |
| `knowledge folder` | `asset folder` |
| `knowledge change` | `asset change` |
| `handbook` | `workspace assets` |
| `handbook proposal` | `asset change review` |
| `proposal` | `change` when user intent is modification, not review bookkeeping |

Notes:

- `graph` can remain an internal model and service term.
- `knowledge` and `handbook` are legacy product terms and should be phased out of new public MCP names.
- If a review object needs an explicit id, `change_id` is preferred over `proposal_id` in the public layer.

## Public Naming Rules

### Tool prefix

All public MCP tools use the `knotwork_` prefix.

### Tool shape

Preferred shape:

- `knotwork_<subject>_<verb>`
- `knotwork_<subject>_<role>_<verb>` when role changes authority or semantics

Examples:

- `knotwork_asset_read`
- `knotwork_run_operator_escalate`
- `knotwork_run_supervisor_resolve_escalation`

### When to include role

Include role only when the same subject supports materially different authority paths.

Good:

- `run_operator_*`
- `run_supervisor_*`

Avoid:

- role labels on tools where the behavior is identical regardless of actor

### Prefer intent nouns over implementation nouns

Good:

- `workflow`
- `asset`
- `channel`

Avoid:

- `graph`
- `knowledge`
- `handbook`
- `root_draft`

### Prefer intent verbs over transport verbs

Good:

- `complete`
- `resolve`
- `edit`
- `read`
- `search`
- `change`
- `reply`
- `update`

Avoid:

- `post` when the user intent is clearly `reply`
- `get` when the public action is conceptually `read`
- `create_proposal` when the public action is conceptually `change`

## Reserved Verb Semantics

Use verbs consistently across the public surface.

- `complete`
  Finish an operator-handled run/request successfully or decisively.
- `resolve`
  Settle an escalation.
- `escalate`
  Hand off a blocked run decision upward.
- `edit`
  Modify a workflow definition.
- `read`
  Load one asset or one canonical content object.
- `search`
  Find assets by query.
- `change`
  Propose a reviewed modification to an asset.
- `reply`
  Send a contextual channel response outside the run-resolution path.
- `update`
  Change tracked project or objective state.

Rule:

- use `resolve` for escalations
- use `complete` for run/operator completion

Do not use both words for the same action family.

## Resource Naming

Resources should use the same public nouns:

- `workflow`
- `asset`
- `channel`
- `objective`
- `project`
- `run`
- `escalation`

Do not introduce new resource families under:

- `graph`
- `knowledge`
- `handbook`

unless they are explicitly compatibility-only.

## Prompt Naming

Prompt ids should also follow intent-first naming:

- `run.operator.*`
- `run.supervisor.*`
- `workflow.edit.*`
- `asset.change.*`
- `channel.reply.*`
- `objective.update.*`
- `project.update.*`

Prompt ids may stay dotted even when tool names use underscores.

## Migration Rule

When a public name conflicts with a legacy backend name:

1. keep the legacy term internally
2. introduce the public intent-led name at the boundary
3. document the mapping here
4. remove the legacy public alias later if compatibility is no longer needed

This document is the source of truth for that mapping.
