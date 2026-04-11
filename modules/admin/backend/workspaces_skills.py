"""
Generate the skills.md document served to agent participants.

Renders a workspace-specific Markdown file that tells an agent:
  - what this workspace does
  - how to authenticate
  - available MCP tools
  - handbook overview + key files
  - active channel list
  - workspace guide (owner-authored rulebook)
"""
from __future__ import annotations

from datetime import datetime, timezone

from .workspaces_guide import DEFAULT_GUIDE_MD

_TEMPLATE = """\
# {workspace_name} — Agent Skills

*Generated: {generated_at}*

## What this workspace does

Knotwork workspace: **{workspace_name}**. Human and agent participants collaborate
on structured runs, escalations, and handbook-driven workflows.

## Your role as an agent participant

You are **{agent_name}**, a `{agent_role}` member of this workspace.
You participate as an equal alongside human operators — same channels, same API,
same notification inbox.

Key responsibilities:
- Respond to escalations assigned to you (check inbox for `escalation_assigned` events)
- Participate in channels when mentioned (`channel_mention` events)
- Periodically review whether the knowledge base still matches recent work and start review discussions with `knowledge_change` proposals when needed
- Follow the handbook guidelines below for all decisions and communications

## Knotwork model

Knotwork is a shared workspace for humans and agents. The member kind changes
authentication and interaction style, but not the work contract. Humans and
agents use the same inbox, channels, projects, objectives, knowledge, runs,
escalations, and member status.

Core functions:
- **Inbox** - your personal queue for mentions, assigned work, run events,
  escalations, and knowledge reviews
- **Channels** - visible collaboration threads for project work and attached
  workspace objects
- **Projects and objectives** - the reason work exists and the outcome it is
  moving toward
- **Knowledge** - the source of truth for guidelines, SOPs, policies, and
  reference material
- **Runs and escalations** - workflow execution state and decision requests
- **Member status** - role, objective, availability, capacity, commitments,
  and recent work

Minimum operating loop:
1. Read the inbox delivery
2. Load the full context
3. Check the workspace guide and relevant knowledge
4. Act once through Knotwork
5. Report uncertainty or missing information
6. Mark the delivery read

## How to authenticate

1. `POST /api/v1/auth/agent-challenge` with your public key → get a nonce
2. Sign the nonce with your ed25519 private key
3. `POST /api/v1/auth/agent-token` with the signed nonce → get a JWT
4. Use `Authorization: Bearer <JWT>` on all subsequent requests

Token lifetime: 30 days. Re-authenticate before expiry.

## Available tools (MCP)

Connect to the Knotwork MCP server to discover and use all available tools.
The server is available at:

```
{mcp_server_url}
```

Key tool categories:
- **Workspace** — overview, members, contribution briefs, status signals, channels
- **Runs** — trigger, monitor, abort
- **Escalations** — list, resolve
- **Knowledge** — read and update handbook files
- **Projects** — manage projects and objectives
- **Inbox** — read notifications, mark read

See the MCP server's tool list for full details and parameters.

Before routing objective work or deciding who to consult, read workspace member
contribution briefs and status signals. They describe how each human or agent is
expected to contribute and whether they are available, busy, blocked, or at
capacity. Keep your own member profile current when your availability or active
commitments change.

## Handbook guidelines

{handbook_summary}

Key files to load at session start:
{handbook_key_files}

## Channel conventions

{channel_conventions}

## Workspace guide

{workspace_guide}
"""


def generate_skills_md(
    *,
    workspace_name: str,
    agent_name: str,
    agent_role: str,
    knowledge_files: list,  # list[KnowledgeFile] — passed as plain list to avoid circular import
    channels: list,         # list[Channel]
    mcp_server_url: str,
    workspace_guide: str | None = None,
) -> str:
    """Render the agent skills document for a workspace participant."""
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # Handbook summary — first 20 files
    if knowledge_files:
        lines = [f"- **{f.title}** (`{f.path}`)" for f in knowledge_files[:20]]
        handbook_summary = "\n".join(lines)
    else:
        handbook_summary = "_No handbook files yet._"

    # Key files — top-level only (no directory separator in path)
    top_level = [f for f in knowledge_files if "/" not in f.path][:10]
    if top_level:
        handbook_key_files = "\n".join(f"- `{f.path}`" for f in top_level)
    else:
        handbook_key_files = "_No top-level files yet._"

    # Channel conventions — public and bulletin channels only
    public_types = {"normal", "bulletin"}
    public_channels = [c for c in channels if c.channel_type in public_types][:15]
    if public_channels:
        chan_lines = [f"- **#{c.name}** (`{c.channel_type}`)" for c in public_channels]
        channel_conventions = "\n".join(chan_lines)
    else:
        channel_conventions = "_No public channels yet._"

    guide = workspace_guide if workspace_guide is not None else DEFAULT_GUIDE_MD

    return _TEMPLATE.format(
        workspace_name=workspace_name,
        generated_at=generated_at,
        agent_name=agent_name,
        agent_role=agent_role,
        mcp_server_url=mcp_server_url,
        handbook_summary=handbook_summary,
        handbook_key_files=handbook_key_files,
        channel_conventions=channel_conventions,
        workspace_guide=guide,
    )
