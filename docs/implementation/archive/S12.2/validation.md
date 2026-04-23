# Session 12.2 — Validation Checklist

Run this after backend/frontend are up, migrations are applied, and the OpenClaw plugin has been synced to the live extension directory.

This checklist covers:

- workspace guide
- agent onboarding/discovery UX
- OpenClaw bridge polling/auth behavior
- semantic action mode for durable actions

---

## A. Baseline Setup

### A1. Backend is healthy
- Open: `http://localhost:8000/health`
- ✅ Pass: JSON returns `"status": "ok"` and backend is reachable.
- ❌ Fail: 5xx, connection refused, or degraded health with missing dependencies.

### A2. Frontend is reachable
- Open: `http://localhost:3000`
- ✅ Pass: App loads and routes normally.
- ❌ Fail: frontend does not load or shows proxy/network errors.

### A3. Plugin source is synced to the live OpenClaw extension
- Source: `/Users/hieu/Work/crea8r/knotwork/agent-bridge/plugins/openclaw`
- Live extension: `/Users/hieu/.openclaw/extensions/knotwork-bridge`
- Action: run the sync flow used for plugin development, then restart OpenClaw gateway/runtime.
- ✅ Pass: the live extension contains the latest plugin files, including `src/semantic/` and the updated `openclaw.plugin.json`.
- ❌ Fail: live extension is missing recent files or still has stale code after restart.

### A4. Plugin build succeeds
- Run: `cd /Users/hieu/Work/crea8r/knotwork/agent-bridge/plugins/openclaw && npm run build`
- ✅ Pass: TypeScript build exits with code 0.
- ❌ Fail: build errors or missing output in `dist/`.

---

## B. Workspace Guide

### B1. Guide endpoint returns content and version
- Open: `GET /api/v1/workspaces/<workspace_id>/guide`
- ✅ Pass: response shape is `{ "guide_md": ..., "guide_version": <number> }`.
- ❌ Fail: missing fields, wrong types, or unauthorized for valid workspace member.

### B2. Owner can edit the guide in Settings
- UI: Settings -> Guide
- Action: edit the guide content and save.
- ✅ Pass: save succeeds, content persists on refresh, and version increments.
- ❌ Fail: save silently fails, content reverts, or version does not change.

### B3. Non-owner cannot edit the guide
- Log in as a non-owner workspace member and open Settings -> Guide.
- ✅ Pass: guide is visible read-only or edit controls are unavailable/blocked.
- ❌ Fail: non-owner can save guide changes.

### B4. Plugin reloads the guide after version change
- Precondition: plugin is connected and polling.
- Action:
  1. note the current guide content
  2. update the guide in the app
  3. wait at least one poll cycle
- ✅ Pass: plugin logs show guide reload and subsequent agent behavior reflects the updated guide.
- ❌ Fail: plugin continues behaving from stale guide content after multiple poll cycles.

---

## C. Agent Onboarding Surface

### C1. Discovery URL is shown in the add-agent flow
- UI: Settings -> Members or Agents -> Add Agent
- ✅ Pass: the UI shows the `.well-known/agent` discovery URL clearly.
- ❌ Fail: discovery URL is missing or hidden behind irrelevant instructions.

### C2. Post-add copy tells the admin to share discovery URL, not the public key
- Action: add/register an agent member using a public key.
- ✅ Pass: success copy tells the admin to share the discovery URL/backend URL/workspace details as appropriate.
- ❌ Fail: success copy incorrectly tells the admin to share the public key with the agent.

### C3. Agent can authenticate with ed25519 challenge-response
- Precondition: plugin configured with backend URL, workspace ID, and private key path.
- Action: connect plugin to workspace.
- ✅ Pass: plugin obtains JWT via challenge-response and stores/uses it for subsequent calls.
- ❌ Fail: plugin still depends on old integration-secret flow or cannot authenticate with a valid keypair.

---

## D. Inbox Polling And Channel Context

### D1. Plugin reads unread inbox items
- Action: create a new channel message or mention targeted at the agent.
- ✅ Pass: plugin polls the item and starts a task for it within the configured interval.
- ❌ Fail: unread item remains untouched while plugin is healthy and connected.

### D2. Mentioned message arrives as actionable work
- Action: in a subscribed channel, send `@agent can you help?`
- ✅ Pass: plugin receives a `mentioned_message` inbox item and handles it once.
- ❌ Fail: no task is started, or multiple duplicate replies are produced for one mention.

### D3. Non-mention message is treated according to guide and item type
- Action: send a normal non-mention message in the same channel.
- ✅ Pass: plugin behavior matches current guide/inbox handling rules and does not over-reply unexpectedly.
- ❌ Fail: plugin replies indiscriminately to every message without guidance to do so.

