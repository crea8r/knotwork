# Session 9.1 — Workflow Version Management

## Goal

Give workflow designers a clear, non-disruptive model for iterating on workflows: a mutable draft for fast iteration with test runs, explicit versioning when a snapshot is meaningful, and a production designation that is visually unambiguous.

## Core Model

```
Draft (mutable, auto-saved, no history)
  └─ test runs → "draft run" (not pinned to any version, shown with draft badge)
  └─ "Save as version" / publish / promote to production → creates a Version

Version (immutable, explicit, ID-stable)
  └─ editing a version → creates a new draft based on that version
  └─ forking a version → creates a new independent workflow with that version as its first draft
  └─ runs → version-pinned, shown in run history with version label
  └─ can be published (own permalink) and/or marked production
```

Every workflow can have a root draft plus per-version drafts. A draft can be based on a named version or can be the root draft for the workflow before any version exists. For any given parent version, there is at most one draft. Drafts auto-save continuously and keep no history — only the latest draft state for that draft slot is stored.

## Version Creation — Explicit Only

Versions are created by three intentional actions, never automatically:

1. **"Save as version" in the designer** — user decides they have reached a checkpoint worth keeping. This is the primary path for iterative development.
2. **Publishing to a public page** — if the selected draft is not already a version, publishing auto-snapshots it as a version at that moment.
3. **Promoting a draft to production** — same auto-snapshot as publishing.

**Test runs do not create versions.** Test runs always execute against the currently selected draft. This means a designer can run that draft 50 times without polluting the version history. Draft runs are labeled clearly in run history and are not counted as production runs.

## Version Identity and Naming

- **ID**: 9-character random alphanumeric (e.g. `a1b2c3d4e`). Immutable. Used in URLs and API references. Never changes even if the version is renamed.
- **Default name**: two readable words + number (e.g. `swift-falcon-42`). Human-readable, not guaranteed unique — ID is the stable identifier.
- **User rename**: version name can be changed at any time. Useful for marking significant checkpoints ("pre-launch", "client-demo-feb").
- **Names do not need to be unique** within a workflow.

## Draft vs Version Visual Treatment

- **Draft badge**: visible in the designer header when viewing the draft — e.g. amber "Draft" pill. Communicates "this is not a version yet."
- **Version history panel**: shows all versions as a visual timeline/branch view. Each version shows: ID, name, creation date, whether it is production, how many runs it has, and whether there is a draft based on it. The root draft may also appear as its own branch point before the first named version.
- **Production highlight**: production version is color-highlighted (e.g. green) throughout the version list and in the run trigger modal.
- **Draft based on a version**: shown as a branch extending from the parent version in the timeline.

## Production Designation

- Any version can be marked production. Default: the latest version is production if nothing is explicitly set.
- **Production version governs:**
  - The default version used when an operator triggers a run from the run screen
  - The canonical public URL of the workflow (e.g. `/pub/my-workflow`) — points to whichever version is production
- Operator can override version at run trigger time (e.g. to test a specific version without promoting it to production).

## Public URLs

Two URL concepts per workflow:

- **Canonical URL** — one per workflow, always resolves to the production version: `/pub/my-workflow`
- **Version permalink** — one per version, always resolves to that exact version regardless of production changes: `/pub/my-workflow/v/a1b2c3d4e`

A version can have its public page disabled without affecting other versions or the canonical URL. The canonical URL can be disabled at the workflow level. Disabling a public page does not delete the version.

## Editing and Branching

- **Edit from a version**: clicking "Edit" on any version creates or opens that version's draft. This is how you patch an older version — e.g. patch v2 to create what becomes v3.
- **Fork to new workflow**: any version can be forked into a brand new independent workflow, starting with that version's graph as the new workflow's first draft.
- **Per-version draft slots**: a workflow may have multiple drafts at once, but only one per parent version (plus the optional root draft). Editing one version's draft does not overwrite another version's draft.

## Run History and Version Pinning

- **Draft runs**: labeled "Draft" in run history, not pinned to a version. Intended for testing during development. Not shown in the default production run view (filtered to version-pinned runs by default, with a toggle to include draft runs).
- **Version runs**: pinned to the exact version they executed against. Shown in run history with the version name/ID. The version branching UI shows the run count per version.

## Deletion and Archival

- **Versions cannot be deleted** if they have runs or an active public page.
- Versions with no runs and no public page can be deleted.
- Versions can be **archived** (hidden from the default version list, accessible via "show archived"). Useful for keeping history tidy without permanent deletion.
- The production version cannot be archived while it is still production.

## Out of Scope

- Git-style diff between versions (S10+)
- Version-level access control (Phase 2)
- Automated versioning on schedule or external trigger

## Acceptance Criteria

1. Saving a workflow does not create a version; "Save as version", publish, and promote-to-production are the only version creation triggers.
2. Test runs execute against the draft and are labeled "Draft run"; they do not appear in the default production run history.
3. Every version has a 9-char immutable ID and a default two-words-number name; user can rename at any time.
4. The version timeline/branch view shows all versions with run counts, production highlight, and draft branch indicator.
5. Production version is color-highlighted and used as default for run trigger and canonical public URL.
6. Canonical URL and per-version permalink both work; disabling a version's public page does not affect other versions.
7. Editing a version creates or opens that version's draft; each version has at most one draft, and the workflow may also have a root draft.
8. Any version can be forked into a new independent workflow.
9. Versions with runs or an active public page cannot be deleted; versions can be archived instead.
10. Draft runs are filterable in run history (excluded by default, shown with toggle).
