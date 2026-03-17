# Knowledge System

How the Handbook works — Obsidian-style Markdown files stored via `StorageAdapter`, with wiki-links, health scoring, and a knowledge improvement loop.

## Contents

- **overview.md** — What the Handbook is, how files are organised, the folder-as-domain rule.
- **linking.md** — Wiki-link syntax, transitive link resolution, and the folder-as-domain traversal algorithm.
- **versioning-storage.md** — How files are versioned (S3 object versioning + PG index) and the `StorageAdapter` interface.
- **health.md** — The 4-signal health score: token count, avg confidence, escalation rate, avg rating.
- **workflows.md** — Knowledge improvement loop: Mode A (human), Mode B (agent suggests), Mode C (agent writes).