### D4. Channel context is loaded for channel-scoped items
- Action: create a channel with multiple recent messages, then mention the agent.
- ✅ Pass: the agent response reflects recent thread context instead of only the inbox subtitle.
- ❌ Fail: response appears based only on the one-line inbox summary while ignoring obvious recent context.

### D5. Delivery is archived after handling
- Action: trigger a handled inbox item, then inspect inbox again.
- ✅ Pass: handled delivery no longer loops in active inbox and is archived/read.
- ❌ Fail: the same handled item keeps being redelivered without a new event.

---

## E. Semantic Mode Configuration

### E1. New config flags appear in the live plugin manifest
- File: `/Users/hieu/.openclaw/extensions/knotwork-bridge/openclaw.plugin.json`
- ✅ Pass: `semanticActionProtocolEnabled` and `semanticActionStrictMode` are present with default `false`.
- ❌ Fail: manifest does not expose the new config flags.

### E2. Legacy mode still works with semantic mode disabled
- Config:
  - `"semanticActionProtocolEnabled": false`
  - `"semanticActionStrictMode": false`
- Action: mention the agent in a channel.
- ✅ Pass: agent responds using legacy behavior and no semantic-mode failure blocks the reply.
- ❌ Fail: disabling semantic mode breaks normal channel replies.

### E3. Non-strict semantic mode falls back safely
- Config:
  - `"semanticActionProtocolEnabled": true`
  - `"semanticActionStrictMode": false`
- Action: provoke malformed `json-action` output intentionally if possible.
- ✅ Pass: plugin logs a semantic failure and falls back to legacy handling instead of dropping the task.
- ❌ Fail: task disappears silently or raw errors leak without fallback.

### E4. Strict semantic mode rejects malformed semantic output
- Config:
  - `"semanticActionProtocolEnabled": true`
  - `"semanticActionStrictMode": true`
- Action: provoke malformed `json-action` output intentionally if possible.
- ✅ Pass: plugin marks the task failed rather than posting raw malformed output back into the channel.
- ❌ Fail: raw malformed JSON/action block is still posted to the channel.

---

## F. Semantic Action: `channel.post_message`

### F1. Full-envelope `channel.post_message` posts only payload content
- Config:
  - `"semanticActionProtocolEnabled": true`
  - `"semanticActionStrictMode": true`
- Action: mention the agent and instruct it to answer via semantic mode.
- ✅ Pass: Knotwork channel receives only the message content, not the surrounding `json-action` block.
- ❌ Fail: raw JSON block or envelope text is posted to the channel.

### F2. Shorthand `channel.post_message` compatibility works
- Action: trigger a response that returns the shorthand form:
  - `action`
  - `channel_id`
  - `payload.content`
- ✅ Pass: plugin normalizes the shorthand internally and posts only `payload.content`.
- ❌ Fail: shorthand output is treated as plain text and echoed into the channel.

### F3. `control.noop` does not create a channel message
- Action: trigger a case where the agent emits `control.noop`.
- ✅ Pass: no extra message is posted to the channel and the task completes cleanly.
- ❌ Fail: `control.noop` still results in a visible reply or raw JSON echo.

### F4. Agent can ask another workspace member through normal channel message
- Action: ask something better suited for another member and ensure the agent chooses to mention them in a normal post.
- ✅ Pass: agent emits a normal `channel.post_message` asking that member to take a look; Knotwork mention/inbox routing handles delivery.
- ❌ Fail: plugin invents a separate delegation/task action or tries to route subagents itself.

---

## G. Semantic Action: `escalation.resolve`

### G1. Agent can resolve a valid escalation
- Precondition: create or find an open escalation assigned/available to the agent.
- Action: trigger agent handling path that should resolve it.
- ✅ Pass: escalation status changes through the existing Knotwork resolution API and run state updates accordingly.
- ❌ Fail: escalation remains open while plugin claims success, or invalid resolution payload is sent.

### G2. Resolution data is forwarded correctly
- Cases to verify:
  - `accept_output`
  - `override_output`
  - `request_revision`
  - `abort_run`
- ✅ Pass: payload fields such as `guidance`, `override_output`, `next_branch`, and `answers` are forwarded when present.
- ❌ Fail: action succeeds superficially but drops important resolution fields.

### G3. Bad resolution action fails cleanly
- Action: provoke invalid semantic payload for `escalation.resolve`.
- ✅ Pass: plugin logs semantic failure/rejection and does not mutate the escalation incorrectly.
- ❌ Fail: malformed resolution partially updates escalation state.

---

## H. Semantic Action: `knowledge.propose_change`

### H1. Agent can create a knowledge change proposal for a file
- Precondition: channel is bound to a file asset or the prompt gives a valid knowledge path.
- Action: ask agent to propose a concrete handbook/document change.
- ✅ Pass: proposal row is created via `/knowledge/changes`, with correct path, reason, and proposed content.
- ❌ Fail: no proposal is created, or proposal is created with empty/mismatched fields.

