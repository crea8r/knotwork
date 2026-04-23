# S12.4 MCP Resource And Prompt Plan

Status: review notes only. No implementation in this folder.

## Purpose

Capture the proposed MCP surface split for Knotwork after reviewing:

- `core/mcp`
- module MCP entrypoints under `modules/*/backend/mcp.py`
- module MCP contract/session logic
- the OpenClaw plugin prompt builder that currently absorbs too much session logic

This plan assumes:

- `core` should stay thin
- module-owned MCP should own real domain context and prompt/session behavior
- `resources` should be the canonical read surfaces for domain state
- `prompts` should be the canonical session/task guidance surfaces
- `tools` should stay as verbs and mutations

## Ownership Rule

Prompt ownership follows the thing being acted on, not the transport that delivered it.

Examples:

- a channel message about a workflow belongs to `workflows`
- a channel message about a handbook file belongs to `assets`
- a channel message about an objective belongs to `projects`
- `communication` owns channel/escalation/inbox surfaces, not all task policy

## Folder Layout

- `core.md`
- `admin.md`
- `assets.md`
- `communication.md`
- `projects.md`
- `workflows.md`

Each file proposes:

- MCP resources the module should expose
- MCP prompts the module should expose
- thin ownership notes
