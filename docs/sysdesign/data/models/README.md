# Data Models

ORM + Pydantic schema contracts. Source of truth for every entity in the database. Backend `models.py` and `schemas.py` files must stay in sync with these.

## Contents

- **graph-definition.md** — Graph, GraphVersion, Node (JSON schema), Edge, validation rules.
- **workspace-auth.md** — Workspace, User, WorkspaceMember, RegisteredAgent.
- **knowledge-tools.md** — KnowledgeFile, KnowledgeVersion, Tool, BuiltinTool.
- **runtime-feedback.md** — Run, RunNodeState, RunWorklogEntry, Escalation, Rating.
- **agents-settings-profile.md** — S8 expansion: capability snapshots, usage history, debug refs, avatar assets.