### H2. Source channel is preserved
- Action: create a proposal from a channel discussion.
- ✅ Pass: proposal links back to the relevant source channel when `source_channel_id` is provided.
- ❌ Fail: proposal loses the channel context that initiated it.

### H3. Knowledge asset context improves proposal quality
- Precondition: channel is bound to a file or folder asset.
- Action: ask the agent to propose a change to that asset.
- ✅ Pass: proposal content clearly reflects the bound file/folder context rather than generic text.
- ❌ Fail: proposal ignores available asset content and invents unrelated changes.

---

## I. Capability Model

### I1. Capability snapshot includes subscribed channels
- Action: inspect semantic-mode behavior or logs after subscribing the agent to multiple channels.
- ✅ Pass: semantic capability snapshot allows posting/reading in subscribed channels, not only the trigger channel.
- ❌ Fail: semantic mode remains artificially locked to the trigger channel even when the member is subscribed elsewhere.

### I2. Cross-channel post works only where agent has access
- Action:
  1. subscribe the agent to channel A and B
  2. trigger in channel A
  3. instruct agent to post into channel B
- ✅ Pass: post to channel B succeeds if subscribed.
- ❌ Fail: post is rejected despite valid subscription.

### I3. Unauthorized target channel is rejected
- Action: trigger from a subscribed channel and instruct the agent to post into an unsubscribed channel.
- ✅ Pass: dispatcher rejects the action and does not post.
- ❌ Fail: plugin posts into channels outside the capability snapshot.

---

## J. Asset-Aware Context

### J1. File-bound channel includes file content in semantic context
- Precondition: channel has a file asset binding.
- Action: ask the agent a question about that file.
- ✅ Pass: response/proposal references the actual file content, path, or title.
- ❌ Fail: agent ignores file-bound context entirely.

### J2. Folder-bound channel includes file summaries
- Precondition: channel has a folder asset binding containing multiple files.
- Action: ask the agent for a recommendation or proposal affecting the folder.
- ✅ Pass: response reflects files in the folder summary context.
- ❌ Fail: folder binding is ignored and answer stays generic.

### J3. Run-bound context includes run + nodes
- Precondition: channel has a run asset binding or inbox trigger includes `run_id`.
- Action: ask the agent about what happened in that run.
- ✅ Pass: response references run status and/or node states from Knotwork.
- ❌ Fail: run-related answer is blind to the bound run context.

### J4. Escalation context is available for escalation handling
- Precondition: semantic task includes `escalation_id`.
- Action: ask the agent to resolve or comment on the escalation.
- ✅ Pass: response/action reflects escalation details rather than only the inbox title/subtitle.
- ❌ Fail: escalation handling ignores the actual escalation record.

---

## K. Logs And Observability

### K1. Semantic success is logged
- File: `/Users/hieu/.openclaw/extensions/knotwork-bridge/tasks.log`
- Action: complete a successful semantic action.
- ✅ Pass: log includes `task:semantic` with batch status.
- ❌ Fail: semantic path succeeds but leaves no semantic-specific trace.

### K2. Semantic failure is logged
- Action: trigger a semantic parse/dispatch failure.
- ✅ Pass: log includes `task:semantic-failed` with the error snippet.
- ❌ Fail: semantic failures are invisible in task log.

### K3. Raw `json-action` is never echoed when semantic handling succeeds
- Action: run a successful semantic `channel.post_message`.
- ✅ Pass: channel shows only payload content and logs show semantic handling.
- ❌ Fail: channel still shows raw fenced JSON block despite semantic success.

---

## L. Regression

### L1. Multiple inbox items do not duplicate replies
- Action: create a mention and a normal message close together in the same channel.
- ✅ Pass: each event is handled according to its type without duplicate replies to the same delivery.
- ❌ Fail: one delivery triggers multiple visible replies.

### L2. Restart does not break the plugin
- Action: restart OpenClaw gateway/plugin runtime.
- ✅ Pass: plugin reconnects, resumes polling, and keeps using configured mode/flags.
- ❌ Fail: restart loses essential config or plugin stops handling inbox events.

### L3. Previous session behavior still works where unchanged
- Run the existing baseline checks relevant to:
  - auth
  - inbox polling
  - guide reload
  - normal channel replies
- ✅ Pass: no regressions in previously working transport behavior.
- ❌ Fail: transport-layer regressions appear after the semantic-layer additions.

---

## Recommended Test Order

1. Complete sections A-C first.
2. Verify D and E in legacy mode.
3. Turn on semantic mode and run F.
4. Then validate G, H, I, and J.
5. Finish with K and L.
