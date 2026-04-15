# Knotwork — Git Flow Guide

## Philosophy

Small team (1–5 people) with heavy agent-assisted development. Optimise for:
- **Speed** — ship to early adopters quickly.
- **Safety** — `main` is always deployable.
- **Clarity** — every change is traceable to a session or intent.

We use **GitHub Flow** (trunk-based with short-lived branches). No release branches, no develop branch, no GitFlow ceremony.

---

## Branching Model

```
main          ← always deployable; release-ready trunk
  └─ feature/session-8-1-docker     ← short-lived (1–3 days)
  └─ fix/invitation-expired-check   ← hotfixes merge directly
  └─ chore/update-deps              ← maintenance tasks
```

### Rules

| Rule | Reason |
|------|--------|
| `main` is protected — no direct pushes | Prevents accidental breakage |
| Every change ships via a PR | Traceable; triggers CI |
| Branches live ≤ 3 days | Long-lived branches cause merge pain |
| One concern per branch | Easier to review and revert |
| Delete branch after merge | Keeps repo clean |

---

## Commit Convention

Format: `<type>: <short description>` (50 chars max for the first line)

### Types

| Type | When to use |
|------|-------------|
| `feat` | New user-visible feature |
| `fix` | Bug fix |
| `refactor` | Code restructure with no behaviour change |
| `test` | Adding or fixing tests |
| `chore` | Dependencies, tooling, config |
| `docs` | Documentation only |
| `wip` | Work-in-progress (squash before PR) |

### Examples

```
feat: add magic link auth and workspace invitations
fix: timezone-safe datetime comparison for SQLite tests
refactor: extract invitation service from workspace router
test: S8.1 automated suite — auth, invitations, install URL
docs: add S8.1 spec and validation checklist
chore: update pydantic to 2.11
```

### Body (optional)

Add a blank line after the summary, then explain the *why* (not the what):

```
fix: timezone-safe datetime comparison for SQLite tests

SQLite's DateTime(timezone=True) returns naive datetimes on read,
while _now() returns tz-aware. Applying .replace(tzinfo=None) when
the stored value is naive makes comparisons work in both environments.
```

### Agent co-authorship

When an agent writes or significantly contributes to a commit, add:

```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Day-to-Day Workflow

### Starting a session

```bash
# Pull latest main
git checkout main && git pull

# Create a session branch
git checkout -b feat/session-8-2-cloud-deploy
```

### During work

```bash
# Stage specific files (never `git add .` blindly)
git add backend/knotwork/auth/service.py frontend/src/pages/LoginPage.tsx

# Commit often — at least once per logical unit of work
git commit -m "feat: add magic link token service"
```

### Before opening a PR

```bash
# Sync with main to catch drift
git fetch origin && git rebase origin/main

# Run full test suite
cd backend && python3 -m pytest ../docs/implementation/ -v

# TypeScript build check
cd frontend && npm run build
```

### Opening the PR

```bash
gh pr create \
  --title "feat: S8.1 — Docker + magic link auth + OpenClaw install URL" \
  --body "$(cat docs/implementation/S8.1/spec.md)"
```

**PR description must include:**
- What was built (link to `spec.md`)
- How to test (link to `validation.md`)
- Breaking changes if any

### Merging

- Squash-merge for feature branches (clean `main` history)
- Fast-forward for single-commit fixes
- Delete branch after merge

---

## Agent Development Guidelines

When an AI agent (Claude, OpenClaw agent, etc.) writes code:

1. **Agent works on a branch** — never directly on `main`.
2. **Human reviews before merge** — agent PRs require at least one human approval.
3. **Tests must pass** — CI blocks merge if `pytest` or `npm run build` fails.
4. **Agent commits include co-author line** — see above.
5. **Agent describes its reasoning** — PR body must explain *why*, not just *what*.

### Prompt for agent sessions

```
Work on branch: feat/session-8-2-cloud-deploy
After completing work, open a PR to main. Do not merge — leave for human review.
All tests must pass before opening the PR.
```

---

## Branch Naming

| Prefix | Example | Use |
|--------|---------|-----|
| `feat/` | `feat/session-8-2-cloud-deploy` | New features / sessions |
| `fix/` | `fix/invitation-token-expiry` | Bug fixes |
| `refactor/` | `refactor/extract-auth-service` | Internal restructure |
| `chore/` | `chore/bump-langchain` | Dependency / tooling |
| `docs/` | `docs/update-roadmap` | Documentation only |

Use kebab-case. Keep names under 60 characters.

---

## Release Guidance

```
main → optional staging environment (if your setup uses one)
main → release target chosen by the operator
```

**Never release from a feature branch.** `main` is the single source of truth for reviewed code.

---

## Hotfixes

```bash
# Branch from main
git checkout main && git pull
git checkout -b fix/critical-auth-bypass

# Make the fix, test, PR
# Merge as fast-forward (no squash)
gh pr merge --merge
```

---

## CI Checklist

- `pytest ../docs/implementation/ -v` — all tests pass
- `npm run build` — TypeScript compiles
- `docker compose build` — images build cleanly
- No secrets committed (truffleHog scan)

---

## Quick Reference

```bash
# Start work
git checkout main && git pull
git checkout -b feat/<name>

# Commit
git add <specific files>
git commit -m "type: description"

# Sync before PR
git fetch origin && git rebase origin/main
cd backend && python3 -m pytest ../docs/implementation/ -v

# Open PR
gh pr create --title "..." --body "..."

# After merge
git checkout main && git pull
git branch -d feat/<name>
```
