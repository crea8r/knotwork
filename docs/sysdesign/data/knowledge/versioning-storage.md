# Knowledge System — Versioning & Storage

## Versioning

Every time a fragment is saved, a new version is created automatically. No drafts, no manual version management — just save and the history is there.

Each version has:

- `version_id` — unique identifier (provided by storage layer)
- `saved_at` — timestamp
- `saved_by` — user or agent that made the change
- `change_summary` — optional short note about what changed

Users can view version history and restore any previous version from the knowledge editor.

### Version Snapshot in Runs

When a node executes, the runtime records the exact `version_id` of every file in the resolved knowledge tree. This snapshot is stored in `RunNodeState`.

This means:

- You can always replay a run with the exact knowledge that was used
- You can compare two runs to see if knowledge changed between them
- Rating feedback is always attached to a specific knowledge version

---

## Storage

Knowledge files are stored through a **StorageAdapter** abstraction:

```text
StorageAdapter
  read(path) → content
  write(path, content) → version_id
  list(folder) → [path]
  history(path) → [version]
  restore(path, version_id) → version_id
  delete(path)
```

Implementations:

- **LocalFSAdapter** — files on disk with a version table in PostgreSQL (dev / self-hosted)
- **S3Adapter** — files in S3 with object versioning enabled (cloud production)

Switching adapters requires no changes to application code.

### PostgreSQL Knowledge Index

The database stores metadata only — not file content:

```text
knowledge_files
  id                    uuid
  workspace_id          uuid
  path                  text        -- "legal/contract-review-guide.md"
  title                 text        -- first H1 or filename
  owner_id              uuid
  raw_token_count       int         -- this file only
  resolved_token_count  int         -- full linked tree (updated on save)
  linked_paths          text[]      -- direct [[links]] in this file
  current_version_id    text
  health_score          float       -- 0.0–1.0, computed (see Knowledge Health)
  health_updated_at     timestamptz
  created_at            timestamptz
  updated_at            timestamptz
```
