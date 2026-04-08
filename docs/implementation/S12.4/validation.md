# Session 12.4 Validation Checklist

## A. Live OpenClaw Runtime

1. Trigger the `F4` mention/handoff prompt against the live OpenClaw plugin.
2. Confirm the task reaches one terminal state within the harness timeout:
   - visible mention reply posted once, or
   - explicit bounded failure with a useful error.
3. Confirm `knotwork.status` and `tasks.log` agree on whether the task is running, completed, or failed.

## B. Escalation Semantic Flow

1. Create or select a workflow graph that passes supervisor validation.
2. Trigger a fresh real escalation.
3. Validate `G1`, `G2`, and `G3` semantic escalation resolution actions.
4. Validate `J4` escalation-bound context in a live channel response.

## C. Prompt And Guideline Quality

1. Ask about a file-bound channel and confirm the agent uses Knotwork/MCP context rather than local filesystem guessing.
2. Ask about a folder-bound channel and confirm the reply cites real attached folder entries.
3. Ask about a run-bound channel and confirm the reply cites real run status/context.
4. Confirm successful semantic actions do not expose raw `json-action` blocks.
5. Confirm malformed semantic actions fail clearly without posting raw action JSON to the channel.

## D. Duplicate Delivery Regression

1. Re-run the `L` regression probes.
2. Confirm `mentioned_message` and `message_posted` do not create duplicate visible replies for one user prompt.
3. If duplicates reproduce, validate deduplication using inbox delivery/event identity.

## E. Harness Diagnostics

1. Confirm the retest harness uses the test MCP private key.
2. Confirm knowledge-change assertions accept both `path` and `target_path`.
3. Confirm received-but-not-completed OpenClaw tasks report the delivery id and last observed heartbeat/status.

## F. Shared Onboarding

1. Confirm the agent-facing Markdown primer explains Knotwork, its core functions, and the minimum operating loop.
2. Confirm Settings includes a human onboarding flow with the same conceptual steps.
3. Confirm the human flow covers inbox, channels, projects/objectives, knowledge, runs/escalations, and member status without introducing a separate human-only contract.
