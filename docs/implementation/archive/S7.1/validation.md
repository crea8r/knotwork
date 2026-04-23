# Session 7.1 Validation Checklist

Run `cd backend && python3 -m pytest ../docs/implementation/archive/S7.1/tests/ -v` first.
Then perform the manual checks below.

---

## 1. Migration

```bash
cd backend && alembic upgrade head
```

✅ **Pass**: No errors; `registered_agents` table exists in the DB.
❌ **Fail**: Migration error or table not created.

---

## 2. Register an Anthropic agent in Settings

**Steps**
1. Navigate to `/settings` → click **Agents** tab.
2. In the Add form: select "Anthropic", enter display name "My Claude", pick model "Claude Sonnet 4.6", enter a valid Anthropic API key.
3. Click Add.

✅ **Pass**: Agent appears in the list with display name, "Anthropic" badge, and masked key (last 4 chars).
❌ **Fail**: 422/500 error, or agent doesn't appear after submitting.

---

## 3. Register an OpenAI agent

**Steps**: Same as above but select "OpenAI", model "GPT-4o", provide OpenAI API key.

✅ **Pass**: Agent appears with "OpenAI" badge.
❌ **Fail**: Error or wrong badge.

---

## 4. OpenClaw option is disabled / "coming soon"

**Steps**: Open the provider dropdown in the Add form.

✅ **Pass**: "OpenClaw" is listed but greyed out and unselectable (or shows a tooltip "coming soon").
❌ **Fail**: OpenClaw is fully selectable or absent.

---

## 5. Designer dropdown shows registered agents

**Steps**
1. Navigate to a workflow, select an agent node.
2. Look at the Agent dropdown in the config panel.

✅ **Pass**: The dropdown lists "Human (always ask)" plus both registered agents by display name ("My Claude", "My GPT-4o").
❌ **Fail**: Dropdown still shows `anthropic:claude-sonnet-4-6` raw strings.

---

## 6. Selecting an agent stores `registered_agent_id`

**Steps**
1. Select "My Claude" from the dropdown.
2. Save the graph.
3. Inspect the saved graph version definition in the DB or via the API.

✅ **Pass**: The node has `registered_agent_id` set to the UUID of the registered agent, and `agent_ref = "anthropic:claude-sonnet-4-6"`.
❌ **Fail**: `registered_agent_id` is null or missing.

---

## 7. No agents registered — empty state in designer

**Steps**: Delete all registered agents. Open the designer.

✅ **Pass**: Agent dropdown shows only "Human" + inline nudge "No agents registered — add one in Settings → Agents."
❌ **Fail**: Dropdown is empty with no guidance, or shows stale hardcoded options.

---

## 8. Deleted agent shows warning on existing node

**Steps**
1. Register an agent, assign it to a node, save.
2. Delete the agent from Settings.
3. Reopen the workflow, select the node.

✅ **Pass**: A warning badge appears on the node or in the config panel ("Agent no longer registered").
❌ **Fail**: No warning; dropdown silently shows nothing selected.

---

## 9. Legacy node (no registered_agent_id) still runs

**Steps**: Open a graph with a legacy `llm_agent` or `agent` node that has NO `registered_agent_id`.
Trigger a run (env vars must be set).

✅ **Pass**: Run completes; runtime falls back to env-var API key.
❌ **Fail**: Run fails with "API key not found" error.

---

## 10. Runtime uses registered agent's API key

**Steps**: Set an invalid `ANTHROPIC_API_KEY` env var but register a valid key via the Settings UI.
Trigger a run on a node that has `registered_agent_id` set.

✅ **Pass**: Run succeeds using the registered key (not the invalid env var).
❌ **Fail**: Run fails with auth error (env var was used instead of the DB key).

---

## 11. Delete agent via Settings

**Steps**: Click the trash icon next to a registered agent.

✅ **Pass**: Agent disappears from the list immediately (optimistic update or refetch).
❌ **Fail**: Agent remains or a 404/500 error is shown.

---

## 12. Regression — all prior tests pass

```bash
cd backend && python3 -m pytest ../docs/implementation/ -v
```

✅ **Pass**: All prior tests pass or remain xfailed.
❌ **Fail**: Any previously-passing test fails.
