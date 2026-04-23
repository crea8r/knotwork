# S3 Spec — Handbook CRUD · Health Score · Mode B Suggestions · Token Badges

## What Was Built

### 1. `knowledge/schemas.py` — Pydantic Schemas
- `KnowledgeFileCreate`: path, title, content, change_summary
- `KnowledgeFileUpdate`: content, change_summary
- `KnowledgeFileOut`: all DB fields (id, path, title, token counts, linked_paths, health_score, timestamps)
- `KnowledgeFileWithContent`: extends `KnowledgeFileOut` with content + version_id from storage
- `FileVersionOut`: version_id, saved_at, saved_by, change_summary
- `KnowledgeRestoreRequest`: version_id, restored_by
- `SuggestionOut`: suggestions (list[str]), health_score

### 2. `knowledge/service.py` — CRUD Business Logic
- `list_files(db, workspace_id)` → all KnowledgeFile records
- `get_file_by_path(db, workspace_id, path)` → single record or None
- `create_file(...)` → writes to StorageAdapter (gets version_id), counts tokens with `len//4` heuristic, extracts wiki-links, upserts KnowledgeFile record
- `update_file(...)` → new storage version, updates token count + linked_paths + version_id in DB
- `delete_file(...)` → soft-deletes in storage, removes DB record
- `get_history(workspace_id, path)` → delegates to StorageAdapter.history()
- `restore_version(...)` → delegates to StorageAdapter.restore(), syncs DB metadata

### 3. `knowledge/health.py` — 4-Signal Composite Score
`compute_health_score(file_id, db) -> float` in [0.0, 5.0]:

| Signal | Weight | Source |
|---|---|---|
| token_score | 20% | `len(content)//4`; ideal 300–3000; decays above 3000, floor 1.0 |
| confidence_score | 30% | mean `RunNodeState.confidence_score` × 5 for runs referencing this file |
| escalation_score | 25% | `(1 − esc_count/run_count) × 5` |
| rating_score | 25% | mean `Rating.score` (1–5 already on 5-pt scale) |

- Returns 0.0 on cold-start (no runs referencing the file)
- Persists a `KnowledgeHealthLog` row on each computation
- Updates `KnowledgeFile.health_score` cache

### 4. `knowledge/suggestions.py` — Mode B Improvement Suggestions
- `generate_suggestions(file_id, db) -> list[str]`
- Reads latest `KnowledgeHealthLog` for signal breakdown
- Sends structured prompt to `gpt-4o-mini` (temperature=0)
- Parses response as JSON array; caps at 3 suggestions
- Fails silently on any error → returns []

### 5. `knowledge/router.py` — Handbook REST Endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/{ws}/knowledge` | List all files |
| POST | `/{ws}/knowledge` | Create file |
| GET | `/{ws}/knowledge/file?path=` | Get file with content |
| PUT | `/{ws}/knowledge/file?path=` | Update content |
| DELETE | `/{ws}/knowledge/file?path=` | Soft-delete |
| GET | `/{ws}/knowledge/history?path=` | Version history |
| POST | `/{ws}/knowledge/restore?path=` | Restore version |
| GET | `/{ws}/knowledge/health?path=` | Compute + return health score |
| GET | `/{ws}/knowledge/suggestions?path=` | Mode B suggestions |

Note: `path` is a query param (not a path param) to avoid URL encoding issues with slashes in file paths.

### 6. Frontend
- `api/knowledge.ts` — hooks for all 9 endpoints + 5 mutations
- `pages/HandbookPage.tsx` — file tree with search, health badges, token badges, new-file form
- `pages/KnowledgeFilePage.tsx` — 3-tab view: editor (textarea + save/discard), history (with restore), health & suggestions
- `App.tsx` — wired `/handbook`, `/handbook/file`, `/escalations`, `/escalations/:id` routes

## Key Decisions

1. **Token counting uses `len(content) // 4` heuristic**: consistent with `knowledge_loader.py`; no tiktoken dependency in hot path.
2. **Health score runs file filtering in Python**: `RunNodeState.knowledge_snapshot` is a JSON dict `{path: version_id}`; Python-side filter avoids JSON-in-SQL across SQLite/PG dialects.
3. **`path` as query param**: avoids `%2F` encoding issues with file paths like `legal/contract-review.md`.
4. **`generate_suggestions` imports `ChatOpenAI` locally**: module-level import would fail if `langchain_openai` is not installed; local import fails silently inside the try/except.
5. **`KnowledgeFileWithContent.model_config = ConfigDict(from_attributes=True)`**: uses Pydantic v2 style to avoid deprecation warnings.

## Test Results

- S1: 29 passed, 3 xfailed
- S2: 55 passed
- S3: 31 passed
- Total: 115 passed, 3 xfailed
